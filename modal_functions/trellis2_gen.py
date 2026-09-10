"""Image-to-3D on Modal: TRELLIS.2-4B with a commercial, nvdiffrast/nvdiffrec-free export.

Deployed separately from Django:  modal deploy modal_functions/trellis2.py
Local test:                       modal run modal_functions/trellis2.py --image t.png --tier balanced
Django addresses it via modal.Cls.from_name("nexus8-trellis2", "Trellis2Generator").

See TRELLIS2_IMAGETO3D_PLAN.md + SRED_TRELLIS_IMAGETO3D_EXPERIMENT.md (Part C, Phase 0 audit).

Licensing (audit findings T-F1..T-F8):
- TRELLIS.2 code + CuMesh/FlexGEMM/o-voxel/utils3d are MIT; Eigen is MPL-2.0. We build with
  ONLY the open-source setup flags (--basic --flash-attn --cumesh --o-voxel --flexgemm) and
  NEVER --nvdiffrast/--nvdiffrec, so the NVIDIA Source Code License code is never installed.
- The stock o_voxel.postprocess.to_glb uses nvdiffrast for exactly 3 calls (rasterize UVs +
  interpolate 3D position). Everything else in that function (CuMesh clean/simplify/unwrap/BVH,
  FlexGEMM grid_sample_3d volumetric bake, cv2.inpaint gutter) is already permissive. Our
  commercial_to_glb() below keeps all of that and swaps ONLY the rasterizer (PyTorch3D).
- The image conditioner is DINOv3 (facebook/dinov3-vitl16-pretrain-lvd1689m): commercial use
  is permitted with NO MAU/revenue caps, but the weights are GATED (need an HF_TOKEN with the
  DINOv3 terms accepted) and the product must display "Built with DINOv3" + bundle the license.

STATUS: Phase 1 scaffold. The image build (below) is the Phase 1 deliverable. commercial_to_glb
is a faithful port of the audited algorithm with the rasterizer swapped, but the PyTorch3D
rasterization step is UNVALIDATED until Phase 2 (must match nvdiffrast texel coverage at 2K-4K).
Do not treat texture output as final until Phase 2 sign-off.
"""

import io

import modal

app = modal.App("nexus8-trellis2")

TRELLIS2_REPO = "https://github.com/microsoft/TRELLIS.2"
TRELLIS2_COMMIT = "main"  # TODO(phase1): pin to a specific SHA once the build is green
MODEL_REPO = "microsoft/TRELLIS.2-4B"
DINOV3_REPO = "facebook/dinov3-vitl16-pretrain-lvd1689m"  # gated; needs HF_TOKEN (T-F3)

# 4B weights + DINOv3 live on a Volume, not baked into the image, so rebuilds stay cheap.
weights_volume = modal.Volume.from_name("nexus8-trellis2-weights", create_if_missing=True)
CACHE_DIR = "/cache"

# HF token secret (must have DINOv3 terms accepted). Create with:
#   modal secret create huggingface HF_TOKEN=hf_xxx
hf_secret = modal.Secret.from_name("huggingface")

