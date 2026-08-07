"""Wan2.1-VACE-1.3B object removal on Modal (Phase 2.1 — SRED_VIDEOOP_EXPERIMENTS.md).

Deployment:   modal deploy modal_functions/video_remove.py
Smoke test:   modal run    modal_functions/video_remove.py
Django calls: modal.Cls.from_name("nexus8-videoremove", "VideoRemover")

The preview removal tier (H4): masked video-to-video generation steered by
background-description prompting (H5). Inputs are a staged JPEG frame span
(the same VideoFrameStager archive format the segmentation app consumes) plus
a per-frame mask archive exported from the SAM 2 mask track. White mask =
region to regenerate.

VACE is a general text-guided editor, not a dedicated remover (F3): removal
quality depends on the prompt describing the *background* (U4a), and the
unmasked region can drift slightly through the VAE round-trip — so by default
the generated pixels are composited back into the original frames inside the
(dilated) mask only, guaranteeing untouched pixels stay bit-identical.
"""

import base64
import io
import shutil
import subprocess
import tarfile
import tempfile
import time
from pathlib import Path

import modal

app = modal.App("nexus8-videoremove")

MODEL_REPO = "Wan-AI/Wan2.1-VACE-1.3B-diffusers"

# L40S over A10G: the UMT5-XXL text encoder alone is ~13 GB in bf16; on a
# 24 GB A10G the pipeline needs CPU offload, which multiplies wall-clock.
# 48 GB runs everything resident — likely cheaper per job despite the rate.
GPU = "L40S"


def _download_weights():
    from huggingface_hub import snapshot_download

    snapshot_download(MODEL_REPO)


image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install(
        "torch",
        "diffusers>=0.34",
        "transformers",
        "accelerate",
        "safetensors",
        "sentencepiece",
        "ftfy",
        "Pillow",
        "numpy",
        "huggingface_hub",
    )
    # Bake weights into the image layer (same pattern as the other apps):
    # cold start pays only disk->GPU load, never a network download.
    .run_function(_download_weights)
)


def _extract_archive(tar_bytes: bytes, pattern: str) -> tuple[str, list[Path]]:
    """Extract a tar.gz; return (dir, sorted file paths matching pattern)."""
    out_dir = tempfile.mkdtemp()
    with tarfile.open(fileobj=io.BytesIO(tar_bytes), mode="r:gz") as tar:
        tar.extractall(out_dir)
    return out_dir, sorted(Path(out_dir).glob(pattern))


