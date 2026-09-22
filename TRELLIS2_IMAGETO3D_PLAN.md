# Image-to-3D Generation Plan — TRELLIS.2 with a Commercial, Seamless GLB Pipeline

Add **image → 3D asset** generation to the nexus8 3D annotation viewer using Microsoft
**TRELLIS.2-4B**, replacing its non-commercial `nvdiffrast`/`nvdiffrec` postprocessing with
an **open-source, commercially-licensed, seam-free** bake-and-export pipeline. Two output
formats: a **fully textured PBR GLB mesh** (primary) and an optional **Gaussian splat**.
Runs on Modal, mirrors the existing `nexus8-inpaint` dispatch/poll pattern, and lands
results as versioned `3d_model` / `gaussian_splat` assets viewable in-app (existing Three.js
mesh viewer + a new splat viewer adapter).

**Companion document:** `SRED_TRELLIS_IMAGETO3D_EXPERIMENT.md` (technological uncertainties,
hypotheses, findings T-F1…; referenced here as T-Fn).

---

## Why this is tractable

The hard, novel part of image-to-3D — shape + **native PBR material** synthesis — is
already solved by TRELLIS.2 and is **MIT-licensed, pure-PyTorch/CUDA** with no
non-commercial dependency:

- `Trellis2ImageTo3DPipeline.from_pretrained("microsoft/TRELLIS.2-4B")`
- `mesh = pipeline.run(image)[0]` → produces a raw mesh (`vertices`, `faces`) **plus** a
  sparse **O-Voxel attribute volume** (`attr_volume`, `coords`, `attr_layout`,
  `voxel_size`, `aabb`) encoding full PBR: **base color, metallic, roughness, alpha**.

The **only** commercial blocker is the export tail, `o_voxel.postprocess.to_glb(...)`,
which uses:

- **`nvdiffrast`** — NVIDIA's differentiable rasterizer, used for the **geometric
  rasterization** (mapping mesh triangles to texel coverage) and antialiasing when baking
  the attribute volume into the UV atlas.
- **`nvdiffrec`** — NVIDIA's **PBR split-sum material estimation**: it bakes the distinct
  Base Color / Roughness / Metallic / Opacity attributes into a unified texture format
  (and renders through `nvdiffrast` to do so).

Both ship under the **NVIDIA Source Code License (1-Way Commercial)** — research/evaluation
only. This makes the *stock* GLB export unusable in a commercial product. **Everything
upstream of `to_glb` is fine.**

So the work is: **reimplement `to_glb` from permissive parts** — replace `nvdiffrast`'s
rasterization with a permissive rasterizer, and replace `nvdiffrec`'s split-sum baking by
sampling TRELLIS.2's *native* PBR channels directly and writing them to a standard glTF
material — and, because we control the bake, make it **seam-free by construction**.

### Prior art (de-risks feasibility)

Independent efforts already strip both dependencies, confirming this is achievable and not
research-blocked:

- **ComfyUI native TRELLIS.2 / Pixal3D** — replaces `nvdiffrast`/`nvdiffrec` with an
  open-source **PyTorch + SciPy** reimplementation; output confirmed commercial-usable
  (comfy.org, Aug 2026).
- **`kg-git-dev/trellis-refactored`** — swaps `nvdiffrast` for a **PyTorch3D** differentiable
  renderer in the baking stage.
- **`IgorAherne/TRELLIS.2-stableprojectorz`** — community fork substituting modified
  FlexiCubes to bypass the restricted modules.

Our contribution beyond these is the **seam-free volumetric bake** (below) and the Modal +
nexus8 integration. The community `render.py` swaps are useful blueprints for stage 3.

## The seam insight (why our bake beats the stock one)

TRELLIS.2 stores appearance as a **continuous 3D attribute field** (the O-Voxel volume),
not as photographs. That lets us bake textures by **direct volumetric sampling** rather
than multi-view projection:

> For each texel of the UV atlas, find its 3D surface position, then **trilinearly sample
> the attribute volume** at that position to get base color / metallic / roughness.

