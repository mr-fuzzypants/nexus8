"""GAN-based magic erase on Modal: BigLaMa (Apache 2.0, commercial OK).

Deployed separately:  modal deploy modal_functions/lama.py
Local test:           modal run modal_functions/lama.py --image photo.jpg --mask erase.png

Django calls it via modal.Cls.from_name("nexus8-lama", "Eraser").

simple-lama-inpainting wraps the big-lama GAN checkpoint. No diffusion steps —
inference is ~0.3 s warm regardless of GPU. Excellent at structure-preserving fill
(textures, backgrounds, repetitive patterns). No prompt or reference needed.

Mask format: white = erase region (matches rasterizeMask white-on-transparent output;
SimpleLama composites the alpha channel correctly).
"""

import io

import modal

app = modal.App("nexus8-lama")


def _download_weights():
    # SimpleLama() downloads big-lama on first instantiation; calling it here
    # bakes the checkpoint into the image layer so cold starts skip the download.
    from simple_lama_inpainting import SimpleLama

    SimpleLama()


image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "torch",
        "simple-lama-inpainting",
        "Pillow",
    )
    .run_function(_download_weights)
)


@app.cls(image=image, gpu="A10G", timeout=60, scaledown_window=300)
class Eraser:
    @modal.enter()
    def load(self):
        from simple_lama_inpainting import SimpleLama

        self.lama = SimpleLama()

    @modal.method()
    def erase(
        self,
        image_bytes: bytes,
        mask_bytes: bytes,
    ) -> bytes:
        from PIL import Image

        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        # White pixels = erase region; SimpleLama accepts L-mode masks directly.
        mask = Image.open(io.BytesIO(mask_bytes)).convert("L")

        result = self.lama(image, mask)

        buf = io.BytesIO()
        result.save(buf, "PNG")
        return buf.getvalue()


@app.local_entrypoint()
def main(image: str, mask: str, out: str = "erase_out.png"):
    png = Eraser().erase.remote(
        open(image, "rb").read(),
        open(mask, "rb").read(),
    )
    with open(out, "wb") as f:
        f.write(png)
    print(f"Saved to {out}")
