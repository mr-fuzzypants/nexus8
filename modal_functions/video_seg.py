"""SAM 2.1 video segmentation on Modal (Phase 1.1 — SRED_VIDEOOP_EXPERIMENTS.md).

Deployment:   modal deploy modal_functions/video_seg.py
Smoke test:   modal run    modal_functions/video_seg.py
Django calls: modal.Cls.from_name("nexus8-videoseg", "VideoSegmentor")

SAM 2.1 video predictor API (not the image predictor):
  init_state(video_path)               ← directory of sequential JPEG frames
  add_new_points_or_box(...)           ← add prompt on a specific frame
  propagate_in_video(inference_state)  ← generator yielding per-frame masks

The tar.gz archive produced by VideoFrameStager contains frame_000000.png …
We convert to sequential JPEG inside the container because SAM 2 expects that.
"""

import base64
import io
import os
import shutil
import tarfile
import tempfile
import time
from pathlib import Path

import modal

app = modal.App("nexus8-videoseg")

SAM2_REPO  = "facebook/sam2.1-hiera-large"
SAM2_CKPT  = "sam2.1_hiera_large.pt"
SAM2_CFG   = "configs/sam2.1/sam2.1_hiera_l.yaml"


def _download_weights():
    from huggingface_hub import hf_hub_download
    # Pre-cache into the container image at build time so cold starts skip the
    # download entirely.  The path is returned but we only care it's cached.
    hf_hub_download(repo_id=SAM2_REPO, filename=SAM2_CKPT)


image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "libgl1", "git")
    .pip_install(
        "torch",
        "torchvision",
        "pillow",
        "numpy",
        "huggingface_hub",
        "git+https://github.com/facebookresearch/sam2.git@main",
    )
    .run_function(_download_weights)
)


def _tar_to_jpeg_dir(tar_bytes: bytes) -> tuple[str, int]:
    """Extract a tar.gz of frame_*.{jpg,png}; produce sequential 0-indexed JPEGs.

    SAM 2's init_state expects frames named <index>.jpg in order. JPEG inputs are
    just renamed (no re-encode); PNG inputs are converted for backward compat.

    Returns (frames_dir, total_frames).  Caller must shutil.rmtree(frames_dir).
    """
    frames_dir = tempfile.mkdtemp()
    with tarfile.open(fileobj=io.BytesIO(tar_bytes), mode="r:gz") as tar:
        tar.extractall(frames_dir)

    frame_paths = sorted(Path(frames_dir).glob("frame_*.jpg"))
    if frame_paths:
        for i, src in enumerate(frame_paths):
            src.rename(Path(frames_dir) / f"{i:07d}.jpg")
        return frames_dir, len(frame_paths)

    # Backward-compat: PNG archive → convert to JPEG.
    from PIL import Image as PILImage

    png_paths = sorted(Path(frames_dir).glob("frame_*.png"))
    if not png_paths:
        raise ValueError("No frame_*.jpg or frame_*.png files in archive")

    for i, png_path in enumerate(png_paths):
        img = PILImage.open(png_path).convert("RGB")
        img.save(Path(frames_dir) / f"{i:07d}.jpg", "JPEG", quality=95)
        png_path.unlink()

    return frames_dir, len(png_paths)


# max_containers=1: propagation sessions are retained in-container so that
# correction clicks hit the container holding the inference state. Serializes
# GPU work across users — acceptable for the single-user experiment.
@app.cls(image=image, gpu="A10G", timeout=600, scaledown_window=300,
         max_containers=1)
