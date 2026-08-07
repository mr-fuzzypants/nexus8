"""Netflix VOID object removal on Modal (Phase 2.3 — SRED_VIDEOOP_EXPERIMENTS.md).

Deployment:   modal deploy modal_functions/video_void.py
Django calls: modal.Cls.from_name("nexus8-videovoid", "VoidRemover")

The quality removal tier (H4): purpose-built, quadmask-conditioned removal
fine-tuned from CogVideoX-Fun-V1.5-5b-InP. Unlike VACE (a general text-guided
editor whose fill hallucinates contextually-implied subjects back in — F21a),
VOID's training explicitly separates remove/preserve semantics and removes the
object's physical effects (shadows, reflections) as well.

Licensing (F2): code and weights Apache 2.0; diligence flag on the upstream
CogVideoX-5B lineage stands for commercialization, not experimentation.

Pass 1 only for now: our spans (≤197 frames) fit the windowed multidiffusion;
pass 2 (warped-noise refinement) is the long-sequence consistency mechanism —
wire it when 2.3 exercises shots beyond one 85-frame window.

Interface (verified against the repo, Aug 2026): per-sequence directory of
  input_video.mp4, quadmask_0.mp4, prompt.json {"bg": "<background desc>"}
run through inference/cogvideox_fun/predict_v2v.py with --config overrides.
Quadmask pixel semantics: 0 = remove, 63 = overlap, 127 = affected region,
255 = keep. First pass populates only remove/keep (interaction region empty,
per plan 2.3).
"""

import base64
import io
import json
import shutil
import subprocess
import tarfile
import tempfile
import time
from pathlib import Path

import modal

app = modal.App("nexus8-videovoid")

VOID_GIT = "https://github.com/netflix/void-model"
BASE_MODEL_REPO = "alibaba-pai/CogVideoX-Fun-V1.5-5b-InP"
VOID_WEIGHTS_REPO = "netflix/void-model"

BASE_MODEL_DIR = "/opt/models/CogVideoX-Fun-V1.5-5b-InP"
VOID_WEIGHTS_DIR = "/opt/models/void"
VOID_SRC = "/opt/void"

# 40 GB+ VRAM required; the default gpu_memory_mode
# (model_cpu_offload_and_qfloat8) keeps the 5B DiT + T5 within an A100-40GB.
GPU = "A100-40GB"


def _download_weights():
    from huggingface_hub import hf_hub_download, snapshot_download

    snapshot_download(BASE_MODEL_REPO, local_dir=BASE_MODEL_DIR)
    hf_hub_download(VOID_WEIGHTS_REPO, "void_pass1.safetensors",
                    local_dir=VOID_WEIGHTS_DIR)


image = (
    modal.Image.debian_slim(python_version="3.10")
    .apt_install("ffmpeg", "git", "libgl1", "libglib2.0-0")
    .run_commands(
        f"git clone --depth 1 {VOID_GIT} {VOID_SRC}",
        f"pip install -r {VOID_SRC}/requirements.txt",
    )
    # Bake weights (repo convention): cold start pays disk->GPU load only.
    .run_function(_download_weights, timeout=3600)
)


def _extract_archive(tar_bytes: bytes, pattern: str) -> tuple[str, list[Path]]:
    out_dir = tempfile.mkdtemp()
    with tarfile.open(fileobj=io.BytesIO(tar_bytes), mode="r:gz") as tar:
        tar.extractall(out_dir)
    return out_dir, sorted(Path(out_dir).glob(pattern))


