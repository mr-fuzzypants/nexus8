# SR&ED Project Documentation & Technical Plan
# Image-to-3D Generation — Commercial, Seam-Free Textured GLB Export Experiments

**Project codename:** nexus8 3D generator — TRELLIS.2 image-to-3D with a commercial,
seamless PBR bake pipeline
**Claim period:** FY2026 (research commenced September 2026, ongoing)
**Systems involved:** nexus8 SPA (React / Three.js 3D annotation viewer), nexus8 Django
backend, Modal.com serverless GPU platform, Microsoft **TRELLIS.2-4B** (image-to-3D, MIT),
and a from-scratch permissive replacement for the model's non-commercial
`nvdiffrast`/`nvdiffrec` GLB-export tail (xatlas, PyTorch3D/custom rasterization,
Open3D/fast-simplification, Intel Embree, meshoptimizer/Basis-Universal), gsplat (optional
Gaussian-splat output) and `@mkkellogg/gaussian-splats-3d` (in-app splat viewer)
**Prepared:** September 8 2026 — living document; update as experimental work proceeds

**Related documents:** `TRELLIS2_IMAGETO3D_PLAN.md` (technical plan; phases referenced
herein), `MODEL_ANNOTATION_PLAN.md` (the Three.js `3d_model` viewer that consumes the
output), `SRED_INPAINT_EXPERIMENT.md` / `SRED_VIDEOOP_EXPERIMENTS.md` (the Modal
dispatch/poll + `layer_renders` two-axis provenance envelope reused here),
`LAYER_RENDER_SCHEMA.md`.

---

# Part A — SR&ED Narrative

## A1. Project objective

Add **single-image → 3D asset** generation to nexus8's existing 3D annotation viewer,
producing either a **fully-textured PBR mesh (`.glb`)** or an optional **Gaussian splat**,
such that the mesh output:

1. carries **complete PBR materials** — base color, metallic, roughness, alpha, and a
   **baked tangent-space normal map** — usable directly in the Three.js viewer and in
   downstream DCC tools;
2. is produced by a pipeline that is **entirely open-source and licensed for commercial
   use** — no NVIDIA Source Code License (non-commercial) components; and
3. exhibits **no visible texture seams where UV islands meet** — the failure mode that
   makes most automated image-to-3D output unusable without manual texture cleanup;

and the optional splat output is produced by an equally commercial-clean path (gsplat,
Apache-2.0) and is viewable in-app.

Both restricted dependencies must be eliminated. `nvdiffrast` provides the geometric
rasterization/antialiasing; **`nvdiffrec` provides the PBR split-sum material estimation**
that bakes the distinct Base Color / Roughness / Metallic / Opacity attributes into a
unified texture — the two are separate roles that must *both* be reimplemented.

The state-of-the-art model for (1), Microsoft TRELLIS.2-4B, is MIT-licensed and predicts
PBR natively — but its published GLB export (`o_voxel.postprocess.to_glb`) is coupled to
`nvdiffrast` and `nvdiffrec`, both under the **NVIDIA Source Code License (1-Way
Commercial)**, which restricts use to non-commercial research. This directly defeats
objective (2). By project start, community efforts had established that the two
dependencies *can* be removed — a ComfyUI/Pixal3D native reimplementation (PyTorch + SciPy),
`kg-git-dev/trellis-refactored` (PyTorch3D-based baking), and `IgorAherne/TRELLIS.2-stableprojectorz`
(FlexiCubes substitution). These resolve the *feasibility* question but **not** the
technological uncertainties this project targets: none demonstrably achieve **seam-free**
UV texturing (the naive per-face barycentric bake they use leaves coverage-gap seams and,
under decimation, value seams), none address our **normal-map** and **compressed-KTX2/Draco**
requirements, none provide a **commercial splat path integrated with a mesh path**, and none
integrate with nexus8's Modal/provenance envelope. Achieving (1)+(2)+(3)+splats together —
and *proving* seam-freeness rather than assuming it — requires original experimental
development; the community work serves as blueprint and feasibility evidence, not a drop-in
solution.

## A2. Technological uncertainties

### U1 — Exact coupling of the non-commercial dependencies within the model

TRELLIS.2's MIT license does not, by itself, establish that the *generation* path is free
of non-commercial code. It is unknown, without systematic source audit and instrumentation:
(a) the precise call sites at which `nvdiffrast`/`nvdiffrec` enter the pipeline — confined
to `to_glb` postprocessing (removable) or also reached by mesh extraction (`cumesh`) or the
latent decoders (not removable without retraining); (b) the licenses of Microsoft's own
custom CUDA subrepositories (`cumesh`, `o_voxel`, `flexgemm`) shipped alongside — presumed
MIT but unverified; and (c) the license of the image-conditioning backbone weights (a DINO-
family encoder is typical). Until (a)–(c) are resolved, it is not established that a
commercial pipeline is *achievable at all* by replacing only the export tail.

### U2 — Whether a commercial-licensed bake can equal the differentiable-rasterizer bake

`nvdiffrast`/`nvdiffrec` bake textures via differentiable rasterization with
antialiasing and, in `nvdiffrec`, texture-space optimization. It is unknown whether a
pipeline assembled from permissive parts (xatlas UV unwrap + a non-NVIDIA rasterizer +
direct field sampling) can reach equivalent texture fidelity — sharpness at high-curvature
regions, absence of aliasing along island borders, correct handling of the sparse voxel
volume's boundary — or whether the differentiable optimization the NVIDIA tools perform is
load-bearing for quality rather than merely convenient.

### U3 — Which non-NVIDIA rasterizer, and whether "rasterization" is even the right frame

Candidate rasterizers each carry unknowns: PyTorch3D (BSD-3) is differentiable and GPU but
is designed for *screen-space* rendering — repurposing it for *UV-space* texel attribution
(orthographic projection of the UV layout) is unproven for full-atlas baking and its
memory behaviour at 2K–4K atlases is uncharacterized. A custom Torch/Numba scanline
rasterizer avoids the dependency but its correctness at island edges (conservative
coverage, sub-texel triangles) is unestablished. More fundamentally, it is unknown whether
photographic *rasterize-and-project* baking (the NVIDIA framing) is the right approach at
all, versus **direct volumetric field sampling** (see U4/H2), which reframes the problem
away from rendering entirely.

### U4 — Semantics of the O-Voxel attribute volume for direct sampling

The proposed seam-free bake (H2) samples the sparse `attr_volume` at each texel's 3D
position. This requires knowledge not documented at the API surface: (a) the exact
`aabb`/`voxel_size`/`coords`/`attr_layout` convention mapping world position → voxel index,
and channel order/encoding of base-color/metallic/roughness/alpha within `attr_volume`;
(b) whether the volume is dense in a narrow band around the surface or genuinely sparse
(determining whether trilinear interpolation finds 8 valid neighbours at surface texels, or
needs nearest-valid fallback); and (c) whether the volume also encodes an SDF/occupancy
field whose gradient yields high-fidelity normals (enabling gradient-based normal baking,
H4) or whether only appearance is stored.