# --- Image build (audited from TRELLIS.2/setup.sh; open-source flags only) ---------------
# trellis_image = the TRELLIS.2 generation stack (all MIT + DINOv3 weight). This is the
# Phase-1 deliverable and the risky part (custom CUDA kernels). Kernels compile for the
# arch list without a live GPU at build time (TORCH_CUDA_ARCH_LIST covers A100=8.0/H100=9.0).
trellis_image = (
    modal.Image.from_registry(
        "nvidia/cuda:12.4.1-devel-ubuntu22.04", add_python="3.10"
    )
    .apt_install("git", "build-essential", "ninja-build", "libgl1", "libglib2.0-0", "libjpeg-dev")
    .env({"HF_HOME": CACHE_DIR, "TORCH_CUDA_ARCH_LIST": "8.0;9.0", "PYTORCH_CUDA_ALLOC_CONF": "expandable_segments:True"})
    # torch pinned exactly as setup.sh (cu124).
    .pip_install(
        "torch==2.6.0", "torchvision==0.21.0", index_url="https://download.pytorch.org/whl/cu124"
    )
    # --basic deps (from setup.sh).
    .pip_install(
        "imageio", "imageio-ffmpeg", "tqdm", "easydict", "opencv-python-headless", "trimesh",
        "transformers", "pandas", "lpips", "zstandard", "kornia", "timm", "Pillow",
        "huggingface_hub", "numpy", "scipy",
        "git+https://github.com/EasternJournalist/utils3d.git@9a4eb15e4021b67b12c460c7057d642626897ec8",
    )
    # Build tooling must be present in-env for the --no-build-isolation source builds below
    # (flash-attn/CuMesh/FlexGEMM setup.py import wheel/packaging/ninja and need torch visible).
    .pip_install("wheel", "setuptools", "packaging", "ninja", "psutil")
    .env({"MAX_JOBS": "4"})  # cap parallel nvcc jobs so the flash-attn compile doesn't OOM
    .pip_install("flash-attn==2.7.3", extra_options="--no-build-isolation")
    # Modal's add_python ships a standalone Python whose sysconfig linker is clang++ (absent
    # here). Force gcc/g++ so torch's cpp_extension compiles AND links the kernels with the
    # build-essential toolchain. Placed after flash-attn so its (slow) build layer stays cached.
    .env({"CC": "gcc", "CXX": "g++"})
    # TRELLIS.2 custom CUDA kernels (all MIT) — built from source, no restricted deps.
    .run_commands(
        "git clone https://github.com/JeffreyXiang/CuMesh.git /tmp/CuMesh --recursive && "
        "pip install /tmp/CuMesh --no-build-isolation",
        "git clone https://github.com/JeffreyXiang/FlexGEMM.git /tmp/FlexGEMM --recursive && "
        "pip install /tmp/FlexGEMM --no-build-isolation",
    )
    # TRELLIS.2 itself (o-voxel extension + the trellis2 python package on PYTHONPATH).
    .run_commands(
        f"git clone {TRELLIS2_REPO} /root/TRELLIS.2 --recursive",
        "cp -r /root/TRELLIS.2/o-voxel /tmp/o-voxel",
        # o_voxel/__init__.py eagerly imports postprocess.py, whose top-level
        # `import nvdiffrast.torch` would drag the restricted lib into the *generation* path
        # (shape decoder -> o_voxel.convert). We replace the stock exporter anyway, so make
        # that import lazy — o_voxel then imports cleanly with nvdiffrast absent (SRED T-F1).
        "sed -i '/^import nvdiffrast\\.torch as dr$/c\\dr = None  # nvdiffrast removed (commercial); stock to_glb unused' /tmp/o-voxel/o_voxel/postprocess.py",
        "grep -n 'nvdiffrast\\|dr = None' /tmp/o-voxel/o_voxel/postprocess.py || true",
        "pip install /tmp/o-voxel --no-build-isolation",
    )
    # setup.sh leaves transformers unpinned → resolves to 5.x, which renamed the DINOv3ViT
    # internals TRELLIS.2 accesses (self.model.layer/.embeddings/.rope_embeddings). Pin to the
    # 4.x API TRELLIS.2 was written against. Late layer so flash-attn/kernels stay cached.
    .pip_install("transformers==4.57.1")
    .env({"PYTHONPATH": "/root/TRELLIS.2"})
)

# Full production image adds the commercial bake/export deps (replace nvdiffrast/nvdiffrec).
# PyTorch3D has no PyPI wheel for torch2.6/cu124 → built from source (Phase 2). It provides
# the rasterizer swap (MeshRasterizer) AND validation rendering (TexturesUV). gcc/g++ + the
# CUDA arch list are inherited from trellis_image; FORCE_CUDA builds the CUDA kernels.
image = (
    trellis_image
    .pip_install("fvcore", "iopath")
    .env({"FORCE_CUDA": "1"})
    .run_commands(
        "pip install 'git+https://github.com/facebookresearch/pytorch3d.git@stable' --no-build-isolation",
    )
    # TODO(phase3/3b): + pyrender (thumbnails) + gsplat (splat export) as later layers.
)


