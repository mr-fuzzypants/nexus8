"""Scribble-to-image on Modal: FLUX.1-schnell + InstantX FLUX ControlNet Union.

Deployed separately:  modal deploy modal_functions/scribble.py
Local test:           modal run modal_functions/scribble.py --scribble s.png --prompt "a red barn"

Django calls it via modal.Cls.from_name("nexus8-scribble", "ScribbleGenerator").

Model licenses:
  - FLUX.1-schnell: black-forest-labs/FLUX.1-schnell (Apache 2.0, commercial OK)
  - ControlNet: InstantX/FLUX.1-dev-Controlnet-Union (Apache 2.0, commercial OK)
    Architecture is identical to FLUX.1-schnell — weights are cross-compatible.

Frontend sends black-strokes-on-white (rasterizeScribble). We invert it to
white-edges-on-black before passing to the canny-mode ControlNet (control_mode=0).

FLUX.1-schnell is a distilled model — guidance_scale is fixed at 0. The only
meaningful quality lever is controlnet_conditioning_scale: lower (0.4–0.6) for
loose/rudimentary sketches, higher (0.7–0.9) to follow strokes more tightly.
"""

import io

import modal

app = modal.App("nexus8-scribble")

FLUX_REPO = "black-forest-labs/FLUX.1-schnell"
CONTROLNET_REPO = "InstantX/FLUX.1-dev-Controlnet-Union"


def _download_weights():
    import os
    from huggingface_hub import login, snapshot_download

    token = os.environ.get("HF_TOKEN")
    if token:
        login(token=token)

    snapshot_download(FLUX_REPO)
    snapshot_download(CONTROLNET_REPO)


image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "torch",
        "diffusers>=0.31.0",
        "transformers",
        "accelerate",
        "safetensors",
        "Pillow",
        "huggingface_hub",
        "sentencepiece",
    )
    .run_function(_download_weights, secrets=[modal.Secret.from_name("huggingface")])
)