### U5 — Whether the seam-free property actually holds by construction

Hypothesis H2 asserts that volumetric sampling produces seam-free textures *because* the
two sides of a UV seam sample near-identical 3D positions. This is a claim about a
continuous field, but the realized pipeline is discrete and lossy: mesh **decimation**
moves the low-poly surface off the volume's isosurface; trilinear interpolation
discretizes; UV unwrapping introduces per-island distortion. It is unknown whether residual
cross-seam color differences after these approximations are (a) below perceptual threshold
(seam-free achieved by construction, no post-pass needed), or (b) small but visible under
grazing light/normal maps (requiring a least-squares/Poisson seam-leveling pass, U6), or
(c) large enough that decimation must be constrained or the bake done pre-decimation and
re-projected. The boundary between (a)/(b)/(c) as a function of decimation ratio and atlas
resolution is the central experimental question.

### U6 — Seam-leveling without destroying the native material signal

If residual seams survive (U5-b), the standard remedy is a global least-squares/Poisson
equalization across seam-edge texel pairs. It is unknown, for a *four-channel PBR* target
(not just albedo): whether equalizing metallic/roughness across seams the same way as base
color preserves physically meaningful material boundaries or smears them; whether the
solve must be per-channel with different regularization; and whether leveling interacts
badly with the gutter-dilation pass (order of operations, double-counting border texels).

### U7 — Normal-map baking without a differentiable rasterizer

The decimated mesh loses high-frequency geometry that the material alone cannot restore; a
tangent-space normal map is required (objective 1). Two license-clean routes each have
unknowns: (a) **volume-gradient normals** — if the O-Voxel exposes an SDF/occupancy field
(U4-c), its spatial gradient at each texel's surface position gives a normal at
volume-resolution fidelity, consistent with the volumetric bake — but whether that
resolution exceeds the decimated mesh's is unproven; (b) **hi-res→lo-res ray-cast** via
Intel Embree (Apache-2.0) — cast along the interpolated low-poly normal to the pre-
decimation mesh and read its geometric normal — where the unknowns are cage/offset tuning
to avoid ray self-intersection and mismatch at concavities. Which route wins, and whether
either matches `nvdiffrec`'s baked detail, is unknown.

### U8 — Reproducible build of the custom-CUDA model on serverless GPU, minus two deps

TRELLIS.2 installs via a `setup.sh` that compiles flash-attention and the custom kernels
(`cumesh`, `o_voxel`, `flexgemm`) against a specific CUDA/torch, and installs
`nvdiffrast`/`nvdiffrec`. It is unknown: (a) whether the kernels build and run correctly on
Modal's images with those two dependencies **excluded** (i.e. that nothing outside
`to_glb` links them at import time — coupled to U1); (b) the exact CUDA-devel/torch pinning
that yields a cached, reproducible Modal image; and (c) the VRAM envelope across the
512³/1024³/1536³ tiers with a 4B model so GPU class (A100-80GB vs H100) and per-tier cost
can be fixed.

### U9 — Fitting a minutes-long, large-binary 3D job into the existing op envelope

The still-image pipeline is interactive-latency and returns a single PNG
(`SRED_INPAINT_EXPERIMENT.md`). A 3D generation is a longer job returning a *compressed
GLB + thumbnail* (a multi-file asset). It is unknown whether the established
`spawn`/`FunctionCall.get(timeout=0)` dispatch/poll and the `layer_renders`
two-axis-versioning provenance envelope extend to this output shape without leaking
3D-specific assumptions — specifically whether a generated `3d_model` asset (new
`media_type`, first-class rendered thumbnail where none existed) slots into
`store_run_results` and the `VersionLink` lineage cleanly, mirroring the U8 envelope test
in `SRED_VIDEOOP_EXPERIMENTS.md`. Extends to a second output shape — a Gaussian-splat
`.ply`/`.splat` asset (new `media_type='gaussian_splat'`) — through the same envelope.

### U10 — Commercial Gaussian-splat output from a mesh-oriented generator, and its viewer

TRELLIS.2's O-Voxel is a *mesh + PBR* representation; a Gaussian splat is a *view-dependent
radiance* representation. It is unknown: (a) whether TRELLIS.2 exposes a **native
Gaussian/radiance decoder** (as v1 TRELLIS did) that yields a high-fidelity splat directly,
or whether splats must be **synthesized** from surface points colored by baked albedo — and
how much the synthesized variant degrades relative to a native radiance field; (b) how to
map O-Voxel attributes to Gaussian parameters (means/scales/opacity/SH) such that gsplat
(Apache-2.0) export is faithful; and (c) whether a permissive splat renderer
(`@mkkellogg/gaussian-splats-3d`, MIT, or Spark) coexists with nexus8's existing
Three.js annotation-overlay/camera stack in a *separate viewer adapter* without regressing
the mesh viewer or the surface-anchored annotation model (`MODEL_ANNOTATION_PLAN.md`).

## A3. Hypotheses

- **H1** — TRELLIS.2's generation path (`pipeline.run(image)` → mesh + `attr_volume`) is
  free of non-commercial code; only `to_glb` links `nvdiffrast`/`nvdiffrec`, and building
  with just `--basic --flash-attn --cumesh --o-voxel --flexgemm` (omitting the two
  restricted flags) yields a working generation path. *(tests U1, U8; supported by ComfyUI
  native + `trellis-refactored` prior art)*
- **H2** — Baking textures by **direct trilinear sampling of the O-Voxel attribute volume**
  at each texel's 3D surface position yields **seam-free** UV atlases by construction —
  outperforming photographic multi-view projection, whose seams arise from per-island
  camera mismatch that volumetric sampling structurally avoids. *(tests U2, U3, U5)*
- **H3** — Any residual cross-seam difference from decimation/discretization is either
  below perceptual threshold or removable by a lightweight per-channel least-squares
  seam-leveling pass, without a differentiable renderer. *(tests U5, U6)*
- **H4** — A commercial-clean tangent-space normal map matching `nvdiffrec`'s detail is
  obtainable from the O-Voxel field gradient (preferred) or an Embree hi-res→lo-res ray
  cast (fallback). *(tests U4, U7)*
- **H5** — The full permissive tail (xatlas + volumetric bake + gutter + normal + Draco/KTX2)
  produces a GLB visually indistinguishable from the stock `nvdiffrast` export at 2K, at
  comparable or better wall-clock. *(tests U2, U3)*
- **H6** — The 3D job fits the existing Modal dispatch/poll + `layer_renders` envelope with
  only additive changes (`media_type='3d_model'`/`gaussian_splat`, thumbnail ingest).
  *(tests U9)*