Two texels on opposite sides of a UV seam are the *same mesh edge* — their 3D positions
are spatially adjacent, so they sample **near-identical** values from the continuous
volume. Colors therefore match across the seam **by construction**. This is fundamentally
different from photographic multi-view baking (where each UV island is filled from a
different camera → exposure/parallax mismatch → visible seams). Our requirement — *no
visible seams where UV islands meet* — falls out of the representation, not out of a
post-hoc patch. See T-F3/T-H2.

---

## Decisions (from analysis + user)

- **Model:** TRELLIS.2-4B (MIT weights + code). Image-to-3D only for v1.
- **Quality tier: selectable per-request** — `fast` 512³ (~3 s gen), `balanced` 1024³
  (~17 s), `max` 1536³ (~60 s), mirroring inpaint's `fast`/`quality` mode param.
- **Output formats: two, user-selectable per generation:**
  - **(A) Textured PBR mesh GLB (primary):** full PBR @ 2K, KTX2 + Draco. Base color
    (+alpha), packed metallic-roughness, and a **baked tangent-space normal map**
    (decimation loses high-frequency geometry — the normal map restores it). 2048px
    default; `texture_size` selectable up to 4096.
  - **(B) Gaussian splat (optional):** `.ply`/`.splat` via **gsplat (Apache-2.0)**.
    Source: use TRELLIS.2's **native Gaussian/radiance decoder if it exposes one** (v1
    TRELLIS did — confirm in Phase 0); otherwise **synthesize** splats from sampled surface
    points colored by the baked albedo. Splats are commercial-friendly and fast but are a
    view-dependent point representation, *not* a mesh — they need a dedicated renderer.
- **Splat viewing: add an in-app splat renderer.** The current Three.js viewer only loads
  meshes (`GLTFLoader`); splats require a second **viewer adapter** using a permissive
  splat renderer — **`@mkkellogg/gaussian-splats-3d` (MIT)** or **Spark** (lumalabs) — so
  generated `.ply`/`.splat` assets are viewable in-app, not just downloadable.
- **Compression to match the viewer:** Draco geometry + KTX2/Basis textures, exactly the
  loaders already wired in `threeModelViewerAdapter.ts` (DRACO, KTX2, Meshopt).
- **Trigger: both** — (a) a "Generate 3D" action in `AssetPanel` on an image asset →
  new versioned `3d_model` asset with lineage to the source image; (b) a standalone
  drop-an-image panel → GLB → optional "Save to library".
- **Result storage:** reuse `layer_renders.store_run_results()` provenance machinery; new
  asset gets `media_type='3d_model'` and a **rendered turntable thumbnail** (3D assets get
  no thumbnail today — this closes that gap).
- **Bake by volumetric sampling** (not multi-view projection) for inherent seam
  consistency; gutter/dilation for mip safety; optional seam-leveling only if residuals
  survive (T-H2/T-H3).

---

## Replacement pipeline (drop-in for `to_glb`, all permissive)

> **⚠️ Superseded by the Phase 0 source audit (2026-09-08) — see `SRED…` Part C, T-F1…T-F8.**
> The audit read the actual `o_voxel.postprocess.to_glb` and found the port is **far smaller
> than a full reimplementation**. TRELLIS.2 *already* bakes by trilinear volumetric sampling
> (`FlexGEMM.grid_sample_3d`, MIT), *already* corrects decimation drift by projecting texels
> back onto the original mesh via its BVH (`cumesh.cuBVH`, MIT), and *already* fills the
> gutter with `cv2.inpaint`. The **only** nvdiffrast use is three calls — `RasterizeCudaContext`,
> `dr.rasterize` (UV→clip), `dr.interpolate` (per-texel 3D position). CuMesh also does the UV
> unwrap and decimation. So the real task is a **surgical rasterizer swap**, keeping the rest.
> The table below is revised to match.

Input (from `mesh = pipeline.run(image)[0]`): `mesh.vertices, mesh.faces, mesh.attrs`
(=`attr_volume`), `mesh.coords`, `mesh.layout`, `mesh.voxel_size`; `aabb=[[-.5]*3,[.5]*3]`.
Output: compressed GLB (or `.ply` splat) bytes + thumbnail bytes.