class VideoSegmentor:
    """SAM 2.1 video segmentor with forward mask propagation."""

    @modal.enter()
    def load(self):
        import torch
        from huggingface_hub import hf_hub_download
        from sam2.build_sam import build_sam2_video_predictor

        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        print(f"Device: {self.device}")

        ckpt_path = hf_hub_download(repo_id=SAM2_REPO, filename=SAM2_CKPT)
        print(f"Checkpoint: {ckpt_path}")

        self.predictor = build_sam2_video_predictor(
            config_file=SAM2_CFG,
            ckpt_path=ckpt_path,
            device=self.device,
        )
        print("SAM 2.1 video predictor loaded")

        # Interactive single-frame predictor for the click→preview loop. Built
        # from the SAME Apache-2.0 checkpoint (loaded separately for safety —
        # the image predictor wraps a plain SAM2Base). Original implementation;
        # no code from the sam2 demo app is used.
        from sam2.build_sam import build_sam2
        from sam2.sam2_image_predictor import SAM2ImagePredictor

        image_model = build_sam2(SAM2_CFG, ckpt_path, device=self.device)
        self.image_predictor = SAM2ImagePredictor(image_model)
        # Cache the last image embedding by frame-bytes hash so repeated clicks
        # on the same frame skip the encoder (the expensive part).
        self._preview_embed_key = None
        # Last prediction's clicks + low-res logits for the cached frame, so a
        # refinement click is conditioned on the previous mask (mask_input)
        # instead of re-solving from bare coordinates.
        self._preview_chain = None

        # Retained video-predictor sessions (demo-style corrections): after a
        # propagation we keep the inference state so a click on a propagated
        # frame refines the existing mask — add_new_points_or_box feeds the
        # frame's propagated logits back as prev_sam_mask_logits. Keyed by
        # "<asset>:<layer>". A 600-frame hiera-large state holds ~1 GB of
        # per-frame memory features, hence the small LRU cap.
        self._sessions: dict[str, dict] = {}
        self._max_sessions = 2
        print("SAM 2.1 image predictor loaded")

    @modal.method()
    def preview(self, frame_jpeg: bytes, clicks: list[dict]) -> dict:
        """Interactive prompt-frame preview: one frame + clicks → mask, fast.

        Args:
            frame_jpeg: The staged frame as JPEG bytes.
            clicks: [{"x": px, "y": px, "positive": bool}] in frame-pixel coords.

        Returns:
            {"mask_png_b64": <binary mask PNG, white=object>,
             "score": float, "latency_s": float}
        """
        import hashlib

        import numpy as np
        from PIL import Image as PILImage

        t0 = time.time()

        key = hashlib.sha256(frame_jpeg).hexdigest()
        if self._preview_embed_key != key:
            img = np.array(PILImage.open(io.BytesIO(frame_jpeg)).convert("RGB"))
            self.image_predictor.set_image(img)
            self._preview_embed_key = key
            self._preview_chain = None

        points = np.array([[c["x"], c["y"]] for c in clicks], dtype=np.float32)
        labels = np.array(
            [1 if c.get("positive", True) else 0 for c in clicks], dtype=np.int32
        )

        # Official SAM interactive protocol: chain the previous prediction's
        # low-res logits as mask_input so each new click refines the current
        # mask rather than re-solving from bare coordinates. Only chain when
        # the click list extends the one we predicted from — on undo/edit the
        # cached mask includes a click that no longer exists, so start over.
        mask_input = None
        chain = self._preview_chain
        if (
            chain is not None
            and len(clicks) > len(chain["clicks"])
            and clicks[: len(chain["clicks"])] == chain["clicks"]
        ):
            mask_input = chain["logits"]

        # Single ambiguous click → let SAM propose scales and take the best;
        # with more clicks (or a mask prior) the single-mask head is better.
        multimask = mask_input is None and len(clicks) == 1
        masks, scores, low_res_logits = self.image_predictor.predict(
            point_coords=points,
            point_labels=labels,
            mask_input=mask_input,
            multimask_output=multimask,
        )
        best = int(np.argmax(scores))
        self._preview_chain = {
            "clicks": clicks,
            "logits": low_res_logits[best][None],  # (1, 256, 256)
        }
        mask_np = (masks[best] > 0).astype("uint8") * 255

        buf = io.BytesIO()
        PILImage.fromarray(mask_np).save(buf, format="PNG")
        latency = time.time() - t0
        print(f"preview: {len(clicks)} click(s), "
              f"{'chained' if mask_input is not None else 'fresh'}, "
              f"score={float(scores[best]):.3f}, {latency*1000:.0f}ms")
        return {
            "mask_png_b64": base64.b64encode(buf.getvalue()).decode(),
            "score": float(scores[best]),
            "latency_s": latency,
        }

    @modal.method()
    def session_click(
        self,
        session_key: str,
        session_meta: dict,
        frame_index: int,
        clicks: list[dict],
    ) -> dict:
        """Correction click against a retained propagation session.

        add_new_points_or_box looks up the frame's existing output (propagated
        or previously clicked) and feeds it back as prev_sam_mask_logits, so
        the click REFINES the current mask instead of re-solving from bare
        coordinates — the SAM2 demo's correction mechanism. Negative-only
        clicks are valid here: the prior mask establishes the object.

        Args:
            session_key: "<asset>:<layer>" — must match a retained session.
            session_meta: Must equal the meta stored at propagate time.
            frame_index: Span-relative frame index.
            clicks: ALL current clicks for this frame (points are replaced,
                not accumulated), in staged-frame pixel coords.

        Returns:
            {"mask_png_b64", "score", "latency_s", "conditioned": True} on
            success, or {"no_session": True} when the state is gone/mismatched
            (caller should fall back to the stateless preview).
        """
        import numpy as np
        import torch
        from PIL import Image as PILImage

        t0 = time.time()

        sess = self._sessions.get(session_key)
        if sess is None:
            print(f"session_click: no session {session_key}")
            return {"no_session": True}
        if session_meta != sess["meta"]:
            print(f"session_click: meta mismatch {session_meta} != {sess['meta']}")
            return {"no_session": True}
        if not 0 <= frame_index < sess["total_frames"]:
            print(f"session_click: frame {frame_index} outside "
                  f"[0, {sess['total_frames'] - 1}]")
            return {"no_session": True}
        # LRU touch.
        self._sessions[session_key] = self._sessions.pop(session_key)

        points = np.array([[c["x"], c["y"]] for c in clicks], dtype=np.float32)
        labels = np.array(
            [1 if c.get("positive", True) else 0 for c in clicks], dtype=np.int32
        )
        _, out_obj_ids, out_mask_logits = self.predictor.add_new_points_or_box(
            inference_state=sess["state"],
            frame_idx=frame_index,
            obj_id=1,
            points=points,
            labels=labels,
        )
        obj_pos = list(out_obj_ids).index(1)
        logit = out_mask_logits[obj_pos]                    # [1, H, W]
        mask_np = (logit > 0.0).squeeze().cpu().numpy().astype("uint8") * 255
        score = float(torch.sigmoid(logit.max()).cpu())

        buf = io.BytesIO()
        PILImage.fromarray(mask_np).save(buf, format="PNG")
        latency = time.time() - t0
        print(f"session_click: {session_key} frame {frame_index}, "
              f"{len(clicks)} click(s), score={score:.3f}, {latency*1000:.0f}ms")
        return {
            "mask_png_b64": base64.b64encode(buf.getvalue()).decode(),
            "score": score,
            "latency_s": latency,
            "conditioned": True,
        }

    @modal.method()
    def propagate(
        self,
        frames_tar_gz: bytes,
        prompt_frames: list[dict],
        propagation_params: dict,
        session_key: str | None = None,
        session_meta: dict | None = None,
    ) -> dict:
        """Propagate masks from prompt frames across video frames.

        Args:
            frames_tar_gz: tar.gz of frame_000000.png … produced by VideoFrameStager.
            prompt_frames:
                [{"frame_index": 0, "type": "click",
                  "clicks": [{"x": 320.0, "y": 240.0, "positive": true}]}, ...]
            propagation_params:
                {"full_clip": true}  — span_start / span_end for sub-clip not yet used.
            session_key: If set, retain the inference state after propagation so
                session_click can refine propagated frames (demo-style corrections).
            session_meta: Opaque dict echoed back to session_click for validation
                (tier + span, so stale clients can't click against a mismatched
                session).

        Returns:
            {"frames": [{frame_index, mask_png_b64, confidence, authorship}, ...],
             "total_frames": int,
             "latency_s": float}
        """
        import numpy as np
        import torch
        from PIL import Image as PILImage

        t0 = time.time()

        # Free the session being replaced (and LRU overflow) BEFORE building the
        # new state so peak GPU/CPU memory stays bounded.
        if session_key:
            self._sessions.pop(session_key, None)
            while len(self._sessions) >= self._max_sessions:
                evicted = next(iter(self._sessions))
                del self._sessions[evicted]
                print(f"session evicted: {evicted}")

        # ── Unpack frames ──────────────────────────────────────────────────────
        frames_dir, total_frames = _tar_to_jpeg_dir(frames_tar_gz)
        print(f"Unpacked {total_frames} frames → {frames_dir}")

        try:
            # ── Build inference state ──────────────────────────────────────────
            # Offload decoded frames to CPU: with hiera-large, holding a 600-frame
            # span's images on the A10G (24 GB) is the memory risk. This is the big,
            # cheap saver. offload_state_to_cpu is intentionally NOT set — it adds
            # heavy per-frame latency and is only needed for far longer videos than
            # our 600-frame cap; revisit if OOM appears on large spans.
            inference_state = self.predictor.init_state(
                video_path=frames_dir,
                offload_video_to_cpu=True,
            )
            self.predictor.reset_state(inference_state)

            prompt_frame_indices = {pf["frame_index"] for pf in prompt_frames}

            # Staged frames are uniform size; needed to resize mask prompts.
            first_frame = sorted(Path(frames_dir).glob("*.jpg"))[0]
            with PILImage.open(first_frame) as fim:
                frame_w, frame_h = fim.size

            # ── Add prompts ────────────────────────────────────────────────────
            for prompt in prompt_frames:
                frame_idx = prompt["frame_index"]

                mask_b64 = prompt.get("mask_b64")
                if mask_b64:
                    # Mask prompt (add_new_mask): the artist's painted region,
                    # negatives already erased client-side. Use the alpha channel
                    # (destination-out set alpha=0 where erased); resize to the
                    # staged frame size with nearest-neighbour to stay binary.
                    raw = base64.b64decode(mask_b64)
                    m = (PILImage.open(io.BytesIO(raw)).convert("RGBA")
                         .resize((frame_w, frame_h), PILImage.NEAREST))
                    mask_arr = np.array(m)[:, :, 3] > 127
                    print(f"Adding MASK prompt at frame {frame_idx}: "
                          f"{int(mask_arr.sum())} px of {frame_w}x{frame_h}")
                    self.predictor.add_new_mask(
                        inference_state=inference_state,
                        frame_idx=frame_idx,
                        obj_id=1,
                        mask=mask_arr,
                    )
                    continue

                clicks = prompt.get("clicks", [])
                if not clicks:
                    continue
                points = np.array(
                    [[c["x"], c["y"]] for c in clicks], dtype=np.float32
                )
                labels = np.array(
                    [1 if c.get("positive", True) else 0 for c in clicks],
                    dtype=np.int32,
                )
                print(f"Adding prompt at frame {frame_idx}: {len(clicks)} click(s)")
                self.predictor.add_new_points_or_box(
                    inference_state=inference_state,
                    frame_idx=frame_idx,
                    obj_id=1,
                    points=points,
                    labels=labels,
                )

            # ── Propagate forward ──────────────────────────────────────────────
            result_by_frame: dict[int, dict] = {}

            for out_frame_idx, out_obj_ids, out_mask_logits in \
                    self.predictor.propagate_in_video(inference_state):

                if 1 not in list(out_obj_ids):
                    continue

                obj_pos = list(out_obj_ids).index(1)
                logit = out_mask_logits[obj_pos]           # shape: [1, H, W]
                mask_np = (logit > 0.0).squeeze().cpu().numpy().astype("uint8") * 255
                confidence = float(torch.sigmoid(logit.max()).cpu())

                buf = io.BytesIO()
                PILImage.fromarray(mask_np).save(buf, format="PNG")
                mask_b64 = base64.b64encode(buf.getvalue()).decode()

                authorship = (
                    "keyframe" if out_frame_idx in prompt_frame_indices
                    else "propagated"
                )
                result_by_frame[out_frame_idx] = {
                    "frame_index": out_frame_idx,
                    "mask_png_b64": mask_b64,
                    "confidence": confidence,
                    "authorship": authorship,
                }

                if (out_frame_idx + 1) % 50 == 0:
                    print(f"  {out_frame_idx + 1}/{total_frames} frames "
                          f"({time.time() - t0:.1f}s)")

            frames_out = [result_by_frame[i] for i in range(total_frames) if i in result_by_frame]
            latency_s = time.time() - t0
            print(f"Done: {len(frames_out)} frames in {latency_s:.1f}s")

            # Retain the state for demo-style correction clicks. The decoded
            # frames live in inference_state["images"], so frames_dir can still
            # be removed in the finally block.
            if session_key:
                self._sessions[session_key] = {
                    "state": inference_state,
                    "meta": session_meta or {},
                    "total_frames": total_frames,
                }
                print(f"session retained: {session_key} ({total_frames} frames)")

            return {
                "frames": frames_out,
                "total_frames": total_frames,
                "latency_s": latency_s,
            }

        finally:
            shutil.rmtree(frames_dir, ignore_errors=True)


