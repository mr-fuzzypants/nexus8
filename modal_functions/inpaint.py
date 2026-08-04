"""Fast prompted inpainting on Modal (SDXL-inpainting + LCM-LoRA, lazy IP-Adapter).

Deployed separately from Django:  modal deploy modal_functions/inpaint.py
Local test:                       modal run modal_functions/inpaint.py --image t.jpg --mask m.png --prompt "..."

Django addresses it via modal.Cls.from_name("nexus8-inpaint", "Inpainter").

See SRED_INPAINT_EXPERIMENT.md Phase 2. Design choices:
- LCM-LoRA at low step counts (default 6) targets preview-quality output in
  ~1-2s warm inference (hypothesis H3).
- One deployment serves both text-only and reference-guided requests: the
  IP-Adapter loads lazily on the first reference request and is neutralized
  with scale 0.0 for subsequent text-only calls (hypothesis H4).
- No warm containers (min_containers) by user decision — cold starts accepted;
  scaledown_window keeps the container alive ~5 min between requests.
"""

import io

import modal

app = modal.App("nexus8-inpaint")

SDXL_INPAINT_REPO = "diffusers/stable-diffusion-xl-1.0-inpainting-0.1"
LCM_LORA_REPO = "latent-consistency/lcm-lora-sdxl"
IP_ADAPTER_REPO = "h94/IP-Adapter"


def _download_weights():
    from huggingface_hub import snapshot_download

    snapshot_download(SDXL_INPAINT_REPO)
    snapshot_download(LCM_LORA_REPO)
    snapshot_download(IP_ADAPTER_REPO, allow_patterns=["sdxl_models/*"])


image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "torch",
        "diffusers",
        "transformers",
        "accelerate",
        "peft",
        "safetensors",
        "Pillow",
        "huggingface_hub",
    )
    # Bake weights into the image layer: cold start pays only disk->GPU load,
    # never a network download.
    .run_function(_download_weights)
)