| Stage | What | Library | License |
|---|---|---|---|
| 1. Clean/decimate/unwrap | Keep TRELLIS.2's own path: `cumesh` fill-holes → simplify(3×→target) → repair → `uv_unwrap` (built-in charter) → `cuBVH` → vertex normals | **CuMesh** (as-is) | MIT |
| 2. **UV rasterize (the swap)** | Replace the 3 nvdiffrast calls: rasterize UVs (`·2−1` as clip coords) → per-texel **faceID + barycentric**, then interpolate `out_vertices` → per-texel **3D position**. Chunked over faces like the original | **PyTorch3D `MeshRasterizer`** (ortho; gives `pix_to_face`+`bary_coords`) *or* custom Torch AABB rasterizer | BSD-3 / MIT |
| 3. Drift correction | Keep as-is: `bvh.unsigned_distance(pos, return_uvw)` → reconstruct position on the **original** high-res triangle | CuMesh (as-is) | MIT |
| 4. Volumetric PBR bake | Keep as-is: `grid_sample_3d(attr_volume, coords, grid=(pos−aabb₀)/voxel_size, 'trilinear')` → base_color/metallic/roughness/alpha | **FlexGEMM** (as-is) | MIT |
| 5. Gutter fill | Keep as-is: `cv2.inpaint(..., INPAINT_TELEA)` on the uncovered-texel mask — this is what kills island-edge seams | OpenCV | Apache-2.0 |
| 6. **Normal bake (new)** | *Enhancement* — stock bakes none. Reuse the stage-3 `face_id`+`uvw` to sample the **original** mesh normals → tangent-space normal map. No Embree needed | pure Torch + CuMesh BVH | MIT |
| 7. Pack + export | Keep TRELLIS.2's `trimesh.visual.material.PBRMaterial` (baseColor=`[rgb,alpha]`, MR=`[0,rough,metal]`), then **Draco + KTX2** compress | `trimesh` + `gltf-transform`/`gltfpack` + Basis/KTX-Software | MIT / MIT / Apache-2.0 |
| 8. Thumbnail | Offscreen render 1 hero view + turntable sprite for the library card | `pyrender` (EGL) or PyTorch3D | MIT / BSD-3 |
| **B. Splat export** (alt. output) | **Synthesize only** (no native decoder — T-F7): means = sampled surface points, colors = albedo bake, opacity/scale from surface traits → `.ply`/`.splat` | **gsplat** | Apache-2.0 |

**Removed:** `nvdiffrast`, `nvdiffrec` (NVIDIA Source Code License, non-commercial) — replaced
by stage 2 only.
**Net licensing:** every remaining component is MIT / BSD-3 / Apache-2.0 — **plus the DINOv3
weight** (see caveat below).

> **⚠️ DINOv3 licensing caveat (T-F3):** the generation path conditions on
> `facebook/dinov3-vitl16-pretrain-lvd1689m` (a core dependency, not the export tail). Meta's
> **DINOv3 License permits commercial use with no MAU/revenue caps**, but requires: (1) gated
> HF access → the Modal image needs an authorized **`HF_TOKEN`** to download the weights;
> (2) **"Built with DINOv3" attribution** in the product + bundling the license text; (3)
> acceptable-use compliance. So the pipeline is *"MIT code + a DINOv3-License weight"*, not
> fully permissive — a compliance obligation to track, not a blocker.

> **On seams (confirmed by audit):** TRELLIS.2 already bakes seam-consistently — the
> volumetric `grid_sample_3d` samples a continuous field, decimation drift is corrected by
> projecting texels onto the *original* mesh via the BVH, and `cv2.inpaint` fills the
> coverage gap at island borders. Because we keep all three and swap only the rasterizer,
> **seam behavior is inherited, not something we must re-invent** (T-F5). The one thing to
> validate in Phase 2 is that the swapped rasterizer produces the same per-texel
> faceID+barycentric coverage as nvdiffrast at 2K–4K; baking is a single forward pass, so
> PyTorch3D's slower backward is irrelevant here.