def _tier_to_pipeline_type(tier: str) -> str:
    return {"fast": "512", "balanced": "1024_cascade", "max": "1536_cascade"}.get(tier, "1024_cascade")


def _load_commercial_pipeline():
    """Load TRELLIS.2 with commercial-clean dependencies (container-side).

    - snapshot_download the full repo (loader needs a local dir to resolve ckpts/*).
    - Force the background remover to the permissive, ungated **ZhengPeng7/BiRefNet** (MIT):
      pipeline.json points rembg at the gated, NON-COMMERCIAL `briaai/RMBG-2.0`, but the
      BiRefNet class defaults to the original MIT model of the same architecture (SRED T-F9).
    - (DINOv3 conditioner stays; commercial-OK with attribution — T-F3.)
    """
    from huggingface_hub import snapshot_download
    from trellis2.pipelines import rembg, Trellis2ImageTo3DPipeline

    _orig_init = rembg.BiRefNet.__init__
    def _permissive_init(self, model_name="ZhengPeng7/BiRefNet"):
        _orig_init(self, "ZhengPeng7/BiRefNet")
    rembg.BiRefNet.__init__ = _permissive_init

    local_dir = snapshot_download(MODEL_REPO)
    return Trellis2ImageTo3DPipeline.from_pretrained(local_dir)


# --- Phase 1 probe: validate the clean build + generation, dump raw mesh for bake dev ------
@app.function(
    image=trellis_image, gpu="A100-80GB", timeout=1800,
    volumes={CACHE_DIR: weights_volume}, secrets=[hf_secret],
)
def probe_build(image_bytes: bytes, tier: str = "fast", seed: int = 0) -> dict:
    """Phase 1 (SRED T-F1/T-F2): confirm kernels built & generation runs WITHOUT nvdiffrast/
    nvdiffrec, then dump mesh.{vertices,faces,attrs,coords,layout,voxel_size} to the Volume."""
    import os, sys, io
    os.environ["OPENCV_IO_ENABLE_OPENEXR"] = "1"
    import numpy as np
    import torch
    from PIL import Image

    # Assertion: the generation import graph must not have pulled the restricted libs.
    restricted = [m for m in ("nvdiffrast", "nvdiffrec", "nvdiffrec_render") if m in sys.modules]
    assert not restricted, f"restricted deps imported by generation: {restricted}"

    pipeline = _load_commercial_pipeline()
    pipeline.cuda()
    weights_volume.commit()

    img = Image.open(io.BytesIO(image_bytes)).convert("RGBA")
    outputs = pipeline.run(img, seed=seed, pipeline_type=_tier_to_pipeline_type(tier))
    mesh = outputs[0]

    restricted_after = [m for m in ("nvdiffrast", "nvdiffrec", "nvdiffrec_render") if m in sys.modules]

    dump_path = f"{CACHE_DIR}/phase1_dump_{tier}.npz"
    layout = {k: (v.start, v.stop) for k, v in mesh.layout.items()}
    np.savez(
        dump_path,
        vertices=mesh.vertices.detach().cpu().numpy(),
        faces=mesh.faces.detach().cpu().numpy(),
        attrs=mesh.attrs.detach().cpu().numpy(),
        coords=mesh.coords.detach().cpu().numpy(),
        voxel_size=np.asarray(mesh.voxel_size if not torch.is_tensor(mesh.voxel_size)
                              else mesh.voxel_size.detach().cpu().numpy()),
        layout_keys=np.array(list(layout.keys())),
        layout_slices=np.array([layout[k] for k in layout]),
    )
    weights_volume.commit()

    return {
        "restricted_after_gen": restricted_after,
        "num_vertices": int(mesh.vertices.shape[0]),
        "num_faces": int(mesh.faces.shape[0]),
        "attr_volume_shape": list(mesh.attrs.shape),
        "coords_shape": list(mesh.coords.shape),
        "attr_layout": layout,
        "voxel_size": (mesh.voxel_size.tolist() if torch.is_tensor(mesh.voxel_size)
                       else mesh.voxel_size),
        "dump_path": dump_path,
    }