def _fit_sample_size(width: int, height: int) -> str:
    """VOID sample_size ("HxW"): fit the input inside the model's trained
    384x672 box, preserving aspect, dims rounded down to multiples of 16."""
    scale = min(672 / width, 384 / height)
    w = max(16, int(width * scale) // 16 * 16)
    h = max(16, int(height * scale) // 16 * 16)
    return f"{h}x{w}"


@app.cls(image=image, gpu=GPU, timeout=3600, scaledown_window=240)
class VoidRemover:
    """VOID pass-1 quadmask removal via the upstream inference script.

    The script is subprocessed per call (it owns model loading and windowed
    multidiffusion); a warm container therefore re-pays model load (~minutes)
    each job. Acceptable at experiment scale — in-process pipeline reuse is
    the optimization if the quality tier becomes routine.
    """

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
                "prompt": str,                # background description ("bg")
                "num_inference_steps": int,   # default 50
                "guidance_scale": float,      # default 1.0 (pass-1 default)
                "seed": int | None,
                "fps": float,
                "mask_dilate_px": int,        # extra, on top of VOID's own 11
                "sample_size": str | None,    # "HxW" override
            }

        Returns:
            {"video_mp4_b64", "frames_processed", "width", "height",
             "latency_s", "gen_latency_s"}
        """
        import numpy as np
        from PIL import Image as PILImage
        from PIL import ImageFilter

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
            dilate_px = int(params.get("mask_dilate_px", 0))

            # ── Per-sequence input directory (VOID's expected layout) ──────
            seq = "nexus8-job"
            seq_dir = work / "data" / seq
            seq_dir.mkdir(parents=True)

            # input_video.mp4 — lossless-ish encode of the staged frames.
            enc_dir = work / "rgb"
            enc_dir.mkdir()
            for i, p in enumerate(frame_paths):
                shutil.copy(p, enc_dir / f"f_{i:06d}.jpg")
            subprocess.run(
                ["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(fps),
                 "-i", str(enc_dir / "f_%06d.jpg"),
                 "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "10",
                 str(seq_dir / "input_video.mp4")],
                check=True,
            )

            # quadmask_0.mp4 — 0=remove, 255=keep; lossless luma so the
            # 4-level semantics survive encoding. Interaction/overlap regions
            # left empty on the first pass (plan 2.3).
            qm_dir = work / "qm"
            qm_dir.mkdir()
            masked_frames = 0
            for i in range(n):
                mp = mask_by_index.get(i)
                if mp:
                    m = PILImage.open(mp)
                    m = m.getchannel("A") if m.mode == "RGBA" else m.convert("L")
                    if m.size != (src_w, src_h):
                        m = m.resize((src_w, src_h), PILImage.NEAREST)
                    if dilate_px > 0:
                        m = m.filter(ImageFilter.MaxFilter(dilate_px * 2 + 1))
                    obj = np.array(m) > 127
                    masked_frames += bool(obj.any())
                else:
                    obj = np.zeros((src_h, src_w), dtype=bool)
                quad = np.full((src_h, src_w), 255, dtype="uint8")
                quad[obj] = 0
                PILImage.fromarray(quad).save(qm_dir / f"f_{i:06d}.png")
            subprocess.run(
                ["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(fps),
                 "-i", str(qm_dir / "f_%06d.png"),
                 "-c:v", "libx264", "-pix_fmt", "yuv420p", "-qp", "0",
                 str(seq_dir / "quadmask_0.mp4")],
                check=True,
            )

            (seq_dir / "prompt.json").write_text(
                json.dumps({"bg": params.get("prompt") or ""})
            )

            sample_size = params.get("sample_size") or _fit_sample_size(src_w, src_h)
            out_dir = work / "out"
            cmd = [
                "python", f"{VOID_SRC}/inference/cogvideox_fun/predict_v2v.py",
                "--config", f"{VOID_SRC}/config/quadmask_cogvideox.py",
                f"--config.data.data_rootdir={work / 'data'}",
                f"--config.experiment.run_seqs={seq}",
                f"--config.experiment.save_path={out_dir}",
                f"--config.video_model.model_name={BASE_MODEL_DIR}",
                f"--config.video_model.transformer_path={VOID_WEIGHTS_DIR}/void_pass1.safetensors",
                f"--config.data.sample_size={sample_size}",
                f"--config.data.max_video_length={n}",
                # abseil int flag — floats are rejected at parse time.
                f"--config.data.fps={int(round(fps))}",
                f"--config.video_model.num_inference_steps={int(params.get('num_inference_steps', 50))}",
                f"--config.video_model.guidance_scale={float(params.get('guidance_scale', 1.0))}",
            ]
            seed = params.get("seed")
            if seed is not None:
                cmd.append(f"--config.system.seed={int(seed)}")

            print(f"{n} frames {src_w}x{src_h} → sample_size {sample_size}, "
                  f"{masked_frames} with mask; launching VOID pass 1 …")
            t_gen = time.time()
            proc = subprocess.run(cmd, cwd=VOID_SRC, capture_output=True, text=True)
            # Surface the tail of both streams — the script's own logging is
            # the only visibility into windowed-inference progress/failures.
            print(proc.stdout[-3000:])
            if proc.returncode != 0:
                print(proc.stderr[-3000:])
                raise RuntimeError(
                    f"VOID inference failed (rc={proc.returncode}): "
                    f"{proc.stderr[-500:]}"
                )
            gen_latency = time.time() - t_gen

            results = [p for p in out_dir.rglob("*.mp4")
                       if not p.name.endswith("_tuple.mp4")]
            if not results:
                raise RuntimeError(
                    f"VOID produced no output mp4 in {out_dir}; "
                    f"stdout tail: {proc.stdout[-500:]}"
                )
            mp4_bytes = results[0].read_bytes()

            # Probe output dims for the caller.
            probe = subprocess.run(
                ["ffprobe", "-v", "error", "-select_streams", "v:0",
                 "-show_entries", "stream=width,height", "-of", "json",
                 str(results[0])],
                capture_output=True, text=True,
            )
            dims = {}
            try:
                stream = json.loads(probe.stdout)["streams"][0]
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
            }
        finally:
            shutil.rmtree(frames_dir, ignore_errors=True)
            shutil.rmtree(masks_dir, ignore_errors=True)
            shutil.rmtree(work, ignore_errors=True)