def _vace_dims(width: int, height: int) -> tuple[int, int]:
    """Round dims down to multiples of 16 (VACE latent grid requirement)."""
    return max(16, width // 16 * 16), max(16, height // 16 * 16)


@app.cls(image=image, gpu=GPU, timeout=1800, scaledown_window=300)
class VideoRemover:
    """Wan2.1-VACE-1.3B masked video-to-video removal."""

    @modal.enter()
    def load(self):
        import torch
        from diffusers import AutoencoderKLWan, UniPCMultistepScheduler, WanVACEPipeline

        t0 = time.time()
        # fp32 VAE per the Wan reference pipeline (bf16 VAE causes color drift).
        vae = AutoencoderKLWan.from_pretrained(
            MODEL_REPO, subfolder="vae", torch_dtype=torch.float32
        )
        self.pipe = WanVACEPipeline.from_pretrained(
            MODEL_REPO, vae=vae, torch_dtype=torch.bfloat16
        )
        # flow_shift 3.0 is the Wan-recommended setting for 480p output.
        self.pipe.scheduler = UniPCMultistepScheduler.from_config(
            self.pipe.scheduler.config, flow_shift=3.0
        )
        self.pipe.to("cuda")
        print(f"VACE-1.3B loaded in {time.time() - t0:.1f}s")

    @modal.method()
    def remove(
        self,
        frames_tar_gz: bytes,
        masks_tar_gz: bytes,
        params: dict,
    ) -> dict:
        """Regenerate the masked region across a frame span.

        Args:
            frames_tar_gz: tar.gz of frame_*.jpg (VideoFrameStager archive,
                span-relative order).
            masks_tar_gz: tar.gz of frame_NNNNNN.png masks, named by
                span-relative index; white (or alpha) = region to remove.
                Frames without a mask file are left untouched.
            params: {
                "prompt": str,               # background description (H5)
                "negative_prompt": str,
                "num_inference_steps": int,  # default 30
                "guidance_scale": float,     # default 5.0
                "seed": int | None,
                "fps": float,                # output encode fps
                "mask_dilate_px": int,       # generous masks (INP-F8), default 8
                "composite_original": bool,  # paste-back outside mask, default True
            }

        Returns:
            {"video_mp4_b64": str, "frames_processed": int, "trimmed_frames": int,
             "width": int, "height": int, "latency_s": float, "gen_latency_s": float}
        """
        import numpy as np
        import torch
        from PIL import Image as PILImage
        from PIL import ImageFilter

        t0 = time.time()

        frames_dir, frame_paths = _extract_archive(frames_tar_gz, "frame_*.jpg")
        masks_dir, mask_paths = _extract_archive(masks_tar_gz, "frame_*.png")
        try:
            if not frame_paths:
                raise ValueError("No frame_*.jpg files in frames archive")

            # Masks are named by span-relative index; frames are ordered.
            mask_by_index = {int(p.stem.split("_")[1]): p for p in mask_paths}

            with PILImage.open(frame_paths[0]) as im:
                src_w, src_h = im.size
            gen_w, gen_h = _vace_dims(src_w, src_h)

            # VACE requires num_frames ≡ 1 (mod 4); trim the tail to fit.
            n_total = len(frame_paths)
            n = (n_total - 1) // 4 * 4 + 1
            trimmed = n_total - n
            if trimmed:
                print(f"trimming {trimmed} tail frame(s): {n_total} → {n}")

            dilate_px = int(params.get("mask_dilate_px", 8))
            # Removal requires blanking the masked region before the pipeline
            # sees it: diffusers feeds video×mask to the model as the
            # "reactive" conditioning stream, so raw pixels there let VACE
            # reconstruct the very object being removed. Neutral gray ≈ 0 in
            # the model's [-1,1] space — no object signal survives.
            blank_masked = bool(params.get("blank_masked", True))
            video, masks, mask_arrays = [], [], []
            for i in range(n):
                frame = PILImage.open(frame_paths[i]).convert("RGB")
                if frame.size != (gen_w, gen_h):
                    frame = frame.resize((gen_w, gen_h), PILImage.LANCZOS)
                video.append(frame)

                mp = mask_by_index.get(i)
                if mp:
                    m = PILImage.open(mp)
                    # Track masks arrive as grayscale (white=object) or RGBA
                    # (alpha=object) — normalize to L.
                    if m.mode == "RGBA":
                        m = m.getchannel("A")
                    else:
                        m = m.convert("L")
                    m = m.resize((gen_w, gen_h), PILImage.NEAREST)
                    if dilate_px > 0:
                        # MaxFilter size must be odd.
                        size = dilate_px * 2 + 1
                        m = m.filter(ImageFilter.MaxFilter(size))
                    m = m.point(lambda v: 255 if v > 127 else 0)
                    # 'bbox' rectangularizes the mask: an object-silhouette
                    # hole (esp. person-shaped) is itself a strong shape prior
                    # that makes VACE hallucinate the object class back into
                    # the fill; a box carries no shape information (U4a).
                    if params.get("mask_shape") == "bbox":
                        arr = np.array(m) > 127
                        if arr.any():
                            ys, xs = np.where(arr)
                            box = np.zeros_like(arr)
                            box[ys.min():ys.max() + 1, xs.min():xs.max() + 1] = True
                            m = PILImage.fromarray(box.astype("uint8") * 255)
                else:
                    m = PILImage.new("L", (gen_w, gen_h), 0)
                masks.append(m)
                mask_arr = np.array(m) > 127
                mask_arrays.append(mask_arr)
                if blank_masked and mask_arr.any():
                    arr = np.array(video[i])
                    arr[mask_arr] = 127
                    video[i] = PILImage.fromarray(arr)

            masked_frames = int(sum(a.any() for a in mask_arrays))
            print(f"{n} frames {gen_w}x{gen_h} (staged {src_w}x{src_h}), "
                  f"{masked_frames} with mask, dilate={dilate_px}px")

            generator = None
            seed = params.get("seed")
            if seed is not None:
                generator = torch.Generator(device="cuda").manual_seed(int(seed))

            t_gen = time.time()
            output = self.pipe(
                video=video,
                mask=masks,
                prompt=params.get("prompt") or "",
                negative_prompt=params.get("negative_prompt") or "",
                height=gen_h,
                width=gen_w,
                num_frames=n,
                num_inference_steps=int(params.get("num_inference_steps", 30)),
                guidance_scale=float(params.get("guidance_scale", 5.0)),
                generator=generator,
                output_type="pil",
            ).frames[0]
            gen_latency = time.time() - t_gen
            print(f"generated {len(output)} frames in {gen_latency:.1f}s")

            # Composite: keep original pixels outside the (dilated) mask so
            # untouched regions cannot drift through the VAE round-trip.
            composite = params.get("composite_original", True)
            out_frames = []
            for i, gen in enumerate(output):
                gen_img = gen if isinstance(gen, PILImage.Image) else \
                    PILImage.fromarray((np.asarray(gen) * 255).astype("uint8")
                                       if np.asarray(gen).dtype != np.uint8
                                       else np.asarray(gen))
                if gen_img.size != (gen_w, gen_h):
                    gen_img = gen_img.resize((gen_w, gen_h), PILImage.LANCZOS)
                if composite and i < len(video):
                    base = np.array(video[i])
                    gen_arr = np.array(gen_img.convert("RGB"))
                    keep = ~mask_arrays[i]
                    gen_arr[keep] = base[keep]
                    gen_img = PILImage.fromarray(gen_arr)
                out_frames.append(gen_img.convert("RGB"))

            # Encode h264 mp4 via ffmpeg (browser-playable everywhere).
            fps = float(params.get("fps") or 24.0)
            enc_dir = tempfile.mkdtemp()
            try:
                for i, img in enumerate(out_frames):
                    img.save(Path(enc_dir) / f"out_{i:06d}.png")
                mp4_path = Path(enc_dir) / "result.mp4"
                subprocess.run(
                    ["ffmpeg", "-y", "-framerate", str(fps),
                     "-i", str(Path(enc_dir) / "out_%06d.png"),
                     "-c:v", "libx264", "-pix_fmt", "yuv420p",
                     "-crf", "18", "-movflags", "+faststart", str(mp4_path)],
                    check=True, capture_output=True,
                )
                mp4_bytes = mp4_path.read_bytes()
            finally:
                shutil.rmtree(enc_dir, ignore_errors=True)

            latency = time.time() - t0
            print(f"done: {len(out_frames)} frames, {len(mp4_bytes) / 1e6:.1f} MB "
                  f"mp4, total {latency:.1f}s (gen {gen_latency:.1f}s)")
            return {
                "video_mp4_b64": base64.b64encode(mp4_bytes).decode(),
                "frames_processed": len(out_frames),
                "trimmed_frames": trimmed,
                "width": gen_w,
                "height": gen_h,
                "latency_s": latency,
                "gen_latency_s": gen_latency,
            }
        finally:
            shutil.rmtree(frames_dir, ignore_errors=True)
            shutil.rmtree(masks_dir, ignore_errors=True)


# ── Local smoke test ───────────────────────────────────────────────────────
@app.local_entrypoint()
def test():
    """9 synthetic frames with a moving square; mask the square; remove it."""
    import numpy as np
    from PIL import Image as PILImage

    def archive(images: list, name_fmt: str, fmt: str) -> bytes:
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode="w:gz") as tar:
            for i, img in enumerate(images):
                b = io.BytesIO()
                img.save(b, format=fmt)
                b.seek(0)
                info = tarfile.TarInfo(name=name_fmt % i)
                info.size = len(b.getvalue())
                tar.addfile(info, b)
        return buf.getvalue()

    frames, masks = [], []
    for i in range(9):
        arr = np.full((480, 832, 3), (30, 120, 40), dtype="uint8")  # green field
        x = 100 + i * 40
        arr[200:280, x:x + 80] = (200, 40, 40)  # red square moving right
        frames.append(PILImage.fromarray(arr))
        m = np.zeros((480, 832), dtype="uint8")
        m[200:280, x:x + 80] = 255
        masks.append(PILImage.fromarray(m))

    result = VideoRemover().remove.remote(
        frames_tar_gz=archive(frames, "frame_%06d.jpg", "JPEG"),
        masks_tar_gz=archive(masks, "frame_%06d.png", "PNG"),
        params={"prompt": "flat green field", "num_inference_steps": 10,
                "seed": 42, "fps": 12},
    )
    out = Path("/tmp/vace_remove_test.mp4")
    out.write_bytes(base64.b64decode(result["video_mp4_b64"]))
    print(f"\n{result['frames_processed']} frames "
          f"({result['width']}x{result['height']}), "
          f"gen {result['gen_latency_s']:.1f}s / total {result['latency_s']:.1f}s"
          f"\nwrote {out}")
