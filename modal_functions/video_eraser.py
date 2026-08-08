"""DiffuEraser video object removal on Modal (Phase 2.4-adjacent — SRED F23).

Deployment:   modal deploy modal_functions/video_eraser.py
Django calls: modal.Cls.from_name("nexus8-videoeraser", "DiffuEraserRemover")

The 'eraser' removal tier: SD1.5 + BrushNet + AnimateDiff-style temporal
attention, conditioned on a ProPainter flow-completion *prior* — an
architecture explicitly designed to suppress hallucination (the F21a failure
mode), at up to 1280×720 and 250-frame sequences (both beyond VOID's
384×672 / 85-frame window). Promptless: pure inpainting, no text
conditioning, no seed control.

LICENSE QUARANTINE (F1/F4): DiffuEraser itself is Apache 2.0, but this stock
pipeline uses ProPainter weights (S-Lab License 1.0, non-commercial) as the
prior stage. This tier is therefore BENCHMARK-ONLY — internal comparative
evaluation against VOID, never a shipped path — until the prior is swapped
for an MIT flow stage (FGT/FGVC), which is the recorded follow-up. The
swapped-prior variant is the candidate allowed to win commercially.
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

app = modal.App("nexus8-videoeraser")

ERASER_GIT = "https://github.com/lixiaowen-xw/DiffuEraser"
ERASER_SRC = "/opt/eraser"
WEIGHTS = f"{ERASER_SRC}/weights"

# L40S for native-res generation (max_img_size 1280 ≈ 26 GB+, past the A10G's
# comfort). Native-res output also self-composites (skips the local post-comp
# entirely) and avoids the fill-upscale softness that reads as a moving ghost.
# For cheap 480p-tier runs, "A10G" (24 GB, ~$1.10/h) fits max_img_size ≤ 960 —
# edit this constant and redeploy.
GPU = "L40S"

PROPAINTER_RELEASE = "https://github.com/sczhou/ProPainter/releases/download/v0.1.0"

# PCM distillation step count ("2-Step".."16-Step"). 2-Step is fastest but
# barely deviates from the ProPainter prior, so flow-drag ghosts in the prior
# leak into the result (observed as motion-coherent ghosting in playback,
# invisible in stills). 8-Step gives the diffusion room to override the
# prior's smear at ~4x the (still small) diffusion cost.
PCM_CKPT = "16-Step"


def _download_weights():
    import urllib.request

    from huggingface_hub import snapshot_download

    # DiffuEraser's own weights (brushnet + unet_main).
    snapshot_download("lixiaowen/diffuEraser", local_dir=f"{WEIGHTS}/diffuEraser")
    # SD1.5 base — inference needs only the non-unet folders (~4 GB; the
    # README's storage note). runwayml's repo is gone; this is the official
    # community mirror.
    snapshot_download(
        "stable-diffusion-v1-5/stable-diffusion-v1-5",
        local_dir=f"{WEIGHTS}/stable-diffusion-v1-5",
        allow_patterns=[
            "model_index.json",
            "feature_extractor/*",
            "safety_checker/*",
            "scheduler/*",
            "text_encoder/*",
            "tokenizer/*",
        ],
    )
    snapshot_download("wangfuyun/PCM_Weights", local_dir=f"{WEIGHTS}/PCM_Weights",
                      allow_patterns=["sd15/*"])
    snapshot_download("stabilityai/sd-vae-ft-mse",
                      local_dir=f"{WEIGHTS}/sd-vae-ft-mse")
    # ProPainter prior weights (S-Lab NC — the quarantined component).
    pp_dir = Path(f"{WEIGHTS}/propainter")
    pp_dir.mkdir(parents=True, exist_ok=True)
    for name in ("ProPainter.pth", "raft-things.pth",
                 "recurrent_flow_completion.pth"):
        urllib.request.urlretrieve(f"{PROPAINTER_RELEASE}/{name}",
                                   str(pp_dir / name))


image = (
    modal.Image.debian_slim(python_version="3.10")
    .apt_install("ffmpeg", "git", "libgl1", "libglib2.0-0")
    .run_commands(
        f"git clone --depth 1 {ERASER_GIT} {ERASER_SRC}",
        f"pip install -r {ERASER_SRC}/requirements.txt",
    )
    .run_function(_download_weights, timeout=3600)
)


def _extract_archive(tar_bytes: bytes, pattern: str) -> tuple[str, list[Path]]:
    out_dir = tempfile.mkdtemp()
    with tarfile.open(fileobj=io.BytesIO(tar_bytes), mode="r:gz") as tar:
        tar.extractall(out_dir)
    return out_dir, sorted(Path(out_dir).glob(pattern))


# Models load ONCE per container (@modal.enter, in-process — not the
# subprocessed upstream script), so repeat runs within the scaledown window
# pay only inference. 180 s idle ≈ $0.055 on A10G, roughly the cost of one
# cold reload — break-even for iteration bursts, cheap for one-offs.
@app.cls(image=image, gpu=GPU, timeout=1800, scaledown_window=180)
class DiffuEraserRemover:
    """DiffuEraser (ProPainter-prior) removal, models resident per-container."""

    @modal.enter()
    def load(self):
        import os
        import sys

        t0 = time.time()
        # Their code resolves some weight paths relative to the repo root
        # (e.g. PCM under weights/), so run from there.
        os.chdir(ERASER_SRC)
        sys.path.insert(0, ERASER_SRC)
        from diffueraser.diffueraser import DiffuEraser
        from propainter.inference import Propainter, get_device

        self.device = get_device()
        self.eraser = DiffuEraser(
            self.device,
            f"{WEIGHTS}/stable-diffusion-v1-5",
            f"{WEIGHTS}/sd-vae-ft-mse",
            f"{WEIGHTS}/diffuEraser",
            ckpt=PCM_CKPT,
        )
        self.propainter = Propainter(f"{WEIGHTS}/propainter", device=self.device)
        print(f"DiffuEraser + ProPainter loaded in {time.time() - t0:.1f}s")

    @modal.method()
    def remove(
        self,
        frames_tar_gz: bytes,
        masks_tar_gz: bytes,
        params: dict,
    ) -> dict:
        """Remove the masked object across a frame span.

        Args:
            frames_tar_gz: tar.gz of frame_*.jpg (VideoFrameStager archive).
            masks_tar_gz: tar.gz of frame_NNNNNN.png track masks, named by
                span-relative index; white (or alpha) = object to remove.
            params: {
                "fps": float,                # must match between video & mask
                "mask_dilation_iter": int,   # upstream default 8
                "max_img_size": int,         # long-edge cap, upstream default 960
            }

        Returns:
            {"video_mp4_b64", "frames_processed", "width", "height",
             "latency_s", "gen_latency_s"}
        """
        import numpy as np
        from PIL import Image as PILImage

        t0 = time.time()

        frames_dir, frame_paths = _extract_archive(frames_tar_gz, "frame_*.jpg")
        masks_dir, mask_paths = _extract_archive(masks_tar_gz, "frame_*.png")
        work = Path(tempfile.mkdtemp())
        try:
            if not frame_paths:
                raise ValueError("No frame_*.jpg files in frames archive")
            mask_by_index = {int(p.stem.split("_")[1]): p for p in mask_paths}

            with PILImage.open(frame_paths[0]) as im:
                src_w, src_h = im.size
            n = len(frame_paths)
            fps = float(params.get("fps") or 24.0)

            # input video — the script requires mp4 in, identical fps for
            # video and mask (frame misalignment otherwise).
            rgb = work / "rgb"
            rgb.mkdir()
            for i, p in enumerate(frame_paths):
                shutil.copy(p, rgb / f"f_{i:06d}.jpg")
            subprocess.run(
                ["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(fps),
                 "-i", str(rgb / "f_%06d.jpg"),
                 "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "10",
                 str(work / "video.mp4")],
                check=True,
            )

            # mask video — white = inpaint; frames without a track mask are
            # black (keep). Lossless luma so binary masks survive encoding.
            qm = work / "qm"
            qm.mkdir()
            masked_frames = 0
            for i in range(n):
                mp = mask_by_index.get(i)
                if mp:
                    m = PILImage.open(mp)
                    m = m.getchannel("A") if m.mode == "RGBA" else m.convert("L")
                    if m.size != (src_w, src_h):
                        m = m.resize((src_w, src_h), PILImage.NEAREST)
                    arr = (np.array(m) > 127).astype("uint8") * 255
                    masked_frames += bool(arr.any())
                else:
                    arr = np.zeros((src_h, src_w), dtype="uint8")
                PILImage.fromarray(arr).save(qm / f"f_{i:06d}.png")
            subprocess.run(
                ["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(fps),
                 "-i", str(qm / "f_%06d.png"),
                 "-c:v", "libx264", "-pix_fmt", "yuv420p", "-qp", "0",
                 str(work / "mask.mp4")],
                check=True,
            )

            import math

            import torch

            # Seconds (read_video end_pts, pts_unit='sec') — +1 headroom so
            # the cap never truncates the span.
            secs = math.ceil(n / fps) + 1
            dilation = int(params.get("mask_dilation_iter", 8))
            priori = work / "priori.mp4"
            result = work / "diffueraser_result.mp4"

            print(f"{n} frames {src_w}x{src_h} @ {fps}fps, {masked_frames} "
                  f"masked; running DiffuEraser (ProPainter prior) …")
            t_gen = time.time()
            # In-process (models resident from @modal.enter): ProPainter
            # flow-completion prior, then the diffusion pass conditioned on it.
            self.propainter.forward(
                str(work / "video.mp4"), str(work / "mask.mp4"), str(priori),
                video_length=secs,
                ref_stride=int(params.get("ref_stride", 10)),
                neighbor_length=int(params.get("neighbor_length", 10)),
                subvideo_length=int(params.get("subvideo_length", 50)),
                mask_dilation=dilation,
            )
            self.eraser.forward(
                str(work / "video.mp4"), str(work / "mask.mp4"), str(priori),
                str(result),
                max_img_size=int(params.get("max_img_size", 960)),
                video_length=secs,
                mask_dilation_iter=dilation,
                guidance_scale=None,
            )
            torch.cuda.empty_cache()
            gen_latency = time.time() - t_gen

            if not result.exists():
                # In-process exceptions propagate naturally; this guards the
                # silent-skip case (the F22b lesson).
                raise RuntimeError(f"DiffuEraser produced no output at {result}")
            mp4_bytes = result.read_bytes()

            import json as _json
            probe = subprocess.run(
                ["ffprobe", "-v", "error", "-select_streams", "v:0",
                 "-show_entries", "stream=width,height", "-of", "json",
                 str(result)],
                capture_output=True, text=True,
            )
            dims = {}
            try:
                stream = _json.loads(probe.stdout)["streams"][0]
                dims = {"width": stream.get("width"), "height": stream.get("height")}
            except Exception:
                pass

            latency = time.time() - t0
            print(f"done: {n} frames, {len(mp4_bytes) / 1e6:.1f} MB mp4, "
                  f"total {latency:.1f}s (gen {gen_latency:.1f}s)")
            return {
                "video_mp4_b64": base64.b64encode(mp4_bytes).decode(),
                "frames_processed": n,
                "trimmed_frames": 0,
                **dims,
                "latency_s": latency,
                "gen_latency_s": gen_latency,
                "passes": 1,
            }
        finally:
            shutil.rmtree(frames_dir, ignore_errors=True)
            shutil.rmtree(masks_dir, ignore_errors=True)
            shutil.rmtree(work, ignore_errors=True)