> **Phase 0 verify items — all resolved (see `SRED…` Part C):** (a) call sites confined to
> `to_glb` + preview renderers + the separate texturing pipeline; main generation imports
> neither (T-F1); (b) CuMesh/FlexGEMM/o-voxel/utils3d all MIT, Eigen MPL-2.0 (T-F3);
> (c) conditioner is **DINOv3**, commercial-OK with attribution + gated download (T-F3,
> caveat above); (d) `attr_volume` layout fully captured (T-F8); (e) **no native Gaussian
> decoder — splats are synth-only** (T-F7).

---

## Modal app (`modal_functions/trellis2_gen.py`, app `nexus8-trellis2`)

Follows the established pattern (App → `@app.cls` → `@modal.enter()` load → `@modal.method`
returning bytes → Django `spawn`/`FunctionCall.from_id().get()`). **Built & generation-verified
in Phase 1** — the notes below reflect what actually works, not just the plan.

> **File name:** must NOT be `trellis2.py` (it would shadow TRELLIS.2's own `trellis2`
> package on the container) — hence `trellis2_gen.py` (T-P1 / Part D).

**Three build patches beyond the audited `setup.sh` (all found in Phase 1):**
- **Permissive rembg (T-F9):** `pipeline.json` points background removal at the gated,
  **non-commercial `briaai/RMBG-2.0`**. Monkeypatch `rembg.BiRefNet.__init__` to force the
  original **`ZhengPeng7/BiRefNet` (MIT, ungated)** — same architecture. This is the commercial
  fix for background removal.
- **Lazy nvdiffrast in o-voxel (T-F10):** `o_voxel/__init__.py` eagerly imports `postprocess.py`
  (`import nvdiffrast.torch`). `sed` that import to `dr = None` at build time so `o_voxel`
  imports with nvdiffrast absent (we replace the stock `to_glb`).
- **Pin `transformers==4.57.1` (T-F11):** unpinned resolves to 5.x, which renamed the
  DINOv3ViT internals TRELLIS.2 accesses. Pin as a late layer so kernel layers stay cached.