@app.function(
    image=trellis_image, gpu="A100-80GB", timeout=1800,
    volumes={CACHE_DIR: weights_volume}, secrets=[hf_secret],
)
def diagnose() -> str:
    """Surface the REAL (swallowed) submodel-load error that base.py masks with a 404 fallback."""
    import os, traceback
    from huggingface_hub import snapshot_download

    local = snapshot_download(MODEL_REPO)
    weights_volume.commit()
    print("LOCAL_DIR:", local)
    print("root files:", sorted(os.listdir(local))[:40])
    ck = os.path.join(local, "ckpts")
    print("ckpts exists:", os.path.isdir(ck))
    if os.path.isdir(ck):
        print("ckpts entries:", sorted(os.listdir(ck))[:60])
    target = f"{local}/ckpts/shape_dec_next_dc_f16c32_fp16"
    print("json exists:", os.path.exists(target + ".json"),
          "| safetensors exists:", os.path.exists(target + ".safetensors"))
    from trellis2 import models
    try:
        m = models.from_pretrained(target)
        print("LOAD OK:", type(m).__name__)
        return "LOAD_OK"
    except Exception:
        print("LOAD FAILED — real traceback:")
        traceback.print_exc()
        return "LOAD_FAILED"


@app.local_entrypoint()
def diag():
    print("DIAGNOSE_RESULT:", diagnose.remote())


@app.local_entrypoint()
def probe(image: str = "", tier: str = "fast", seed: int = 0):
    """Phase 1 runner:  modal run modal_functions/trellis2.py::probe --image sample.webp"""
    if not image:
        raise SystemExit("pass --image <path> (e.g. a TRELLIS sample .webp)")
    with open(image, "rb") as f:
        image_bytes = f.read()
    result = probe_build.remote(image_bytes, tier=tier, seed=seed)
    import json
    print("PHASE1_RESULT:", json.dumps(result, indent=2))


@app.cls(
    image=image,
    gpu="A100-80GB",
    timeout=600,
    scaledown_window=300,
    volumes={CACHE_DIR: weights_volume},
    secrets=[hf_secret],
)
class Trellis2Generator:
    @modal.enter()
    def load(self):
        import os
        os.environ["OPENCV_IO_ENABLE_OPENEXR"] = "1"
        import torch  # noqa: F401

        self.pipeline = _load_commercial_pipeline()
        self.pipeline.cuda()
        weights_volume.commit()

    @modal.method()
    def generate(
        self,
        image_bytes: bytes,
        *,
        tier: str = "balanced",
        texture_size: int = 2048,
        want_normal: bool = True,
        output_format: str = "glb",  # "glb" | "splat"
        seed: int | None = None,
    ) -> tuple[bytes, bytes | None]:
        """Returns (asset_bytes, thumbnail_png_bytes). asset is a .glb or a .ply splat."""
        from PIL import Image

        img = Image.open(io.BytesIO(image_bytes)).convert("RGBA")
        outputs = self.pipeline.run(
            img,
            seed=seed if seed is not None else 0,
            pipeline_type=_tier_to_pipeline_type(tier),
        )
        mesh = outputs[0]

        if output_format == "splat":
            asset_bytes = _synthesize_splat_ply(mesh)  # T-F7: synth-only, no native decoder
        else:
            asset_bytes = commercial_to_glb(
                mesh.vertices, mesh.faces, mesh.attrs, mesh.coords, mesh.layout,
                mesh.voxel_size, texture_size=texture_size, want_normal=want_normal,
            )
        thumb = _render_thumbnail(mesh)
        return asset_bytes, thumb


