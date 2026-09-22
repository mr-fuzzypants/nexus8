# Op-Layer Unification — Implementation Plan

**Status:** ready to start · **Date:** 2026-09-13
**Design:** [SRED_OPLAYER_NODEGRAPH_CONVERGENCE.md](SRED_OPLAYER_NODEGRAPH_CONVERGENCE.md) (Parts A/B = architecture, Part E = code audit)

Goal: one annotator shell whose surface follows the **active layer** (not the asset), one
op model (`ops[]`) across image/video/3D, one backend op envelope (`OperationJob`), masks as
portable typed artifacts, and a clean seam to nodegraph. Interactive authoring stays in
nexus8 (D1); headless multi-stage pipelines run on nodegraph (D2).

Finding IDs (BUG-n, FE-n, BE-n) reference [SRED …§E](SRED_OPLAYER_NODEGRAPH_CONVERGENCE.md).
Effort S/M/L; risk in parens.

---

## Decisions to make before Phase 3 / Phase 6

| # | Decision | Recommendation | Gates |
|---|---|---|---|
| C1 | image→3D model: standardize on Trellis 2, keep both? | **Trellis 2** (nexus8 side); re-point nodegraph `ImageTo3DNode` | Phase 6 |
| C2 | integration depth: bridge vs compile-to-graph | **bridge-first** | Phase 6 |
| C3 | stack container: draft `MediaAsset` vs first-class `Stack` entity | **draft `MediaAsset`** (reuses `assetId` spine) | Phase 5 |

C1/C2/C6 do not block Phases 0–4; only surface at the phases noted.

---

## Phase 0 — Fix-now bugs + quick wins  *(no architecture change)*

Independent of the refactor; land first to de-risk and shrink noise.

- [ ] **BUG-1** stamp `VersionLink` before the content-dedup early-return in `ingest.py`
  (`add_version` :428, `ingest_generated_asset` :482) via `get_or_create`. (S, low)
- [ ] **BUG-3** gate the stale-data mock (`video_ops.py:1050-1067`, `:374-380`) behind
  `settings.DEBUG`/flag; never fabricate `done` in prod. (S, low)
- [ ] **BE-7** extract `services/media_paths.py` (`local_path_for`, `bytes_for`); replace the
  "mirrors" copies (`video_ops.py:139-151`, `views_inpaint.py:39`, `views_blob.py:40`). (S)
- [ ] **FE-7** extract `apiErrorMessage(error)`; dedupe inline parses (`AnnotatorPage.tsx:1447,
  1554,1733`). (S)
- [ ] **FE-6a** dedupe `LAYER_OP_LABELS` (`MaskLayersPanel.tsx:15` + `MaskLayerDetailPanel.tsx:139`). (S)
- [ ] **FE-10** depend the viewer/room effect on `asset.id`/`file_path` primitives, not the
  object (`AnnotatorPage.tsx:544-587`). (S)
- [ ] **FE-11** add `assetIsImage()` to `library.ts`; replace raw `media_type==='image'`. (S)

**Acceptance:** provenance edges present on dedup; no prod mock success; green build; no behavior change beyond bug fixes.

---

## Phase 1 — Type + registry foundations  *(load-bearing abstractions)*

The two registries + the discriminated-union `LayerOp` are what Parts A/B reduce to.

**Frontend**
- [ ] **FE-6b/FE-5** merge `MaskOp`+`LayerOpType` → one `OpType`; make `LayerOp` a
  **discriminated union on `type`** with per-op `params` (`types.ts:134-163`). (M, low)
- [ ] **FE-3** extract `opRegistry: Record<OpType, { label, defaults, ParamsComponent,
  dispatch, runnableWhen, validAfter }>`; panels/dispatch read from it. (M, med)
- [ ] **FE-1a** define `SurfaceKind` + `surfaceRegistry: Record<SurfaceKind,
  { createAdapter(ctx), capabilities }>`; move the `createAssetAdapter` media ladder into it
  (impl unchanged, just keyed). (M, med)

**Backend**
- [ ] **BE-3** add `inputs:[Port]`/`output:Port` (`media_type ∈ image|video|mask|mesh|splat`)
  to the `Op` base; extend `describe()` (`video_ops.py:178-185`). (M, low)
- [ ] **BE-6** `services/modal_dispatch.py` — `spawn()`/`poll()` + explicit per-op mock
  policy (default none). (M, med)

**Acceptance:** op params type-checked per op; adding an op = one registry entry (FE) / one
`Op` subclass (BE); no runtime behavior change.

---

## Phase 2 — Collapse envelopes + decompose the shell

**Backend (mostly deletion)**
- [ ] **BE-2** de-bias `OperationJob` (`related_name`→`op_jobs`, docstring, `layer_id` optional
  scoping). (S-M, low)
- [ ] **BE-1** register `inpaint/erase/sketch_inpaint/scribble/image_to_3d` as `Op`s on the
  `OperationJob` envelope; route triggers through `VideoOpDispatchView`/`VideoOpJobView`;
  delete per-op view files, **keep URL aliases** (`urls.py`). This resolves **BUG-2** (atomic
  claim) and dispatch-failure inconsistency for free. (L, med)
- [ ] **BE-5** route `image_to_3d` through shared ingest so the mesh is a first-class derived
  render (relation + `selected` symlink + two-axis version), off `type_data["gen3d"]`. (M, med)
- [ ] **BE-10** one `/api/library/ops/` endpoint from `describe_registry()` (all ops + ports). (S)