- **Image (built & working):** CUDA 12.4 **devel** base + `add_python="3.10"`. Pin
  **torch 2.6.0 / torchvision 0.21.0 (cu124)**, `flash-attn==2.7.3`, then build CuMesh /
  FlexGEMM / o-voxel from source (`--no-build-isolation`). Build gotchas confirmed in Phase 1:
  install `wheel`/`setuptools`/`packaging`/`ninja` + cap `MAX_JOBS` before flash-attn; set
  **`CC=gcc`/`CXX=g++`** (Modal's `add_python` links via a missing `clang++`); build kernels for
  `TORCH_CUDA_ARCH_LIST=8.0;9.0` (no live GPU needed at build). **PyTorch3D** (the rasterizer
  swap) has **no PyPI wheel → build from source in Phase 2** (`git+…/pytorch3d@stable`); plus
  `pyrender`, `scipy`, **`gsplat`**, `gltfpack`/`gltf-transform` for KTX2+Draco. (xatlas/Embree
  not needed — CuMesh does UV unwrap + BVH.)
- **Weights:** TRELLIS.2-4B (~8–16 GB) + **DINOv3** conditioner on a **`modal.Volume`**
  (`snapshot_download` on first run). **DINOv3 is gated** → the build/first-run needs a
  `modal.Secret` carrying an **`HF_TOKEN`** with accepted DINOv3 terms (T-F3). Product must
  also carry the **"Built with DINOv3"** attribution.
- **GPU:** `A100-80GB` default (safe for 1536³ + 4B); `H100` for `max` tier if needed.
  24 GB is the model floor but headroom matters for the bake.
- **Class `Trellis2Generator`:** `@modal.enter()` loads the pipeline once;
  `@modal.method() generate(image_bytes, *, tier, texture_size, want_normal, output_format,
  seed) -> (asset_bytes, thumb_bytes)` where `output_format ∈ {"glb", "splat"}` selects the
  textured-mesh vs Gaussian-splat branch.
- **Timeout** ~600 s (max tier + bake); `scaledown_window` ~300 s.

## Django integration

- `nexus8/trackables/views_trellis.py`:
  - `POST /trackables/api/library/image-to-3d/` — source is either an existing image
    `asset_id`/version or uploaded bytes (standalone path); `Trellis2Generator().generate.spawn(...)`; return call id (mirrors `views_inpaint.py`).
  - `GET …/status/<call_id>/` — `FunctionCall.from_id(call_id).get(timeout=0)`; on ready,
    store via `layer_renders.store_run_results(...)` → new version with
    `media_type='3d_model'` (GLB) or `media_type='gaussian_splat'` (PLY),
    `VersionLink` `GENERATED_FROM_BATCH` to source image, thumbnail attached.
- **Ingest tweak** (`services/ingest.py`): generated/uploaded `.glb` → `media_type='3d_model'`
  and `.ply`/`.splat` → `media_type='gaussian_splat'`, each with the rendered thumbnail, so
  the grid shows a preview (today `.glb` ingests as opaque `file` with none). Asset-type
  detection in `web/src/api/library.ts` (`assetIs3DModel`) gains a `gaussian_splat` case.

## Frontend

- `web/src/api/library.ts`: `generateImageTo3D()` + `pollImageTo3D()`; add
  `output_format` (`glb`/`splat`) to the request.
- **AssetPanel:** "Generate 3D" action on image assets (tier selector fast/balanced/max +
  format selector mesh/splat); poll; on completion the new asset appears. GLB opens in
  `threeModelViewerAdapter` — **no changes needed** (Draco/KTX2/PBR/IBL already supported).
- **New splat viewer adapter** (`gaussianSplatViewerAdapter.ts`): a second `ViewerAdapter`
  using **`@mkkellogg/gaussian-splats-3d` (MIT)** (or Spark), routed from
  `createAssetViewerAdapter()` when `media_type === 'gaussian_splat'`. Reuses the existing
  camera/annotation-overlay seam like the mesh adapter (surface-anchored annotation on
  splats is a later refinement).
- **Standalone panel:** drop image → tier + format → GLB/splat preview → "Save to library".

---

## Phases

- **✅ Phase 0 — Licensing + API audit (DONE, 2026-09-08):** source-audited (no GPU). H1
  confirmed; call sites, licenses, `attr_volume` layout, and the `to_glb` algorithm captured;
  DINOv3 caveat surfaced; splats confirmed synth-only. Full findings in `SRED…` Part C.
- **✅ Phase 1 — Clean build + generation on Modal (DONE, 2026-09-08):** `nexus8-trellis2`
  image built with open-source flags; `fast` 512³ generation ran with **`nvdiffrast`/`nvdiffrec`
  never imported** (`restricted_after_gen: []`). Raw mesh (1.28M v / 2.61M f) + `attr_volume`
  `[1.27M, 6]` dumped to the Volume. Surfaced + fixed T-F9 (BRIA rembg → MIT BiRefNet),
  T-F10 (lazy nvdiffrast), T-F11 (transformers pin). Full results in `SRED…` Part D.
- **✅ Phase 2 — Rasterizer swap + seam-free GLB (DONE, 2026-09-08):** `commercial_to_glb`
  keeps CuMesh unwrap/BVH + `cv2.inpaint`; swapped nvdiffrast rasterize→**PyTorch3D** (needs
  positive-z NDC, T-P3) and FlexGEMM grid_sample→**pure-torch sparse trilinear** (Triton
  autotune was fragile, T-P2). Offline-validated on the Phase-1 dump: coverage 0.46 @ 2048²,
  **flat-lit render shows correct UV alignment and NO visible island seams** (T-P4 → H2/H5).
  Wired into `generate()`. Full results in `SRED…` Part E.
- **✅ Phase 3 — Normal bake + compression + thumbnail (DONE, 2026-09-09):** tangent-space
  **normal map** from the existing BVH (T-P5, no Embree); **meshopt+KTX2** compression via
  gltfpack v0.22 (**Draco→meshopt** substitute, viewer-supported) — **67 MB → 10.9 MB (6.1×)**,
  full PBR incl. normal (T-P6); PyTorch3D hero **thumbnail** (T-P7). Normal-map green/handedness
  correctness deferred to Phase 5 (three.js). Results in `SRED…` Part F.
- **Phase 3b — Gaussian-splat synthesis (M, ~1–2 d):** synthesize splats from surface points
  + albedo bake (no native decoder — T-F7); export `.ply`/`.splat` via gsplat. Tests T-H7.
- **✅ Phase 4 — Django dispatch/poll + ingest (DONE, 2026-09-10):** `views_trellis.py`
  (asset-scoped trigger/status + standalone upload) mirroring inpaint's spawn/poll;
  `ingest_generated_asset` stores the GLB as a first-class `media_type='3d_model'` asset with the
  Modal-rendered thumbnail + `init_image` lineage. Modal app **deployed**. E2E-validated: source
  image #344 → 3d_model #345, lineage + thumbnail + idempotent re-poll (T-P8: cold start slow).
  Results in `SRED…` Part G.
- **◑ Phase 5 — Frontend trigger (mesh path DONE, 2026-09-10):** `library.ts`
  `generateImageTo3D`/`imageTo3DStatus`; **AssetPanel "Generate 3D"** on image assets
  (Fast/Balanced/Max) → dispatch → poll (`refetchInterval`) → new asset opens in the existing
  Three.js viewer (no adapter change — `assetIs3DModel` already routes it). Type/lint-clean.
  Results in `SRED…` Part H. **Deferred:** standalone panel + **splat viewer adapter** (with
  Phase 3b); in-browser visual QA + normal-map correctness check.
- **Phase 6 — Assessment (~1 d):** seam/quality/latency/cost across tiers and both output
  formats; record findings.

## Risks

- **Build fragility (primary):** TRELLIS.2's custom CUDA kernels (CuMesh/FlexGEMM/o-voxel/
  flash-attn) compile from source against torch 2.6.0/cu124 — the main Modal-image risk. Pin
  exactly, use the CUDA-devel base, cache the built image. (Phase 1 is essentially this.)