# ---------------------------------------------------------------------------------------
# Commercial export — port of o_voxel.postprocess.to_glb (audited), rasterizer swapped.
# Keeps: CuMesh clean/simplify/unwrap/BVH, FlexGEMM grid_sample_3d bake, cv2.inpaint gutter.
# Replaces: dr.RasterizeCudaContext / dr.rasterize / dr.interpolate  ->  PyTorch3D.
# ---------------------------------------------------------------------------------------
def commercial_to_glb(vertices, faces, attr_volume, coords, attr_layout, voxel_size,
                      *, texture_size: int = 2048, want_normal: bool = True,
                      decimation_target: int = 1000000, return_debug: bool = False):
    """Explicit-arg port of o_voxel.postprocess.to_glb; nvdiffrast swapped for PyTorch3D.
    Returns glb bytes, or (glb_bytes, debug_dict) when return_debug=True."""
    import numpy as np
    import torch
    import cv2
    from PIL import Image
    import trimesh
    import cumesh

    coords = coords.cuda()
    attr_volume = attr_volume.cuda().float()
    aabb = torch.tensor([[-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]], device=coords.device)
    if not torch.is_tensor(voxel_size):
        voxel_size = torch.tensor([float(voxel_size)] * 3, dtype=torch.float32, device=coords.device)
    elif voxel_size.ndim == 0:
        voxel_size = voxel_size.repeat(3).to(coords.device)
    else:
        voxel_size = voxel_size.to(coords.device)
    grid_size = ((aabb[1] - aabb[0]) / voxel_size).round().int()

    vertices, faces = vertices.cuda().float(), faces.cuda().int()

    # --- CuMesh clean / simplify / unwrap / BVH / normals (unchanged from stock) ---
    cm = cumesh.CuMesh()
    cm.init(vertices, faces)
    cm.fill_holes(max_hole_perimeter=3e-2)
    vertices, faces = cm.read()
    bvh = cumesh.cuBVH(vertices, faces)
    cm.simplify(decimation_target * 3)
    cm.remove_duplicate_faces(); cm.repair_non_manifold_edges()
    cm.remove_small_connected_components(1e-5); cm.fill_holes(max_hole_perimeter=3e-2)
    cm.simplify(decimation_target)
    cm.remove_duplicate_faces(); cm.repair_non_manifold_edges()
    cm.remove_small_connected_components(1e-5); cm.fill_holes(max_hole_perimeter=3e-2)
    cm.unify_face_orientations()
    out_vertices, out_faces, out_uvs, out_vmaps = cm.uv_unwrap(return_vmaps=True)
    out_vertices, out_faces = out_vertices.cuda(), out_faces.cuda()
    out_uvs, out_vmaps = out_uvs.cuda(), out_vmaps.cuda()
    cm.compute_vertex_normals()
    out_normals = cm.read_vertex_normals()[out_vmaps]

    # --- STAGE 2 (THE SWAP): rasterize UVs -> per-texel faceID + barycentric + 3D position ---
    # Original (removed): dr.rasterize(ctx, uvs*2-1 as clip, faces) ; dr.interpolate(verts, rast, faces)
    # PyTorch3D equivalent: put UV*2-1 into a mesh's screen coords under an ortho camera.
    # !!! PHASE 2: validate this reproduces nvdiffrast coverage (esp. island edges) at 2K-4K.
    pos, mask = _rasterize_uv_positions(out_vertices, out_faces, out_uvs, texture_size)
    valid_pos = pos[mask]

    # --- Drift correction: project texels onto the ORIGINAL hi-res mesh (unchanged) ---
    _, face_id, uvw = bvh.unsigned_distance(valid_pos, return_uvw=True)
    orig_tri = vertices[faces[face_id.long()]]
    valid_pos = (orig_tri * uvw.unsqueeze(-1)).sum(dim=1)

    # --- Volumetric PBR bake: sparse trilinear sample of the continuous attribute field ---
    # Same math as the stock FlexGEMM grid_sample_3d('trilinear'), reimplemented in pure torch
    # (no Triton autotuner). This is the seam-consistent core: adjacent UV islands map to
    # nearby 3D positions and thus sample near-identical values (SRED T-F5).
    q = (valid_pos - aabb[0]) / voxel_size          # query points in voxel-index units
    sampled = _sample_sparse_trilinear(attr_volume, coords, grid_size, q)
    attrs = torch.zeros(texture_size, texture_size, attr_volume.shape[1],
                        device="cuda", dtype=sampled.dtype)
    attrs[mask] = sampled

    mask_np = mask.cpu().numpy()
    mask_inv = (~mask_np).astype(np.uint8)

    def _chan(key, k):
        a = np.clip(attrs[..., attr_layout[key]].cpu().numpy() * 255, 0, 255).astype(np.uint8)
        return cv2.inpaint(a, mask_inv, k, cv2.INPAINT_TELEA)  # gutter fill (unchanged)

    base_color = _chan("base_color", 3)
    metallic = _chan("metallic", 1)[..., None]
    roughness = _chan("roughness", 1)[..., None]
    alpha = _chan("alpha", 1)[..., None]

    material = trimesh.visual.material.PBRMaterial(
        baseColorTexture=Image.fromarray(np.concatenate([base_color, alpha], axis=-1)),
        metallicRoughnessTexture=Image.fromarray(
            np.concatenate([np.zeros_like(metallic), roughness, metallic], axis=-1)
        ),
        metallicFactor=1.0, roughnessFactor=1.0, alphaMode="OPAQUE", doubleSided=True,
    )
    # TODO(phase3): normalTexture from bvh face_id+uvw on the ORIGINAL mesh normals (want_normal).

    v = out_vertices.cpu().numpy(); n = out_normals.cpu().numpy(); uv = out_uvs.cpu().numpy()
    v[:, 1], v[:, 2] = v[:, 2], -v[:, 1]           # glTF axis convention (unchanged)
    n[:, 1], n[:, 2] = n[:, 2], -n[:, 1]
    uv[:, 1] = 1 - uv[:, 1]
    tmesh = trimesh.Trimesh(
        vertices=v, faces=out_faces.cpu().numpy(), vertex_normals=n, process=False,
        visual=trimesh.visual.TextureVisuals(uv=uv, material=material),
    )
    glb = tmesh.export(file_type="glb")
    # TODO(phase3): pipe through gltf-transform/gltfpack for Draco + KTX2 before returning.
    if return_debug:
        base_rgba = np.concatenate([base_color, alpha], axis=-1)
        buf = io.BytesIO(); Image.fromarray(base_rgba).save(buf, "PNG")
        debug = {
            "coverage": float(mask_np.mean()),
            "covered_texels": int(mask_np.sum()),
            "out_vertices": int(out_vertices.shape[0]),
            "out_faces": int(out_faces.shape[0]),
            "basecolor_png": buf.getvalue(),
            # for validation render (glTF axes, V-flipped uv — as exported):
            "_render": (v, out_faces.cpu().numpy(), uv, base_color),
        }
        return glb, debug
    return glb