# ── Local smoke test ────────────────────────────────────────────────────────────
@app.local_entrypoint()
def test():
    """Quick sanity check: 5 synthetic frames, one click prompt on frame 0."""
    import numpy as np
    from PIL import Image as PILImage

    print("Building 5-frame test archive…")
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for i in range(5):
            frame = np.zeros((480, 640, 3), dtype="uint8")
            # White rectangle in the center to give SAM 2 something to segment.
            frame[180:300, 220:420] = 255
            img_bytes = io.BytesIO()
            PILImage.fromarray(frame).save(img_bytes, format="PNG")
            img_bytes.seek(0)
            info = tarfile.TarInfo(name=f"frame_{i:06d}.png")
            info.size = len(img_bytes.getvalue())
            tar.addfile(info, img_bytes)

    tar_bytes = buf.getvalue()
    print(f"Archive size: {len(tar_bytes):,} bytes")

    seg = VideoSegmentor()
    result = seg.propagate.remote(
        frames_tar_gz=tar_bytes,
        prompt_frames=[{
            "frame_index": 0,
            "type": "click",
            "clicks": [{"x": 320.0, "y": 240.0, "positive": True}],
        }],
        propagation_params={"full_clip": True},
    )

    print(f"\nResult: {result['total_frames']} frames, {result['latency_s']:.1f}s")
    if result["frames"]:
        f0 = result["frames"][0]
        print(f"Frame 0: confidence={f0['confidence']:.3f}, "
              f"authorship={f0['authorship']}, "
              f"mask size={len(f0['mask_png_b64'])} bytes (b64)")
    else:
        print("WARNING: no frames returned")