**Frontend**
- [ ] **FE-4** decompose `AnnotatorPage.tsx`: `useViewerEngine`, `useVideoMaskTracks`,
  `useLiveGeneration` (collapse the 4 runners `:1833-2269`), `useMaskSidebar`. (L, med)
- [ ] **FE-9** split the rehydration effect (`:595-740`) into `restoreLayersFromTracks`/
  `hydrateResultTracks`/`rebuildOpLineage` taking the registries. (M, med)

**Acceptance:** all ops flow through `OperationJob`; per-op view files gone (aliases pass);
one op registry endpoint; `AnnotatorPage` < ~1000 lines; existing image+video flows unchanged.

---

## Phase 3 — Fold `mask_op → ops[]` + consolidated shell (Slices 1–2)

- [ ] **FE-2** fold still-image `mask_op` + flat generative fields into `ops[]` per-op
  `params`; rehydration shim for legacy docs (mirror `:698-734`). Retire the 3× `Pick`
  triplicate (**FE-8**). (L, med-high)
- [ ] **A.10.2 base-layer synth** — `getOrCreateAnnotationDoc`: no layers ⇒ synthesize a base
  layer bound to the asset's `selected` version.
- [ ] **FE-1b** re-key the mounted surface on `(activeLayer, mode)` + implement
  `resolveInput(layer)` (A.10.1); selecting a layer swaps the surface within same-media stacks.

**Acceptance (Slice 1+2 in SRED §A.10.5):** image and video render one stack panel in one
shell; surface follows the selected layer; still-image `mask_op` path deleted.

---

## Phase 4 — Masks as portable typed artifacts (FileSet)

- [ ] **BE-4 / FILESET_MODEL.md Phase A** — `MaskTrack.add_propagation_result` writes
  `FileSet(kind='mask')` + `VersionFileSet`; consumers read via `path_for`/`resolve_frame`;
  delete Python correction-merge (`video_ops.py:399-413`). Data migration (~small per doc). (L, med)
- [ ] **BE-8** indexed `layer_id` column on `EntityRelation`; unify `find_layer_relation`
  (scan) and `MaskTrack.for_video_and_layer` (JSONB) onto it. (M, low)

**Acceptance:** a `mask` Port resolves to a FileSet for both image and video ops; no JSONB
mask blobs on new writes.

---

## Phase 5 — Cross-media authoring + new-asset workflow (Slice 3)

Resolve **C3** first (recommend draft `MediaAsset`).

- [ ] **A.8** give the 3D surface a layer concept; register it in `surfaceRegistry`.
- [ ] **A.4** author/review mode toggle (input-surface vs output-surface) for cross-media ops.
- [ ] Model `image→3D` as a `trellis_3d` **layer** in the stack (not a detached asset);
  `resolveInput` review-mode shows the mesh.
- [ ] **A.10.3 (W2)** "New" action → create draft host + empty stack → route
  `annotate/:hostId`; first **source op** (`image_gen`/import) materializes the root asset and
  resolves `media_type`; `getOrCreateAnnotationDoc` accepts a host with no source version.
- [ ] **A.10.4 publish** — Output binding + pin → same-media `approved` version or cross-media
  derived `MediaAsset`; deterministic naming (iterate/derive/custom).

**Acceptance:** `image_gen → sam2 → trellis_3d` authored and published in one shell (W1 on an
existing asset; W2 from scratch).

---

## Phase 6 — nodegraph convergence

Resolve **C1/C2**.

- [ ] **B.5** build the backend **intent API** (resolve→confirm, pin inputs, declared output
  bindings) — the missing piece behind the `web/src/features/workflows/` mockup.
- [ ] **B.2** `Nexus8Mask` node + extend `Nexus8ImageAsset` for video/mesh; map nexus8 artifacts
  → `ValueType` ports.
- [ ] **B.3** `Nexus8Output`/`Nexus8Pin` write `Version`+`VersionLink` — same write as
  interactive publish (Phase 5), so artist and graph paths converge on one deliverable shape.
- [ ] **B.4/C1** re-point nodegraph `ImageTo3DNode` at `nexus8-trellis2` (or keep both).
- [ ] **BE-9** run `Op.ingest` on the task queue (Huey/`django.tasks`) once it lands; move the
  request-thread composite/h264 (`video_ops.py:680-913`) off the web worker.

**Acceptance:** a headless nodegraph run produces the same versioned, take-pinnable, provenance-
stamped artifacts as interactive ops; no second graph canvas built in nexus8.

---

## Dependency summary

```
Phase 0 ─┐
         ├─▶ Phase 1 ─▶ Phase 2 ─▶ Phase 3 ─▶ Phase 5 ─▶ Phase 6
Phase 4 ─┘ (needs BE-3 from P1; feeds P5 mask binding & P6 B.2)
```

- Phase 0 anytime. Phase 1 before everything structural.
- Phase 2 (BE-1 collapse) subsumes BUG-2 and BE-8-adjacent consistency.
- Phase 3 needs FE-1/FE-3/FE-5 (P1) + FE-4 (P2).
- Phase 4 can run parallel to Phase 3 after BE-3; its FileSet mask is required for Phase 6 B.2.
- Phases 5–6 need C3 then C1/C2.

## Smallest valuable milestone

**Phase 0 + Phase 1 + Phase 3 Slice 1** = "asset → layers in a consolidated UI" for image+video
with almost no new surface work (shell, resolver, layer store already exist). Everything after
extends the same spine to cross-media and to nodegraph.