def _sample_sparse_trilinear(attr_volume, coords, grid_size, q):
    """Trilinear sample of a sparse voxel field (absent neighbours = 0), pure PyTorch.

    attr_volume [L,C] float; coords [L,3] int voxel indices; grid_size [3] int;
    q [N,3] float query points in voxel-index units. Returns [N,C].
    """
    import torch
    dev = attr_volume.device
    G = grid_size.to(torch.int64).to(dev)
    strides = torch.tensor([int(G[1] * G[2]), int(G[2]), 1], device=dev, dtype=torch.int64)
    keys = (coords.to(torch.int64).to(dev) * strides).sum(-1)          # [L]
    order = torch.argsort(keys)
    keys_sorted = keys[order]
    c0 = torch.floor(q).to(torch.int64)                                # [N,3]
    frac = q - c0.to(q.dtype)                                          # [N,3]
    out = torch.zeros(q.shape[0], attr_volume.shape[1], device=dev, dtype=attr_volume.dtype)
    gm1 = (G - 1)
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                cc = c0 + torch.tensor([dx, dy, dz], device=dev, dtype=torch.int64)  # [N,3]
                inb = ((cc >= 0) & (cc <= gm1)).all(-1)                # [N]
                ccc = torch.minimum(torch.clamp(cc, min=0), gm1)
                kk = (ccc * strides).sum(-1)                           # [N]
                pos = torch.searchsorted(keys_sorted, kk).clamp(max=keys_sorted.numel() - 1)
                hit = (keys_sorted[pos] == kk) & inb                  # [N]
                rows = order[pos]
                wx = frac[:, 0] if dx else (1 - frac[:, 0])
                wy = frac[:, 1] if dy else (1 - frac[:, 1])
                wz = frac[:, 2] if dz else (1 - frac[:, 2])
                w = (wx * wy * wz * hit.to(q.dtype)).unsqueeze(-1)     # [N,1]
                out += attr_volume[rows] * w
    return out


