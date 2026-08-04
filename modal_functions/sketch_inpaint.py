"""Sketch-guided inpainting on Modal: SDXL + xinsir ControlNet Scribble + inpaint pipeline.

Deployed separately:  modal deploy modal_functions/sketch_inpaint.py
Local test:           modal run modal_functions/sketch_inpaint.py \
                        --source photo.jpg --scribble s.png \
                        --mask-x 100 --mask-y 100 --mask-w 400 --mask-h 300 \
                        --prompt "a vase of sunflowers"

Django: modal.Cls.from_name("nexus8-sketch-inpaint", "SketchInpainter")

Unlike scribble.py (which generates a whole new image), this pipeline sees the
full source image as context — so generated content matches surrounding lighting,
perspective, and style. Only the masked region is changed.

Model licenses:
  - SDXL: stabilityai/stable-diffusion-xl-base-1.0 (CreativeML OpenRAIL++-M, commercial OK)
  - ControlNet: xinsir/controlnet-scribble-sdxl-1.0 (Apache 2.0, commercial OK)

Frontend sends:
  - scribble_bytes  black strokes on white (rasterizeScribble format)
  - source_bytes    full source image
  - mask_dims       {x, y, w, h} in image-pixel coords — the region to fill
  - prompt          what to generate there
"""

import io

import modal

app = modal.App("nexus8-sketch-inpaint")

SDXL_REPO = "stabilityai/stable-diffusion-xl-base-1.0"
CONTROLNET_REPO = "xinsir/controlnet-scribble-sdxl-1.0"
IP_ADAPTER_REPO = "h94/IP-Adapter"


def _download_weights():
    from huggingface_hub import snapshot_download

    snapshot_download(SDXL_REPO)
    snapshot_download(CONTROLNET_REPO)
    # IP-Adapter for optional image-reference conditioning. The vit-h variant
    # uses the ~630M-param ViT-H image encoder rather than ViT-bigG — much less
    # VRAM alongside SDXL + ControlNet + a 4-image batch.
    snapshot_download(
        IP_ADAPTER_REPO,
        allow_patterns=[
            "sdxl_models/ip-adapter_sdxl_vit-h.safetensors",
            "models/image_encoder/*",
        ],
    )


image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "torch",
        "diffusers>=0.27.0",
        "transformers",
        "accelerate",
        "safetensors",
        "Pillow",
        "huggingface_hub",
    )
    .run_function(_download_weights)
)