- **Rasterizer parity (the one open question):** PyTorch3D's `MeshRasterizer` must reproduce
  nvdiffrast's per-texel faceID+barycentric coverage at 2K–4K without gaps at island edges;
  fall back to a custom Torch AABB rasterizer if coverage differs (U2/U3, Phase 2).
- **DINOv3 gating/compliance:** build needs an `HF_TOKEN` with accepted DINOv3 terms;
  product needs "Built with DINOv3" attribution (T-F3).
- **VRAM at 1536³ + 4B:** default to A100-80GB; gate `max` tier on GPU availability.
- **Splat quality:** synthesized splats (surface points + albedo) are lower-fidelity than a
  native radiance field (none exists — T-F7); set expectations accordingly.
- **Splat viewer maturity:** `@mkkellogg/gaussian-splats-3d` integrates with three.js but
  co-existence with the existing annotation-overlay/camera stack needs validation; keep it
  a separate adapter so it can't regress the mesh viewer.

## Licensing summary

MIT/BSD-3/Apache-2.0 throughout: TRELLIS.2 + CuMesh + FlexGEMM + o-voxel (MIT), utils3d (MIT),
**ZhengPeng7/BiRefNet rembg (MIT)**, PyTorch3D (BSD-3), **gsplat (Apache-2.0)**,
meshoptimizer/gltfpack (MIT), Basis Universal + KTX-Software (Apache-2.0), Draco (Apache-2.0),
gltf-transform (MIT), pyrender (MIT), SciPy (BSD), three.js + loaders +
**@mkkellogg/gaussian-splats-3d (MIT)**.
**Removed / avoided (non-commercial):** `nvdiffrast` + `nvdiffrec` (NVIDIA Source Code License),
`briaai/RMBG-2.0` rembg (BRIA non-commercial → swapped for MIT BiRefNet).
**One non-permissive-but-commercial-OK weight:** DINOv3 conditioner (attribution + gated
download). Prior art confirming the deps are removable: ComfyUI/Pixal3D native (PyTorch+SciPy),
`kg-git-dev/trellis-refactored` (PyTorch3D), `IgorAherne/TRELLIS.2-stableprojectorz`.