def _rasterize_uv_positions(vertices, faces, uvs, texture_size):
    """PyTorch3D UV-space rasterization -> (per-texel 3D position [S,S,3], valid mask [S,S]).

    Replaces the nvdiffrast rasterize+interpolate. Builds a mesh whose XY are UV*2-1 (z=0),
    rasterizes under the default NDC, then interpolates the true 3D vertex positions with the
    barycentric coords. PHASE 2: verify coverage parity with nvdiffrast at island borders.
    """
    import torch
    from pytorch3d.structures import Meshes
    from pytorch3d.renderer.mesh.rasterize_meshes import rasterize_meshes

    faces = faces.to(torch.int64)
    # z must be POSITIVE (in front of the camera) — PyTorch3D culls faces at/behind z=0.
    uv_ndc = torch.cat([uvs * 2 - 1, torch.ones_like(uvs[:, :1])], dim=-1)  # (V,3), z=1
    meshes = Meshes(verts=[uv_ndc], faces=[faces])
    pix_to_face, _zbuf, bary, _dists = rasterize_meshes(
        meshes, image_size=texture_size, blur_radius=0.0, faces_per_pixel=1,
        perspective_correct=False, cull_backfaces=False,
    )
    pix_to_face = pix_to_face[0, ..., 0]           # (S,S)
    bary = bary[0, ..., 0, :]                       # (S,S,3)
    mask = pix_to_face >= 0
    pos = torch.zeros(texture_size, texture_size, 3, device=vertices.device)
    fidx = pix_to_face[mask]
    tri = vertices[faces[fidx]]                     # (P,3,3)
    pos[mask] = (tri * bary[mask].unsqueeze(-1)).sum(dim=1)
    return pos, mask


def _render_validation(v, faces, uv, base_color, size=768, nviews=4) -> bytes:
    """Render the textured mesh from a few orbit views with PyTorch3D (TexturesUV) → montage PNG.
    Validates UV↔texture alignment (catches V-flip bugs) and lets us eyeball island seams."""
    import io, numpy as np, torch
    from PIL import Image
    from pytorch3d.structures import Meshes
    from pytorch3d.renderer import (
        TexturesUV, FoVPerspectiveCameras, RasterizationSettings, MeshRenderer,
        MeshRasterizer, SoftPhongShader, AmbientLights, look_at_view_transform,
    )
    dev = "cuda"
    verts = torch.tensor(v, dtype=torch.float32, device=dev)
    faces_t = torch.tensor(faces, dtype=torch.int64, device=dev)
    uv_t = torch.tensor(uv, dtype=torch.float32, device=dev)
    tex_img = torch.tensor(base_color, dtype=torch.float32, device=dev)[None] / 255.0
    textures = TexturesUV(maps=tex_img, faces_uvs=faces_t[None], verts_uvs=uv_t[None])
    center = verts.mean(0); scale = (verts.max(0).values - verts.min(0).values).max()
    lights = AmbientLights(device=dev)  # flat albedo render → best for spotting seams
    tiles = []
    for i in range(nviews):
        R, T = look_at_view_transform(dist=float(scale) * 2.2, elev=15,
                                      azim=float(i * 360.0 / nviews), at=center[None])
        cams = FoVPerspectiveCameras(device=dev, R=R, T=T, fov=40)
        renderer = MeshRenderer(
            rasterizer=MeshRasterizer(cameras=cams, raster_settings=RasterizationSettings(
                image_size=size, blur_radius=0.0, faces_per_pixel=1)),
            shader=SoftPhongShader(device=dev, cameras=cams, lights=lights),
        )
        m = Meshes(verts=[verts], faces=[faces_t], textures=textures)
        img = renderer(m)[0, ..., :3].clamp(0, 1).cpu().numpy()
        tiles.append((img * 255).astype(np.uint8))
    montage = np.concatenate(tiles, axis=1)
    buf = io.BytesIO(); Image.fromarray(montage).save(buf, "PNG")
    return buf.getvalue()