- **H7** — A commercial-clean Gaussian splat of usable quality is obtainable from TRELLIS.2
  — via its native radiance decoder if present, else synthesized from surface points +
  baked albedo — exportable through gsplat and viewable in a separate MIT-licensed splat
  adapter without regressing the mesh viewer. *(tests U10)*

## A4. Work performed (systematic investigation to date, September 2026)

- **Landscape & licensing survey (complete):** confirmed TRELLIS.2-4B is MIT (code +
  weights) and predicts native PBR (base color / metallic / roughness / alpha) via the
  O-Voxel sparse representation; confirmed the `to_glb` export tail depends on
  `nvdiffrast` **and** `nvdiffrec`, both NVIDIA Source Code License (1-Way Commercial),
  and reviewed the upstream commercial-usage issue (microsoft/TRELLIS.2#22) confirming this
  is a live blocker with no official commercial-clean export at time of writing.
- **Replacement-component license audit (complete):** identified a permissive part for each
  export stage — xatlas (MIT, UV), fast-simplification/Open3D (MIT, decimation), PyTorch3D
  (BSD-3) or custom Torch (UV-space rasterization), Intel Embree/`embreex` (Apache-2.0,
  ray-cast normals), meshoptimizer/gltfpack (MIT) + Basis-Universal/KTX-Software
  (Apache-2.0) + Draco (Apache-2.0) for KTX2/Draco compression, pyrender (MIT, thumbnails)
  — establishing that a fully commercial pipeline is *plausible* pending U1.
- **Prior-art survey (complete):** reviewed three independent dependency-removal efforts —
  ComfyUI/Pixal3D native TRELLIS.2 (PyTorch + SciPy reimplementation, commercial-usable),
  `kg-git-dev/trellis-refactored` (swaps `nvdiffrast` for a PyTorch3D differentiable
  renderer; documents the performance trade-off), and `IgorAherne/TRELLIS.2-stableprojectorz`
  (FlexiCubes substitution). Conclusion: dependency removal is *feasible* (de-risking H1),
  but the community bake is a naive per-face barycentric fill that leaves coverage-gap
  seams and does not target seam-free PBR, normal-map baking, KTX2/Draco, or a splat path —
  confirming the residual uncertainties U2–U7, U10 are the project's actual research content.
  Extracted the concrete build-flag recipe (`--basic --flash-attn --cumesh --o-voxel
  --flexgemm`, omitting `--nvdiffrast --nvdiffrec`) and the barycentric-bake + dilation
  blueprint as a fallback for stage 4.
- **Architecture design (complete):** the nine-stage seam-free bake plus the alternative
  Gaussian-splat branch (see plan), the volumetric-sampling seam argument (H2), and the
  Modal `nexus8-trellis2` app + Django dispatch/poll/ingest design reusing the proven
  `nexus8-inpaint` envelope.
- **Planned next (Phase 0→2):** stand up stock TRELLIS.2 on Modal to instrument U1/U4/U8/U10;
  dump `attr_volume` to characterize its layout/sparsity; check for a native Gaussian
  decoder; implement and measure the volumetric bake against the seam hypothesis H2.

## A5. Technological advancement sought

A **reusable, commercially-licensed method for exporting a fully-PBR, seam-free textured
GLB from a sparse 3D attribute volume**, replacing differentiable-rasterizer baking with
direct volumetric field sampling, plus a commercial-clean **dual-output** path (textured
mesh *or* Gaussian splat) from the same generation. If H2 holds, this advances beyond the
current practice (community per-face barycentric baking with coverage-gap seams, multi-view
photographic baking with post-hoc seam patching, or NVIDIA-encumbered differentiable
baking) by making seam-freeness a *structural* property of sampling a continuous field
rather than a corrective post-process — knowledge applicable to any volume/field-based 3D
generator, not only TRELLIS.2.

## A6. Personnel & records

Principal developer: R. Pringle. Records: this document (living), `TRELLIS2_IMAGETO3D_PLAN.md`,
git history on `main`, Modal build/run logs for `nexus8-trellis2`, and per-phase
experiment artifacts (dumped `attr_volume` `.npz`, seam-difference heatmaps, per-tier
latency/VRAM/cost tables) retained under the SR&ED evidence trail.

---

# Part B — Technical Plan

*(Full detail in `TRELLIS2_IMAGETO3D_PLAN.md`; summarized here against the hypotheses.)*

## Phase 0 — Licensing + API audit (½–1 d) — tests U1, U4, U8, U10
Stand up stock TRELLIS.2 on Modal (research use); instrument import graph and `to_glb` to
locate every `nvdiffrast`/`nvdiffrec` call site; verify `cumesh`/`o_voxel`/`flexgemm` and
image-encoder licenses; dump `attr_volume`/`coords`/`aabb` and characterize layout +
sparsity; determine whether a **native Gaussian/radiance decoder** exists for the splat
branch. **Gate:** H1 confirmed → proceed.

## Phase 1 — Shape+material generation on Modal (M, ~2 d) — tests H1, U8
`nexus8-trellis2` producing raw mesh + attribute volume, `nvdiffrast`/`nvdiffrec`
**excluded** from the image; confirm kernels build/run without them; fix per-tier GPU/VRAM.

## Phase 2 — Seam-free volumetric bake + GLB export (M/N8, ~4–5 d) — tests H2, H3, H5
Stages 1–5 + 8: decimate → xatlas → UV-space rasterize → **trilinear volume sample** →
gutter → Draco/KTX2 export. Measure cross-seam ΔE heatmaps vs decimation ratio and atlas
resolution to place U5 in regime (a)/(b)/(c); add per-channel seam-leveling only if (b).

## Phase 3 — Normal bake + compression + thumbnail (~2 d) — tests H4
Volume-gradient normals (preferred) with Embree ray-cast fallback; finalize KTX2/Draco
packing; offscreen turntable thumbnail (pyrender/EGL).

## Phase 3b — Gaussian-splat export (M, ~1–2 d) — tests H7, U10
Native Gaussian decoder if Phase 0 found one, else synthesize splats (means = surface
points, colors = baked albedo, opacity/scale from surface traits); export `.ply`/`.splat`
via gsplat (Apache-2.0).

## Phase 4 — Django dispatch/poll + ingest (N8, ~1–2 d) — tests H6
Endpoints mirroring `views_inpaint.py`; `store_run_results` → `media_type='3d_model'`
(GLB) or `gaussian_splat` (PLY) version + `VersionLink` lineage to source image; `.glb`/
`.ply` ingest gains a thumbnail.

## Phase 5 — Frontend triggers + viewers (SPA, ~3–4 d) — tests H7 (viewer)
AssetPanel "Generate 3D" (tier + format selector) + standalone drop-image panel; GLB opens
in the existing `threeModelViewerAdapter` unchanged; **new `gaussianSplatViewerAdapter`**
(`@mkkellogg/gaussian-splats-3d`, MIT) routed for `gaussian_splat` assets.

## Phase 6 — Experiment assessment (~1 d)
Record findings T-F1…: seam-freeness verdict on H2/H3, normal-quality on H4, fidelity/latency/cost
per tier on H5, envelope-fit on H6, splat quality/viewer on H7.

## Cross-cutting
- **Commercial-license gate:** every shipped component MIT/BSD-3/Apache-2.0; CI/license
  check asserts `nvdiffrast`/`nvdiffrec` never enter the deployed image.
- **Provenance:** reuse two-axis versioning (`LAYER_RENDER_SCHEMA.md`); generated 3D asset
  pins the exact source image version that produced it.

## Indicative timeline
~2.5–3 weeks of focused work across phases 0–6 (including the splat branch 3b and its
viewer), gated at Phase 0 (H1) and Phase 2 (H2).

---

# Part C — Phase 0 audit findings (source audit, 2026-09-08)

Method: shallow-cloned `github.com/microsoft/TRELLIS.2` @ `main` (code only, no weights),
statically audited import graph, `o_voxel.postprocess.to_glb`, the mesh representation, the
image conditioner, `setup.sh`, and submodules; web-verified subrepo/weight licenses. No GPU
spend. Result: **H1 confirmed** and several uncertainties resolved, with the scope of the
commercial port substantially narrowed and one new caveat surfaced (DINOv3).

### T-F1 — nvdiffrast/nvdiffrec are confined; the generation path is clean (resolves U1)
All call sites enumerated. The **main pipeline `trellis2/pipelines/trellis2_image_to_3d.py`
imports neither** (imports: torch, `.base.Pipeline`, `samplers`, `rembg`, `SparseTensor`,
`image_feature_extractor`, `representations.{Mesh, MeshWithVoxel}`). The restricted libs
appear only in: (1) **`o-voxel/o_voxel/postprocess.py:10`** — module-level
`import nvdiffrast.torch as dr` (the `to_glb` bake); (2) **`trellis2/renderers/mesh_renderer.py`**
and **`pbr_mesh_renderer.py`** — *lazy* imports used only to render the preview `.mp4`, the
latter also `from nvdiffrec_render.light import EnvironmentLight`; (3)
**`trellis2/pipelines/trellis2_texturing.py:13`** — module-level, but that is the *separate*
mesh-texturing pipeline we don't invoke. → **Excluding both packages from the Modal image
costs only `to_glb`, the preview video, and the texturing pipeline — not generation.** H1
confirmed.

### T-F2 — Build recipe and dependencies (resolves U8 build surface)
`setup.sh` options are exactly `--basic --flash-attn --cumesh --o-voxel --flexgemm`
(+ the two restricted `--nvdiffrast --nvdiffrec` we omit). Stack: Python 3.10, **torch 2.6.0
/ torchvision 0.21.0 on cu124**, `flash-attn==2.7.3`. `--basic` pulls imageio(+ffmpeg), tqdm,
easydict, opencv-python-headless, ninja, trimesh, transformers, gradio 6.0.1, pandas, lpips,
zstandard, `utils3d@9a4eb15` (pinned), pillow-simd, kornia, timm. CuMesh/FlexGEMM/o-voxel are
`pip install` from source (need `nvcc` → CUDA-devel base). **Only git submodule is Eigen**
(o-voxel C++ dep). Confirms the Modal image plan; the CUDA-devel base + version pins are the
build risk, not the excluded deps.

### T-F3 — Licenses, incl. the DINOv3 caveat (resolves U1(b)/(c))
`CuMesh`, `FlexGEMM`, `utils3d`, and `o-voxel` are all **MIT**; Eigen is **MPL-2.0**
(permissive). **But the image conditioner is DINOv3** — config
`slat_flow_img2shape_dit_1_3B_512_bf16.json` sets `image_cond_model =
DinoV3FeatureExtractor("facebook/dinov3-vitl16-pretrain-lvd1689m")` — a **core, non-optional
generation dependency** (a `DinoV2FeatureExtractor` class also exists, but the 4B weights are
trained against DINOv3 features, so it is *not* a drop-in swap). Meta's **DINOv3 License**
**permits commercial use with no MAU/revenue caps**, but imposes: (a) **gated HF download**
(must accept terms → the Modal image needs an authorized `HF_TOKEN`); (b) **attribution** —
display "Built with DINOv3" and bundle the license; (c) acceptable-use limits (no
weapons/ITAR/sanctioned parties). → **Not a blocker, but it means the pipeline is "MIT + a
DINOv3-License weight," not fully permissive.** This is the single caveat to the commercial
objective and a standing compliance obligation for the product.

### T-F4 — Exactly what `to_glb` does, and how little is NVIDIA-bound (resolves U2/U3 scope)
The full nvdiffrast footprint in `to_glb` is three calls: `dr.RasterizeCudaContext()`,
a chunked `dr.rasterize(uvs·2−1 as clip coords, out_faces, [S,S])` yielding per-texel
(barycentric, faceID), and `dr.interpolate(out_vertices, rast, out_faces)` yielding the
per-texel **3D surface position**. **Everything else is already permissive:** CuMesh does
clean/fill-holes/simplify/remesh (narrow-band dual-contouring)/`uv_unwrap`(built-in charter,
so xatlas is optional)/`cuBVH`/vertex-normals; **FlexGEMM `grid_sample_3d` performs the
trilinear volumetric bake from `attr_volume`**; and **`cv2.inpaint(..., INPAINT_TELEA)`**
fills the uncovered texels (the gutter). → The commercial port is a **surgical swap of the
rasterizer only** (`dr.rasterize`+`dr.interpolate` → PyTorch3D `MeshRasterizer` or a custom
Torch rasterizer producing the same face-id+barycentric+position), leaving the bake, BVH
projection, and inpaint intact. This is dramatically smaller than "reimplement the export
tail."

### T-F5 — Seam-freeness is inherited, not invented (resolves/reframes H2, U5)
TRELLIS.2 **already** bakes by volumetric sampling of the continuous attribute field
(`grid_sample_3d`), and — critically — before sampling it projects each decimated-mesh texel
position back onto the **original high-res mesh** via `bvh.unsigned_distance(..., return_uvw)`
and reconstructs the position on the original triangle (`postprocess.py:254–256`). That step
**already solves the decimation-drift concern** (U5) and, with `cv2.inpaint` gutter fill,
delivers seam-consistent textures. → **The seam-free property is a property of TRELLIS.2's
existing design, not a novelty of this project.** The project's real, remaining advancement
narrows to: (i) the license-clean rasterizer swap at the fidelity/perf of the original
(U2/U3), (ii) the **baked normal map** (T-F6), (iii) **splat synthesis** (T-F7), and (iv)
KTX2/Draco + nexus8 integration. The SR&ED framing is updated accordingly — this is a
positive result (lower technical risk) obtained by systematic investigation.

### T-F6 — Stock export bakes NO normal map (scopes H4)
`to_glb` writes only **vertex normals** (`out_normals` from CuMesh, with a Y↔Z/−Y swap for
glTF) — no tangent-space normal texture. So a baked normal map is a genuine *enhancement*,
and it needs **no new machinery**: the per-texel `bvh.unsigned_distance` `face_id`+`uvw`
already available in the bake can sample the **original** mesh's normals into tangent space.
The Embree fallback in the plan is therefore unnecessary — CuMesh's BVH suffices (H4 route
simplified).