def _fit_dims(width: int, height: int, max_dim: int = 1024) -> tuple[int, int]:
    """Scale to fit max_dim, rounded down to multiples of 8 (SDXL requirement)."""
    scale = min(1.0, max_dim / max(width, height))
    return (max(8, int(width * scale) // 8 * 8), max(8, int(height * scale) // 8 * 8))


@app.cls(image=image, gpu="A10G", timeout=120, scaledown_window=300)
class Inpainter:
    @modal.enter()
    def load(self):
        import torch
        from diffusers import AutoPipelineForInpainting, LCMScheduler

        pipe = AutoPipelineForInpainting.from_pretrained(
            SDXL_INPAINT_REPO,
            torch_dtype=torch.float16,
            variant="fp16",
        ).to("cuda")
        # LCM LoRA stays UNFUSED so requests can switch between fast (LCM,
        # guidance 1-2: great harmonization/removal, weak object insertion) and
        # quality (base scheduler, real CFG: slower but prompt-adherent).
        # Experiment finding 2026-07: LCM at guidance <=2.0 cannot insert new
        # objects ("a snowman" yields harmonized snow), so fast-only is not enough.
        self.base_scheduler = pipe.scheduler
        self.lcm_scheduler = LCMScheduler.from_config(pipe.scheduler.config)
        pipe.load_lora_weights(LCM_LORA_REPO)
        self.pipe = pipe
        self.ip_adapter_loaded = False

    def _apply_mode(self, fast: bool):
        if fast:
            self.pipe.scheduler = self.lcm_scheduler
            self.pipe.enable_lora()
        else:
            self.pipe.scheduler = self.base_scheduler
            self.pipe.disable_lora()

    @modal.method()
    def inpaint(
        self,
        image_bytes: bytes,
        mask_bytes: bytes,
        prompt: str,
        negative_prompt: str = "",
        reference_bytes: bytes | None = None,
        num_inference_steps: int | None = None,
        guidance_scale: float | None = None,
        seed: int | None = None,
        mode: str = "fast",
        strength: float = 0.99,
    ) -> bytes:
        import torch
        from PIL import Image

        fast = mode != "quality"
        self._apply_mode(fast)
        if num_inference_steps is None:
            num_inference_steps = 6 if fast else 20
        if guidance_scale is None:
            guidance_scale = 1.5 if fast else 7.0
        print(
            f"inpaint: mode={mode} steps={num_inference_steps} guidance={guidance_scale} "
            f"seed={seed} prompt={prompt!r} scheduler={type(self.pipe.scheduler).__name__}"
        )

        base = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        original_size = base.size

        # The client rasterizes white-on-TRANSPARENT; diffusers needs
        # white-on-black. Compositing onto opaque black is mandatory — a bare
        # convert("L") of a transparent PNG yields a fully-white mask and the
        # whole frame regenerates.
        mask_rgba = Image.open(io.BytesIO(mask_bytes)).convert("RGBA")
        black = Image.new("RGBA", mask_rgba.size, (0, 0, 0, 255))
        mask = Image.alpha_composite(black, mask_rgba).convert("L")
        if mask.size != base.size:
            mask = mask.resize(base.size, Image.NEAREST)

        work_dims = _fit_dims(*base.size)
        base_work = base.resize(work_dims, Image.LANCZOS)
        mask_work = mask.resize(work_dims, Image.NEAREST)

        if reference_bytes is not None and not self.ip_adapter_loaded:
            self.pipe.load_ip_adapter(
                IP_ADAPTER_REPO, subfolder="sdxl_models", weight_name="ip-adapter_sdxl.bin"
            )
            self.ip_adapter_loaded = True

        kwargs = dict(
            prompt=prompt,
            negative_prompt=negative_prompt or None,
            image=base_work,
            mask_image=mask_work,
            width=work_dims[0],
            height=work_dims[1],
            num_inference_steps=num_inference_steps,
            guidance_scale=guidance_scale,
            # 0.99 = full regeneration (insert/remove); ~0.5-0.7 preserves the
            # original structure and re-styles it (recolor/material edits).
            strength=strength,
            # Crop-and-paste around the mask: makes peripheral/small masks
            # compositionally salient, without which insertion prompts get
            # background-filled even at high CFG (SRED finding F3).
            padding_mask_crop=64,
        )
        if seed is not None:
            kwargs["generator"] = torch.Generator("cuda").manual_seed(seed)
        if self.ip_adapter_loaded:
            # Once loaded the pipeline requires an ip_adapter_image every call;
            # a black pixel at scale 0.0 makes text-only calls a no-op (H4).
            if reference_bytes is not None:
                self.pipe.set_ip_adapter_scale(0.6)
                kwargs["ip_adapter_image"] = Image.open(io.BytesIO(reference_bytes)).convert("RGB")
            else:
                self.pipe.set_ip_adapter_scale(0.0)
                kwargs["ip_adapter_image"] = Image.new("RGB", (32, 32), (0, 0, 0))

        result = self.pipe(**kwargs).images[0]
        if result.size != original_size:
            result = result.resize(original_size, Image.LANCZOS)

        buf = io.BytesIO()
        result.save(buf, "PNG")
        return buf.getvalue()


@app.local_entrypoint()
def main(
    image: str,
    mask: str,
    prompt: str,
    reference: str = "",
    negative: str = "",
    steps: int = 0,
    guidance: float = 0.0,
    mode: str = "fast",
    strength: float = 0.99,
    out: str = "out.png",
    seed: int = -1,
):
    with open(image, "rb") as f:
        image_bytes = f.read()
    with open(mask, "rb") as f:
        mask_bytes = f.read()
    reference_bytes = None
    if reference:
        with open(reference, "rb") as f:
            reference_bytes = f.read()

    result = Inpainter().inpaint.remote(
        image_bytes,
        mask_bytes,
        prompt,
        negative_prompt=negative,
        reference_bytes=reference_bytes,
        num_inference_steps=steps or None,
        guidance_scale=guidance or None,
        seed=None if seed < 0 else seed,
        mode=mode,
        strength=strength,
    )
    with open(out, "wb") as f:
        f.write(result)
    print(f"wrote {out} ({len(result)} bytes)")