@app.function(
    image=image, gpu="A100-80GB", timeout=1800,
    volumes={CACHE_DIR: weights_volume}, secrets=[hf_secret],
)
def bake_from_dump(tier: str = "fast", texture_size: int = 2048) -> dict:
    """Phase 2 offline harness: bake the dumped raw mesh (no regen) through commercial_to_glb,
    render validation views, and return glb + atlas + render + diagnostics for inspection."""
    import numpy as np, torch

    d = np.load(f"{CACHE_DIR}/phase1_dump_{tier}.npz", allow_pickle=True)
    keys = [str(k) for k in d["layout_keys"]]
    slices = d["layout_slices"]
    attr_layout = {k: slice(int(s[0]), int(s[1])) for k, s in zip(keys, slices)}
    vertices = torch.from_numpy(d["vertices"])
    faces = torch.from_numpy(d["faces"])
    attr_volume = torch.from_numpy(d["attrs"])
    coords = torch.from_numpy(d["coords"])
    voxel_size = float(d["voxel_size"])

    glb, dbg = commercial_to_glb(
        vertices, faces, attr_volume, coords, attr_layout, voxel_size,
        texture_size=texture_size, return_debug=True,
    )
    render_png = _render_validation(*dbg.pop("_render"))

    with open(f"{CACHE_DIR}/phase2_{tier}_{texture_size}.glb", "wb") as f:
        f.write(glb)
    weights_volume.commit()
    return {
        "glb_bytes_len": len(glb),
        "coverage": dbg["coverage"],
        "covered_texels": dbg["covered_texels"],
        "out_vertices": dbg["out_vertices"],
        "out_faces": dbg["out_faces"],
        "basecolor_png": dbg["basecolor_png"],
        "render_png": render_png,
        "glb": glb,
    }


@app.local_entrypoint()
def bake(tier: str = "fast", texture_size: int = 2048, outdir: str = "/tmp/trellis_phase2"):
    import os, json
    os.makedirs(outdir, exist_ok=True)
    r = bake_from_dump.remote(tier=tier, texture_size=texture_size)
    for k in ("basecolor_png", "render_png", "glb"):
        ext = "glb" if k == "glb" else "png"
        with open(f"{outdir}/{k}.{ext}", "wb") as f:
            f.write(r.pop(k))
    print("PHASE2_RESULT:", json.dumps(r, indent=2))
    print("artifacts in", outdir)


def _synthesize_splat_ply(mesh) -> bytes:
    """T-F7: no native Gaussian decoder — synthesize splats from surface points + albedo bake.
    PHASE 3b: sample surface points, color via grid_sample_3d albedo, write .ply via gsplat."""
    raise NotImplementedError("Phase 3b: splat synthesis")


def _render_thumbnail(mesh) -> bytes | None:
    """PHASE 3: offscreen turntable/hero render via pyrender (EGL). Optional; None for now."""
    return None


@app.local_entrypoint()
def main(image: str, tier: str = "balanced", texture_size: int = 2048,
         output_format: str = "glb", out: str = "out.glb", seed: int = -1):
    with open(image, "rb") as f:
        image_bytes = f.read()
    asset, thumb = Trellis2Generator().generate.remote(
        image_bytes, tier=tier, texture_size=texture_size,
        output_format=output_format, seed=None if seed < 0 else seed,
    )
    with open(out, "wb") as f:
        f.write(asset)
    print(f"wrote {out} ({len(asset)} bytes)")