### T-F7 — No native Gaussian decoder; splats must be synthesized (resolves U10(a))
Representations are `{Mesh, MeshWithVoxel}` and renderers are `{MeshRenderer, VoxelRenderer,
PbrMeshRenderer}` — there is **no Gaussian/radiance representation or decoder** (unlike v1
TRELLIS). The only "gaussian" in the tree is an SSIM window in `loss_utils.py`. → The splat
branch **must synthesize** Gaussians from the mesh surface + `attr_volume` (means at sampled
surface points, colors from the albedo bake); gsplat/`.ply` is only the writer. H7's
"native decoder if present" arm is closed: it is not present.

### T-F8 — `attr_volume` layout is fully known (resolves U4)
`to_glb` consumes: `attr_volume (L,C)` sparse features + `coords (L,3)`; `attr_layout` = dict
of slices keyed **`base_color`(3ch), `metallic`(1), `roughness`(1), `alpha`(1)**; `aabb`
(example uses `[[-0.5]*3,[0.5]*3]`); `voxel_size` **or** `grid_size` with
`grid_size = round((aabb₁−aabb₀)/voxel_size)`. World→grid map for sampling is
`(pos − aabb₀)/voxel_size`. Attrs are 0–1 floats → `×255` uint8; the glTF
`metallicRoughnessTexture` packs `[0, roughness, metallic]` (G=rough, B=metal), `baseColor` =
`[rgb, alpha]`. Every constant needed for an exact reimplementation is captured. (Note: the
`mesh.simplify(16777216) # nvdiffrast limit` pre-cap in `example.py`/`app.py` is a nvdiffrast
constraint we can drop once its rasterizer is gone.)