def _fit_dims(width: int, height: int, max_dim: int = 1024) -> tuple[int, int]:
    """Scale so the longest side equals max_dim, rounded to multiples of 16
    (FLUX VAE requirement).

    Upscaling small inputs matters (lesson from sketch_inpaint): diffusion
    models degrade badly when run far below their training resolution, so a
    small region crop must be enlarged to the working resolution before
    generation and scaled back down on paste.
    """
    scale = max_dim / max(width, height)
    return (max(16, int(width * scale) // 16 * 16), max(16, int(height * scale) // 16 * 16))


def _encode(img, output_format: str) -> bytes:
    """PNG for stored/quality results; JPEG (quality 88) for throwaway drafts —
    encodes several times faster and transfers ~5-10x fewer bytes."""
    buf = io.BytesIO()
    if output_format == "jpeg":
        img.save(buf, "JPEG", quality=88)
    else:
        img.save(buf, "PNG")
    return buf.getvalue()


# A100-80GB required: FLUX.1-schnell weights alone total ~38 GB in bfloat16
# (transformer ~24 GB + T5-XXL ~9.5 GB + ControlNet ~3.3 GB + CLIP/VAE), which
# leaves a 40 GB card no headroom for batched activations — num_variants=4 at
# 1024px OOMs in the ControlNet attention at step 0. The 80 GB card fits the
# batch with room to spare. expandable_segments avoids allocator fragmentation
# (the 40 GB OOM showed ~500 MB reserved-but-unallocated).
@app.cls(
    image=image.env({"PYTORCH_CUDA_ALLOC_CONF": "expandable_segments:True"}),
    gpu="A100-80GB",
    timeout=180,
    scaledown_window=300,
)
class ScribbleGenerator:
    @modal.enter()
    def load(self):
        import torch
        from diffusers import FluxControlNetModel, FluxControlNetPipeline

        controlnet = FluxControlNetModel.from_pretrained(
            CONTROLNET_REPO, torch_dtype=torch.bfloat16
        )
        self.pipe = FluxControlNetPipeline.from_pretrained(
            FLUX_REPO,
            controlnet=controlnet,
            torch_dtype=torch.bfloat16,
        ).to("cuda")
        # Decode batch latents one image at a time — keeps the VAE decode from
        # spiking VRAM when num_variants > 1 (lesson from sketch_inpaint).
        self.pipe.vae.enable_slicing()

    @modal.method()
    def generate(
        self,
        scribble_bytes: bytes,
        prompt: str,
        negative_prompt: str = "",
        width: int = 1024,
        height: int = 1024,
        controlnet_scale: float = 0.6,
        guidance_scale: float = 0,  # retained for API compat; schnell ignores CFG
        seed: int | None = None,
        source_bytes: bytes | None = None,
        mask_dims: dict | None = None,
        num_variants: int = 1,
        num_inference_steps: int = 4,
        max_dim: int = 1024,
        output_format: str = "png",
    ) -> list[bytes]:
        """Returns one PNG per variant (list of length num_variants).

        Leonardo-style realtime flow: schnell is a 4-step distilled model, so a
        single image lands in a couple of seconds; variants run as one batch
        (num_images_per_prompt), which costs far less than N sequential calls.
        Variant i uses seed base_seed + i — same reproducibility rule as
        sketch_inpaint, and what Django assumes when reporting per-variant seeds.
        """
        import torch
        from PIL import Image, ImageDraw, ImageFilter, ImageOps

        num_variants = max(1, min(4, int(num_variants)))
        # schnell degrades below 2 steps and gains nothing past ~8.
        num_inference_steps = max(1, min(8, int(num_inference_steps)))
        # Draft runs pass a lower max_dim (e.g. 576): FLUX cost scales with
        # latent token count ∝ pixel area, so 576px is ~3x faster per step.
        max_dim = max(256, min(1024, int(max_dim)))
        if seed is None:
            seed = int(torch.randint(0, 2**31 - 1, (1,)).item())
        generators = [torch.Generator("cuda").manual_seed(seed + i) for i in range(num_variants)]

        scribble = Image.open(io.BytesIO(scribble_bytes)).convert("RGB")

        # Region mode: crop scribble to the marked area, generate, paste back.
        if source_bytes is not None and mask_dims is not None:
            return self._generate_region(
                scribble,
                source_bytes,
                mask_dims,
                prompt,
                controlnet_scale,
                generators,
                num_variants,
                num_inference_steps,
                max_dim,
                output_format,
            )

        # Full-image mode — generate a whole new image from the sketch.
        work_w, work_h = _fit_dims(width, height, max_dim)
        if scribble.size != (work_w, work_h):
            scribble = scribble.resize((work_w, work_h), Image.LANCZOS)
        control_image = ImageOps.invert(scribble)

        images = self.pipe(
            prompt=prompt,
            control_image=control_image,
            controlnet_conditioning_scale=controlnet_scale,
            control_mode=0,
            num_inference_steps=num_inference_steps,
            guidance_scale=0,
            width=work_w,
            height=work_h,
            num_images_per_prompt=num_variants,
            generator=generators,
        ).images

        outputs = []
        for result in images:
            # Drafts (jpeg) skip the upscale back to canvas size — the browser
            # stretches the small image over the image rect anyway, and skipping
            # it saves both resize and encode time.
            if output_format != "jpeg" and result.size != (width, height):
                result = result.resize((width, height), Image.LANCZOS)
            outputs.append(_encode(result, output_format))
        return outputs

    def _generate_region(
        self,
        scribble,
        source_bytes: bytes,
        mask_dims: dict,
        prompt: str,
        controlnet_scale: float,
        generators,
        num_variants: int,
        num_inference_steps: int,
        max_dim: int = 1024,
        output_format: str = "png",
    ) -> list[bytes]:
        """Crop the scribble to mask_dims, generate a batch, paste each back
        into the source image. Returns one composited image per variant."""
        from PIL import Image, ImageDraw, ImageFilter, ImageOps

        source = Image.open(io.BytesIO(source_bytes)).convert("RGB")
        src_w, src_h = source.size

        x = int(mask_dims.get("x", 0))
        y = int(mask_dims.get("y", 0))
        w = int(mask_dims.get("w", src_w))
        h = int(mask_dims.get("h", src_h))

        # Expand the crop by 10% on each side so generated edges blend naturally.
        pad = max(24, int(min(w, h) * 0.12))
        x0 = max(0, x - pad)
        y0 = max(0, y - pad)
        x1 = min(src_w, x + w + pad)
        y1 = min(src_h, y + h + pad)

        # Resize scribble map to match source dims if needed, then crop.
        if scribble.size != source.size:
            scribble = scribble.resize(source.size, Image.LANCZOS)
        scribble_crop = scribble.crop((x0, y0, x1, y1))

        crop_w, crop_h = x1 - x0, y1 - y0
        work_w, work_h = _fit_dims(crop_w, crop_h, max_dim)
        control_image = ImageOps.invert(scribble_crop.resize((work_w, work_h), Image.LANCZOS))

        images = self.pipe(
            prompt=prompt,
            control_image=control_image,
            controlnet_conditioning_scale=controlnet_scale,
            control_mode=0,
            num_inference_steps=num_inference_steps,
            guidance_scale=0,
            width=work_w,
            height=work_h,
            num_images_per_prompt=num_variants,
            generator=generators,
        ).images

        # Feathered mask: solid white over the sketch bbox, blurred edges.
        # Built once — shared by every variant composite.
        blend_mask = Image.new("L", (src_w, src_h), 0)
        ImageDraw.Draw(blend_mask).rectangle([x, y, x + w, y + h], fill=255)
        blend_mask = blend_mask.filter(ImageFilter.GaussianBlur(radius=max(10, pad // 2)))
        blend_crop = blend_mask.crop((x0, y0, x1, y1))

        outputs = []
        for result in images:
            result_crop = result.resize((crop_w, crop_h), Image.LANCZOS)
            output = source.copy()
            output.paste(result_crop, (x0, y0), blend_crop)
            outputs.append(_encode(output, output_format))
        return outputs


@app.local_entrypoint()
def main(
    scribble: str,
    prompt: str,
    controlnet_scale: float = 0.6,
    seed: int = -1,
    out: str = "scribble_out.png",
    width: int = 1024,
    height: int = 1024,
):
    pngs = ScribbleGenerator().generate.remote(
        open(scribble, "rb").read(),
        prompt,
        width=width,
        height=height,
        controlnet_scale=controlnet_scale,
        seed=seed if seed >= 0 else None,
    )
    with open(out, "wb") as f:
        f.write(pngs[0])
    print(f"Saved to {out}")