def _fit_dims(width: int, height: int, max_dim: int = 1024) -> tuple[int, int]:
    """Scale so the longest side equals max_dim, rounded to multiples of 8
    (SDXL VAE requirement).

    Upscaling small inputs is essential, not optional: SDXL is trained at
    ~1024px and produces multicolour noise at far smaller resolutions. A small
    crop (e.g. 300px around a small mask) must be enlarged to the working
    resolution before diffusion, then the result is scaled back down on paste.
    """
    scale = max_dim / max(width, height)
    return (max(8, int(width * scale) // 8 * 8), max(8, int(height * scale) // 8 * 8))


@app.cls(image=image, gpu="A10G", timeout=120, scaledown_window=300)
class SketchInpainter:
    @modal.enter()
    def load(self):
        import torch
        from diffusers import ControlNetModel, StableDiffusionXLControlNetInpaintPipeline

        controlnet = ControlNetModel.from_pretrained(CONTROLNET_REPO, torch_dtype=torch.float16)
        self.pipe = StableDiffusionXLControlNetInpaintPipeline.from_pretrained(
            SDXL_REPO,
            controlnet=controlnet,
            torch_dtype=torch.float16,
            variant="fp16",
        ).to("cuda")
        # Decode batch latents one image at a time. The VAE decode is the VRAM
        # spike of the pipeline at 1024px; without slicing a num_variants=4
        # batch can OOM the A10G's 24 GB.
        self.pipe.enable_vae_slicing()
        # IP-Adapter is always loaded but defaults to scale 0 (no effect). A
        # zero scale with a neutral placeholder image makes reference-free runs
        # behave identically to a pipeline without the adapter, so callers can
        # treat the reference as fully optional.
        self.pipe.load_ip_adapter(
            IP_ADAPTER_REPO,
            subfolder="sdxl_models",
            weight_name="ip-adapter_sdxl_vit-h.safetensors",
            image_encoder_folder="models/image_encoder",
        )
        self.pipe.set_ip_adapter_scale(0.0)

    @modal.method()
    def generate(
        self,
        scribble_bytes: bytes,
        source_bytes: bytes,
        mask_dims: dict,
        prompt: str,
        negative_prompt: str = "",
        controlnet_scale: float = 0.4,
        num_inference_steps: int = 20,
        guidance_scale: float = 7.5,
        seed: int | None = None,
        num_variants: int = 1,
        strength: float = 1.0,
        reference_bytes: bytes | None = None,
        reference_scale: float = 0.5,
    ) -> list[bytes]:
        """Returns one composited PNG per variant (list of length num_variants).

        Variants are generated as a single batch (num_images_per_prompt), so one
        GPU call produces all of them at roughly 1.6-1.8x single-image latency
        per doubling rather than Nx. Variant i uses seed base_seed + i, making
        each individually reproducible.
        """
        import torch
        from PIL import Image, ImageDraw, ImageFilter

        source = Image.open(io.BytesIO(source_bytes)).convert("RGB")
        src_w, src_h = source.size

        # Mask dims arrive in original image pixel coordinates.
        x = int(mask_dims.get("x", 0))
        y = int(mask_dims.get("y", 0))
        w = max(8, int(mask_dims.get("w", src_w)))
        h = max(8, int(mask_dims.get("h", src_h)))

        # --- Crop-and-paste strategy ---
        # Instead of downscaling the entire source image to ≤1024px (SDXL's
        # working resolution), we crop a padded region around the mask and run
        # diffusion on that crop. This gives SDXL's full resolution budget to
        # the area that actually matters, producing sharper detail — especially
        # when the mask is small relative to a large source image.
        #
        # The padding preserves enough surrounding context for the model to
        # match lighting, colour, and style at the boundary. Using max(w, h)
        # as the pad ensures the context band is at least as wide as the mask
        # itself; it naturally shrinks when the mask is already large relative
        # to the image (hitting the image boundary), which gracefully degrades
        # to the original whole-image approach in that limit.
        pad = max(64, max(w, h))
        crop_x1 = max(0, x - pad)
        crop_y1 = max(0, y - pad)
        crop_x2 = min(src_w, x + w + pad)
        crop_y2 = min(src_h, y + h + pad)
        crop_w = crop_x2 - crop_x1
        crop_h = crop_y2 - crop_y1

        crop = source.crop((crop_x1, crop_y1, crop_x2, crop_y2))

        # Resize the crop (not the whole image) to SDXL's working resolution.
        # The full 1024px budget now covers only the crop, so the generated
        # region has proportionally higher pixel density than the old approach.
        work_w, work_h = _fit_dims(crop_w, crop_h)
        crop_work = crop.resize((work_w, work_h), Image.LANCZOS)

        # Translate the mask rect from source coords → crop coords → working coords.
        sx = work_w / crop_w
        sy = work_h / crop_h
        mx = int((x - crop_x1) * sx)
        my = int((y - crop_y1) * sy)
        mw = max(8, int(w * sx))
        mh = max(8, int(h * sy))

        # ControlNet conditioning: frontend sends black strokes on white.
        # Normalize the scribble to source size first (its canvas resolution may
        # differ), then crop and resize to match the working crop exactly.
        scribble = Image.open(io.BytesIO(scribble_bytes)).convert("RGB")
        if scribble.size != (src_w, src_h):
            scribble = scribble.resize((src_w, src_h), Image.LANCZOS)
        scribble_work = scribble.crop((crop_x1, crop_y1, crop_x2, crop_y2))
        if scribble_work.size != (work_w, work_h):
            scribble_work = scribble_work.resize((work_w, work_h), Image.LANCZOS)

        # Derive the inpaint mask from the drawn outline rather than a plain
        # bounding box rectangle. An ellipse outline gives a circular mask; a
        # brush circle gives an approximately circular mask; etc.
        #
        # Method: flood-fill the *entire* scribble_work from (0, 0) to mark exterior.
        # We cannot crop to the mask patch first — the ellipse outline lands exactly
        # at the mask bounds, so every border pixel of the tight patch is dark stroke
        # and no exterior seed can be found. scribble_work is the padded crop, so
        # (0, 0) is always in white background well outside the drawn shape.
        # After the fill, crop to the mask region: enclosed interior → circular mask.
        EXTERIOR = 128  # marker distinct from binary 0 (drawn) and 255 (bg/interior)
        binary_full = scribble_work.convert("L").point(lambda p: 255 if p > 128 else 0)
        flooded = binary_full.copy()
        if binary_full.getpixel((0, 0)) == 255:
            ImageDraw.floodfill(flooded, (0, 0), EXTERIOR, thresh=0)
        # Crop the result to the mask region: not-exterior = enclosed shape
        mask_patch = flooded.crop((mx, my, mx + mw, my + mh)).point(
            lambda p: 0 if p == EXTERIOR else 255
        )
        mask_coverage = sum(1 for p in mask_patch.getdata() if p > 0) / (mw * mh)
        if mask_coverage < 0.05:
            # Flood leaked through gaps or drawing is too sparse — fall back to rectangle.
            mask = Image.new("L", (work_w, work_h), 0)
            ImageDraw.Draw(mask).rectangle([mx, my, mx + mw, my + mh], fill=255)
        else:
            mask = Image.new("L", (work_w, work_h), 0)
            mask.paste(mask_patch, (mx, my))
        # Feathered edges blend the generated content into the surrounding crop.
        mask = mask.filter(ImageFilter.GaussianBlur(radius=max(6, min(mw, mh) // 12)))

        # Restrict ControlNet guidance to the mask region only.
        # The scribble ControlNet applies structural conditioning globally across
        # the whole crop. Outside the mask, the inpaint pipeline simultaneously
        # tries to preserve the source pixels — these two signals conflict and
        # produce colour smearing at the boundary. Blanking the guide to white
        # (neutral = no edge constraint) outside the mask region eliminates that
        # conflict: the ControlNet only directs what is generated, not what is kept.
        guide = Image.new("RGB", (work_w, work_h), (255, 255, 255))
        guide.paste(scribble_work.crop((mx, my, mx + mw, my + mh)), (mx, my))

        # Optional image reference (IP-Adapter). Fail-soft: undecodable or
        # missing bytes degrade to a plain run — a neutral gray placeholder at
        # scale 0.0 contributes nothing to the attention output.
        ref_image = None
        if reference_bytes:
            try:
                ref_image = Image.open(io.BytesIO(reference_bytes)).convert("RGB")
            except Exception:
                ref_image = None
        if ref_image is not None:
            self.pipe.set_ip_adapter_scale(max(0.0, min(1.0, float(reference_scale))))
        else:
            ref_image = Image.new("RGB", (224, 224), (128, 128, 128))
            self.pipe.set_ip_adapter_scale(0.0)

        num_variants = max(1, min(4, int(num_variants)))
        if seed is None:
            seed = int(torch.randint(0, 2**31 - 1, (1,)).item())
        # One generator per batch image with consecutive seeds, so variant i is
        # individually reproducible by re-running with seed = base_seed + i.
        # Django derives per-variant seeds with the same base+index rule.
        generators = [torch.Generator("cuda").manual_seed(seed + i) for i in range(num_variants)]

        # Run diffusion on the crop. The model sees the padded surroundings as
        # context but only modifies the masked region. strength=1.0 fully
        # replaces those pixels from noise; lower values initialize from the
        # source pixels so the result stays structurally closer to the original
        # (effective step count = num_inference_steps * strength).
        # All variants run as one batch.
        strength = min(1.0, max(0.05, float(strength)))
        images = self.pipe(
            prompt=prompt,
            negative_prompt=negative_prompt or None,
            image=crop_work,
            mask_image=mask,
            control_image=guide,
            ip_adapter_image=ref_image,
            width=work_w,
            height=work_h,
            num_inference_steps=num_inference_steps,
            guidance_scale=guidance_scale,
            controlnet_conditioning_scale=controlnet_scale,
            strength=strength,
            num_images_per_prompt=num_variants,
            generator=generators,
        ).images

        # Build a feathered paste mask in crop space. Only the mask region
        # (expressed in crop-local coordinates) fades in; the surrounding crop
        # pixels are invisible in the composite, so no crop-boundary seam appears
        # in the final output even if diffusion slightly altered those pixels.
        paste_mask = Image.new("L", (crop_w, crop_h), 0)
        ImageDraw.Draw(paste_mask).rectangle(
            [x - crop_x1, y - crop_y1, x - crop_x1 + w, y - crop_y1 + h], fill=255
        )
        paste_mask = paste_mask.filter(ImageFilter.GaussianBlur(radius=max(6, min(w, h) // 12)))

        outputs = []
        for result in images:
            # Scale the diffusion result back to the crop's original pixel
            # dimensions before pasting — this restores any detail lost in the
            # initial downscale.
            if result.size != (crop_w, crop_h):
                result = result.resize((crop_w, crop_h), Image.LANCZOS)

            # Composite the generated crop back onto the original full-resolution
            # source. paste() with a mask blends result pixels (mask=255) over
            # source pixels (mask=0) at the crop offset, leaving everything
            # outside the crop untouched.
            out = source.copy()
            out.paste(result, (crop_x1, crop_y1), paste_mask)

            buf = io.BytesIO()
            out.save(buf, "PNG")
            outputs.append(buf.getvalue())
        return outputs


@app.local_entrypoint()
def main(
    source: str,
    scribble: str,
    prompt: str,
    mask_x: int = 0,
    mask_y: int = 0,
    mask_w: int = 512,
    mask_h: int = 512,
    controlnet_scale: float = 0.7,
    seed: int = -1,
    out: str = "sketch_inpaint_out.png",
):
    pngs = SketchInpainter().generate.remote(
        open(scribble, "rb").read(),
        open(source, "rb").read(),
        {"x": mask_x, "y": mask_y, "w": mask_w, "h": mask_h},
        prompt,
        controlnet_scale=controlnet_scale,
        seed=seed if seed >= 0 else None,
    )
    with open(out, "wb") as f:
        f.write(pngs[0])
    print(f"Saved to {out}")