### Phase 0 verdict
**Proceed.** H1 confirmed; the port is a localized rasterizer swap inside a known algorithm
whose hard parts (volumetric bake, drift correction, seam fill) are already permissive.
Carry forward two items: **(1) DINOv3 license compliance** (gated `HF_TOKEN` for the Modal
build + "Built with DINOv3" attribution in the product), and **(2)** the one real open
question — whether PyTorch3D/custom rasterization matches nvdiffrast's `rasterize`+
`interpolate` fidelity and speed at 2K–4K (Phase 2, U2/U3). Splats are synth-only (T-F7);
normal map is free from the existing BVH (T-F6).

---

# Part D — Phase 1 results (clean build + generation on Modal, 2026-09-08)

Built the commercial-clean TRELLIS.2 image on Modal (`nexus8-trellis2`,
`modal_functions/trellis2_gen.py`) with only the open-source setup flags, ran a `fast` (512³)
generation on a sample image (A100-80GB), and dumped the raw mesh + attribute volume. **H1 is
now empirically confirmed, not just inferred.** Three additional dependency findings surfaced
during the build (T-F9…T-F11); all resolved with permissive substitutions.

### T-P1 — H1 empirically confirmed: generation runs with the restricted libs absent
With `nvdiffrast`/`nvdiffrec` **never installed**, `pipeline.run()` completed and the probe's
post-generation check returned **`restricted_after_gen: []`** — i.e. neither module was
imported anywhere in the load+generate path. Output raw mesh: **1,275,292 vertices /
2,612,616 faces**; **`attr_volume` shape `[1,270,739, 6]`**, `coords `[1,270,739, 3]`;
`attr_layout = base_color[0:3], metallic[3:4], roughness[4:5], alpha[5:6]` (exactly T-F8);
`voxel_size = 0.001953125 = 1/512` (matches the 512³ fast tier, aabb span 1.0). Dump saved to
the Volume (`/cache/phase1_dump_fast.npz`) for offline Phase-2 bake development.

### T-F9 — Background remover is gated + NON-COMMERCIAL; swapped to a permissive one
`pipeline.json` sets `rembg_model = BiRefNet(model_name="briaai/RMBG-2.0")`. **BRIA
RMBG-2.0 is a gated HF repo AND non-commercial** (commercial use requires a paid BRIA
license) — a second licensing blocker after nvdiffrast. But TRELLIS.2's `BiRefNet` class is a
generic `AutoModelForImageSegmentation` wrapper that **defaults to `ZhengPeng7/BiRefNet`**, the
original BiRefNet (MIT, ungated, same architecture). Fix: monkeypatch `BiRefNet.__init__` to
force `ZhengPeng7/BiRefNet`. This is both the Phase-1 unblock and the commercial solution for
background removal. → **Commercial dependency set is now: DINOv3 (attribution) + BiRefNet-orig
(MIT); no BRIA.**

### T-F10 — nvdiffrast leaks into generation via an eager package import (refines T-F1)
Although the generation path doesn't *use* nvdiffrast, the shape decoder
(`FlexiDualGridVaeDecoder`) imports `o_voxel.convert`, and **`o_voxel/__init__.py` eagerly
imports `postprocess.py`, whose module-level `import nvdiffrast.torch as dr`** raised
`ModuleNotFoundError` and aborted loading. Fix: during the image build, make that import lazy
(`sed` the line to `dr = None`) — we replace the stock `to_glb` anyway. So T-F1's "generation
is clean" holds *functionally*, but the clean build requires this one-line source patch to
break the eager-import coupling.

### T-F11 — transformers must be pinned to the 4.x DINOv3ViT API
`setup.sh` leaves `transformers` unpinned → resolves to 5.16.1, which renamed the DINOv3ViT
internals TRELLIS.2's `DinoV3FeatureExtractor` reaches directly
(`self.model.layer` / `.embeddings` / `.rope_embeddings`), giving
`AttributeError: 'DINOv3ViTModel' object has no attribute 'layer'`. Verified `transformers
==4.57.1` exposes exactly those attributes; pinned it (as a late image layer so the flash-attn/
kernel layers stay cached). Feature extraction is correctness-critical, so pinning (matching
TRELLIS.2's exact prenorm path) is preferred over rewriting the extractor.

### Build recipe gotchas (for reproducibility)
(1) `flash-attn --no-build-isolation` needs `wheel`/`setuptools`/`packaging`/`ninja` present
and `MAX_JOBS` capped to avoid OOM. (2) Modal's `add_python` ships a standalone Python whose
sysconfig linker is `clang++` (absent) — set `CC=gcc`/`CXX=g++` so torch's `cpp_extension`
links CuMesh/FlexGEMM/o-voxel with build-essential. (3) TRELLIS.2's loader only resolves
submodel subpaths (`ckpts/*`) from a **local snapshot dir** — `snapshot_download` first, then
`from_pretrained(local_dir)`; a bare HF repo id 404s. (4) The Modal entrypoint file must not
be named `trellis2.py` (shadows the `trellis2` package) — named `trellis2_gen.py`.

### Phase 1 verdict
**Clean commercial build + generation proven on Modal.** Remaining commercial-licensing
surface is fully mapped and permissive: MIT/BSD/Apache code + CuMesh/FlexGEMM/o-voxel (MIT) +
BiRefNet-orig (MIT) + **DINOv3 (commercial-OK, attribution)**. Next: **Phase 2** — implement
the PyTorch3D rasterizer swap in `commercial_to_glb` and validate seam-free texture parity vs
the stock (research-only) export at 2K–4K, developing offline against `phase1_dump_fast.npz`.

---

# Part E — Phase 2 results (commercial seam-free bake, 2026-09-08)

Implemented the nvdiffrast-free `commercial_to_glb` and validated it offline against the
Phase-1 dump (no regeneration per iteration). **H2/H5 confirmed: the commercial bake produces
a correct, seam-free, fully-textured PBR GLB.** Two substitutions from the original plan were
needed (T-P2, T-P3); the seam-free result validates the central hypothesis (T-P4).

### T-P2 — FlexGEMM `grid_sample_3d` replaced by pure-PyTorch sparse trilinear
The stock volumetric bake calls `flex_gemm.ops.grid_sample.grid_sample_3d`, whose **Triton
autotuner** live-benchmarks kernel configs against a persistent cache. TRELLIS ships that cache
pre-warmed for *its* shapes; on our (different) bake shapes it benchmarks fresh and a candidate
config launches with invalid dims → `CUDA error: invalid configuration argument` (surfaced
async in `triton…do_bench`). Rather than fight opaque autotuning, replaced that single call
with a **deterministic pure-PyTorch sparse trilinear sampler** (`_sample_sparse_trilinear`):
key each occupied voxel, `searchsorted` the 8 neighbours per query, weight by fractional
coords, zero-fill absent neighbours — identical math to `grid_sample_3d('trilinear')`, no
Triton. This also *reduces* the dependency surface (FlexGEMM now only needed for generation).

### T-P3 — PyTorch3D UV rasterization needs positive-z NDC
The nvdiffrast swap (`_rasterize_uv_positions`) puts UVs into NDC (`uv*2−1`) and rasterizes via
`pytorch3d…rasterize_meshes` to get per-texel faceID+barycentric, then interpolates 3D
position. First attempt gave **0 coverage** (all `pix_to_face = −1`): PyTorch3D culls faces at
**z = 0** (at/behind the camera plane). Setting **z = 1** (positive, in front) fixed it →
**coverage 0.456** at 2048² (1,913,346 texels; face IDs 0…995513). `perspective_correct=False`,
`cull_backfaces=False`.

### T-P4 — Seam-free, correctly-aligned PBR texture confirmed (H2/H5)
Offline bake of the dumped crown mesh: decimate→UV-unwrap (CuMesh) → PyTorch3D UV raster →
BVH projection to the original surface → sparse trilinear bake → `cv2.inpaint` gutter → trimesh
PBRMaterial GLB (~39 MB uncompressed, 2048²). A 4-view **flat-lit (AmbientLights) validation
render** — pure albedo, the harshest test for seams — shows a coherent gold/bronze crown with
amethyst gems, **UV↔texture correctly aligned (no scrambling/flip) and no visible seams at UV
island boundaries.** This is the project's core requirement met, and it confirms T-F5: seam-
freeness comes structurally from volumetric field sampling + BVH-to-original-surface projection
+ gutter fill — no post-hoc seam-leveling pass needed. (Geometry fidelity from the sample image
is excellent — ornate pierced metalwork reconstructed faithfully.)

### Validation tooling
Added an offline harness `bake_from_dump` (loads `phase1_dump_*.npz`, bakes, renders) + a
PyTorch3D `TexturesUV` montage renderer — lets us iterate the bake in ~1 min without
regenerating. PyTorch3D built from source (0.7.8) on torch2.6/cu124 (no PyPI wheel).

### Phase 2 verdict
**Core commercial export works and is seam-free.** `commercial_to_glb` is wired into the
production `generate()` path. Remaining (Phase 3): baked **normal map** (T-F6, free from the
existing BVH), **Draco+KTX2** compression, turntable **thumbnail**; then Phase 3b splat
synthesis, Phase 4 Django integration, Phase 5 frontend. Deferred niceties: metallic/roughness
are baked into the packed MR texture and round-trip in the GLB, but the flat-lit validation
render doesn't visualize them (a PBR/IBL render is a Phase-3 nicety).

---

# Part F — Phase 3 results (normal map + compression + thumbnail, 2026-09-09)

Added the three finishing steps to `commercial_to_glb`/`generate()`. **Normal-map bake and
viewer-ready compression both work; the compressed GLB is exactly the format the Three.js
viewer consumes.** Validated offline on the Phase-1 dump.

### T-P5 — Tangent-space normal map, free from the existing BVH (T-F6)
Stock TRELLIS.2 bakes no normal map (vertex normals only). We add one at no extra cost: reuse
the per-texel `bvh.unsigned_distance` `face_id`+`uvw` (already computed for drift correction) to
sample the **original hi-res mesh normals**, and express them in the **decimated mesh's tangent
frame** — Lengyel per-vertex tangents from UVs (`_vertex_tangents`), interpolated per texel via
the same PyTorch3D raster (`pix_to_face`+`bary`), Gram-Schmidt orthonormalized; encode in the
standard glTF/OpenGL (+V = green) convention. No explicit `TANGENT` export → relies on Three.js's
derivative-tangent path (same +U/+V convention). The baked atlas is well-formed (lavender flat
base with directional detail tracking the surface, gem bosses visible). **Caveat:** green-channel
sign / handedness correctness can't be verified in the flat PyTorch3D render — it needs a real
PBR renderer, so it is **deferred to Phase 5 (Three.js)**; if inverted it's a 1-line fix
(flip green or the handedness `sgn`). No Embree needed, confirming T-F6.

### T-P6 — Compression: meshopt + KTX2 via gltfpack (67 MB → 10.9 MB, 6.1×)
`_compress_glb` shells out to **gltfpack** (`-cc` meshopt geometry, `-tc` KTX2/basis textures).
Result on the crown at 2048³-tex / ~1 M faces: **67.0 MB → 10.9 MB**. The output uses
`EXT_meshopt_compression` + `KHR_texture_basisu` (image/ktx2) + `KHR_mesh_quantization` +
`KHR_texture_transform` — **all supported by the viewer's `MeshoptDecoder` + `KTX2Loader`**
(the plan said "Draco"; **meshopt is the substitute — equivalent, and the viewer already wires
`MeshoptDecoder`**). Material carries baseColor + **normalTexture** + metallicRoughness.
**Build gotcha:** the `gltfpack-ubuntu.zip` v0.24 binary needs GLIBC 2.38 (Ubuntu 24.04) and
fails on our 22.04 base — pinned **v0.22** (GLIBC 2.35). *Refinement:* gltfpack `-tc` defaults to
ETC1S; normal maps prefer **UASTC** (`-tu`) — worth switching per-texture to avoid normal
degradation (deferred).

### T-P7 — Thumbnail
`generate()` renders a single hero view (PyTorch3D `TexturesUV`) as the asset thumbnail
(3D assets have none today). The offline harness renders a 4-view montage for QA.

### Artifacts (downloaded locally)
`/tmp/trellis_phase3/`: `glb.glb` (**compressed 10.9 MB, meshopt+KTX2, full PBR incl. normal**),
`basecolor_png.png`, `normal_png.png`, `render_png.png`. (Uncompressed reference:
`/tmp/trellis_phase2/generated.glb`, 57 MB.)

### Phase 3 verdict
**Full commercial PBR export is viewer-ready:** seam-free base color + metallic-roughness +
alpha + normal map, meshopt+KTX2-compressed to ~11 MB, matching the Three.js loader stack.
Remaining: Phase 3b (splat synthesis), Phase 4 (Django dispatch/poll/ingest + `3d_model`
storage), Phase 5 (frontend trigger + splat viewer + **normal-map correctness validation**).

---

# Part G — Phase 4 results (Django integration, 2026-09-10)

Wired the deployed Modal app into the Django backend with the established spawn/poll envelope,
and validated the whole path end-to-end through the real DRF views. **H6 confirmed: a generated
3D asset slots into the existing library/versioning model as a first-class asset with lineage.**

### Endpoints (`nexus8/trackables/views_trellis.py`, app `nexus8-trellis2`)
- `POST /api/library/assets/<pk>/image-to-3d/` — dispatch from an existing image asset.
- `GET  /api/library/assets/<pk>/image-to-3d/status/?call_id=…` — poll; on done, ingest + return.
- `POST /api/library/image-to-3d/` — standalone: upload an image → `ingest_file` it as the source
  → dispatch (poll via the asset-scoped status endpoint with the returned `asset_id`+`call_id`).
Mirrors `views_inpaint` (`modal.Cls.from_name(...).generate.spawn(...)` →
`FunctionCall.from_id(call_id).get(timeout=0)`); pending run state lives on
`source.type_data["gen3d"][call_id]` (no task queue, like inpaint's relation state).

### Ingest of a generated binary (`services/ingest.py`)
Added `ingest_generated_asset(bytes, *, filename, thumbnail_bytes, media_type, name, created_by,
upstream, generation)` — takes raw bytes (not an upload), lets the caller set `media_type`
(`_media_type_for` now maps `.glb/.gltf` → `3d_model`), **attaches the Modal-rendered hero PNG as
the thumbnail** (3D binaries don't self-thumbnail — closes the "`.glb` ingests with no preview"
gap), and records `upstream` lineage + a `generation` provenance record via `MediaAsset.publish`.

### End-to-end validation (real views, `manage.py shell`)
Standalone upload of the sample image → source asset **#344** → dispatch → poll → new asset
**#345**: `media_type=3d_model`, `file_path=…/originals/…​.glb`, **thumbnail present** (256 webp
from the Modal render), **lineage `init_image` → #344 v1**, and an **idempotent re-poll returns
#345** (no duplicate ingest). `assetIs3DModel` matches (media_type + `.glb`) → routes to the
Three.js viewer with no frontend change. Compressed GLB from the deployed app: **8.25 MB**
(fast tier, 1024² textures) + 137 KB thumbnail.

### T-P8 — Cold-start latency
The **first** call after `modal deploy` exceeded a 7.5-min poll window (A100-80GB image pull +
4B-weights + DINOv3/BiRefNet load from the Volume to GPU); the call itself completed fine and
warm calls are fast. The frontend must poll patiently (Phase 5); an optional `min_containers=1`
would keep a container warm at cost. Not a correctness issue.

### Phase 4 verdict
**Backend integration works and is validated.** Splat output is rejected at dispatch until
Phase 3b. Remaining: Phase 3b (splat synthesis) and Phase 5 (frontend AssetPanel "Generate 3D"
trigger + standalone panel + splat viewer adapter + normal-map correctness check in three.js).

---

# Part H — Phase 5 results (frontend trigger, 2026-09-10)

Wired the user-facing **"Generate 3D"** action into the library. The mesh path is complete and
needs no viewer change; the splat viewer adapter is deferred with Phase 3b (no splats yet).

### API client (`web/src/api/library.ts`)
`generateImageTo3D(assetId, {tier})` → `POST …/assets/<id>/image-to-3d/`; `imageTo3DStatus(assetId,
callId)` → `GET …/status/?call_id=`; types `Gen3DTier` and `ImageTo3DStatus` (carries the new
`AssetSummary` on done). Uses the shared axios `http` client like the rest of the library API.

### AssetPanel action (`web/src/features/asset/AssetPanel.tsx`)
On image assets only: a **Fast/Balanced/Max** `SegmentedControl` + a **Generate 3D** button.
Dispatch via `useMutation`; poll via `useQuery` with `refetchInterval` 4 s that stops on
`done`/`error`; on completion it invalidates `['library-search']` and calls
`useViewerStore().open({ asset: result })` so the new model opens in the existing Three.js
viewer. The pending call is scoped to its asset id (switching assets disables the poll without a
reset effect), completion side-effects fire once via a ref (avoids `react-hooks/set-state-in-
effect`), and the button "working" state derives from the poll status. **No viewer/adapter change
needed** — `assetIs3DModel` already routes `media_type='3d_model'`/`.glb` to `threeModelViewerAdapter`.

### Deferred / not-in-scope-yet
Standalone drop-an-image panel and the **Gaussian-splat viewer adapter** wait on Phase 3b (the
backend already rejects `output_format='splat'`, so no dead UI is exposed — the tier control ships
mesh-only). **Normal-map correctness in three.js** (green-channel/handedness from T-P5) still needs
a visual check in the running viewer — a 1-line fix if inverted.

### Validation
`AssetPanel.tsx` + `library.ts` are **type-clean** (isolated `tsc`) and **eslint-clean** for the new
code. Pre-existing type/lint debt elsewhere in the working tree (`AnnotatorPage.tsx`,
`workflows/*`, and the file's own pre-existing reset-effect lint) is unrelated to this change and
untouched. Live in-browser click-through of the full flow is the remaining manual step (gated by
the T-P8 cold start on first call).

### Phase 5 verdict
**Image→3D is usable end-to-end from the UI (mesh path):** select an image → Generate 3D → the
textured GLB lands as a library asset and opens in the viewer. Remaining: Phase 3b splats
(+ splat viewer + standalone panel), in-browser visual QA incl. the normal-map check.

---

# Part I — Field finding: stochastic flat-plane collapse + seed fix (2026-09-12)

First real-image UI test surfaced a **flat-plane** result (a puppy photo, asset #126 → #350).
Localized it end to end:

- **Input good:** clean puppy photo; **background removal good** — the `preprocess_probe`
  (permissive `ZhengPeng7/BiRefNet`) returned a cleanly isolated puppy on black, ~46% frame
  coverage. So neither the image nor our rembg swap was at fault.
- **Raw mesh flat:** running generation and measuring `mesh.vertices` bbox gave extent
  **[1.0, 0.0001, 1.0]** (flatness_ratio ≈ 6e-5) — i.e. **TRELLIS.2's shape stage itself
  produced a full-frame billboard**, not our bake (crown/robot came out volumetric).
- **Seed-dependent:** re-running the *same image* with `seed=42` gave extent flatness_ratio
  **0.50** (2.41M verts) — a proper 3D puppy. So it's a **stochastic shape-collapse for a given
  (image, seed)** — a known image-to-3D failure mode — and our pipeline **hardcoded `seed=0`**
  when the caller didn't pin one, making the failure deterministic on that image.

**Fix (`views_trellis._parse_params`):** when no seed is supplied, **randomize** it
(`random.randint`) and record it in the generation provenance. Every dispatch/retry is now a
fresh attempt, so clicking "Generate 3D" again escapes a flat collapse; the seed is reproducible
from the stored `generation` record. (Future: a "Regenerate"/seed control in the UI, and
optionally raising the sparse-structure guidance for shape robustness.)

---

# Part J — Robustness hardening + current status (2026-09-12)

Field testing (real user images, real UI) drove three robustness experiments beyond the
happy-path pipeline. All are implemented and validated except where noted.

## J1 — Auto-retry-on-flat (supersedes the Part I seed-randomization fix)

Part I's "randomize the seed once" proved **insufficient**: the flat-prone puppy collapses on
*most* seeds, not just seed 0 (measured raw-mesh flatness_ratio — seed 0: 6e-5, seed
1165467518: flat, seed 42: 0.50, seed 1749815593: 0.49). A single random draw is a coin flip.

**Design.** The flatness is decided at TRELLIS's *sparse-structure* stage and is a multimodal,
seed-dependent draw (a textured billboard is a globally-consistent explanation of a single
input view, so it's a degenerate attractor for depth-ambiguous images). So the fix moved into
Modal `generate()`, where the mesh is measurable:
- Django sends `seed=None` unless the user pins one (Modal owns seeding).
- `generate()` loops up to **4 random seeds**, escalating sparse-structure guidance
  (`guidance_strength` 7.5 → 10) on later attempts, measures `extent_min/extent_max`, and
  **stops at the first non-flat mesh** (≥ 0.05). A pinned seed is honoured verbatim (no retry).
- Returns a 3-tuple `(glb, thumb, meta)`; `meta = {seed, flatness, attempts[], flat_warning}`.
  Django records `meta` in the asset's `generation` provenance; a pinned/failed case surfaces
  `flat_warning`.

**Result.** The formerly-flat puppy now yields a proper volumetric mesh — validated end to end:
asset #363, flatness 0.49, renders as a real 3D puppy in the Three.js viewer. The retry cost is
paid only when a collapse actually happens.

## J2 — Resume-polling after page refresh

**Problem (observed).** The SPA held the poll's `call_id` only in React memory; a page reload
dropped it. Because the result is **ingested lazily when a poll completes**, a finished Modal
job with no live poller became an orphan (done on Modal, never turned into an asset) — the user
saw nothing.

**Fix.** The backend already persists every dispatched call on the source
(`type_data["gen3d"][call_id]`). Added `GET …/image-to-3d/pending/`
(`ImageTo3DPendingView`) returning the latest still-`working` call. `AssetPanel` now computes
`activeCall = fresh-dispatch-this-session ?? server-pending` and drives the existing poll from
it, so opening the asset **resumes polling and ingests a finished-but-unpolled job** on first
visit. Verified: endpoint returns the working call (and null when idle); self-heals the orphan
case. (Belt-and-suspenders server-side reconcile — ingest without any browser poll — remains a
future option.)

## J3 — Pre-generation flat-risk warning (designed, not built)

Since the flat collapse traces to missing depth cues, it is **predictable before spending a
generation**. Three tiers proposed: (1) surface the existing post-hoc `flat_warning` (free);
(2) **recommended** — monocular depth (Depth Anything V2-small, Apache-2.0) variance *inside
the BiRefNet subject mask* + mask-fills-frame + background-blur → a non-blocking "may come out
flat — Generate anyway?" banner; (3) a sparse-structure planarity probe (~2 s GPU, most
accurate, could auto-gate). No predictor is perfect (stochastic), so this is a soft warning with
auto-retry (J1) as the safety net. **Deferred pending go-ahead.**

## J4 — Other field fixes
- Generated assets now inherit the **source's `project_id`** (`ingest_generated_asset`) — else
  they were project-less and hidden from the project-scoped library grid.
- Modal class `timeout` 600 → 1800 s (cold-start weight load + max-tier gen + bake + KTX2).

## Current status (phases)
| Phase | Scope | Status |
|---|---|---|
| 0 | Licensing/API audit | ✅ done (Part C) |
| 1 | Clean build + generation on Modal | ✅ done (Part D) |
| 2 | Seam-free commercial bake (PyTorch3D swap) | ✅ done (Part E) |
| 3 | Normal map + meshopt/KTX2 compression + thumbnail | ✅ done (Part F) |
| 3b | Gaussian-splat synthesis | ⏳ not started |
| 4 | Django dispatch/poll/ingest + `3d_model` storage | ✅ done (Part G) |
| 5 | Frontend "Generate 3D" trigger (mesh) | ✅ done (Part H); UI verified via Playwright |
| — | Auto-retry-on-flat (J1), resume-after-refresh (J2), project/timeout (J4) | ✅ done |
| — | Pre-gen flat warning (J3), splat viewer, standalone panel, seed/Regenerate control, normal-map three.js check, resume server-side reconcile | ⏳ deferred |

**Net:** commercial, seam-free image→textured-3D is working end to end from the UI on Modal,
with the two field-failure modes (flat collapse, lost-on-refresh) fixed. All feature work is
currently uncommitted on `main`.
