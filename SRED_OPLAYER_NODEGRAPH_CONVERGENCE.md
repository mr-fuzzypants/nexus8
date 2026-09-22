# Op-Layer Unification & nodegraph Convergence

**Status:** design-stage · **Date:** 2026-09-12
**Related:** [SRED_OPGRAPH_EXPERIMENTS.md](SRED_OPGRAPH_EXPERIMENTS.md), [SRED_VIDEOOP_EXPERIMENTS.md](SRED_VIDEOOP_EXPERIMENTS.md), [FILESET_MODEL.md](FILESET_MODEL.md), [TRELLIS2_IMAGETO3D_PLAN.md](TRELLIS2_IMAGETO3D_PLAN.md)

---

## 0. Problem

nexus8 has three per-media annotation surfaces (2D image, video, 3D model) and two
divergent op-layer representations:

- **still image** — a single implicit `AnnotationLayer.mask_op` ([web/src/features/annotator/core/annotations/types.ts:182](web/src/features/annotator/core/annotations/types.ts#L182))
- **video** — a typed serial stack `AnnotationLayer.ops: LayerOp[]` ([types.ts:213](web/src/features/annotator/core/annotations/types.ts#L213)), with `LayerOpType = 'automask' | 'manual_mask' | 'remove'` ([types.ts:138](web/src/features/annotator/core/annotations/types.ts#L138)) and cross-layer chaining via `source: {layerId}`
- **3D model** — no op/layer concept; output-only (image→3D generation)

We want to (a) **combine op-layers across media** — e.g. `image_gen → sam2_mask → trellis_3d` — and
(b) do it without maintaining a second execution engine, given that
`/development/nodegraph` already implements a typed cross-media graph engine.

Two decisions frame everything below and are treated as settled:

- **D1 — Interactive authoring stays in nexus8.** SAM2 click/correct, mask paint, timeline
  scrub, take pinning are tight sub-second loops and stay native to their media surface.
- **D2 — Headless multi-stage pipelines run on nodegraph.** The DAG of transform ops,
  Modal dispatch, durable/re-eval execution lives in the graph engine, not in bespoke
  nexus8 op code.

This doc has two parts: **A. the nexus8-side unified op-layer architecture** (frontend +
data model), and **B. convergence with nodegraph** (the seam, artifact typing, provenance,
de-duplication).

---

## Part A — nexus8 unified op-layer

### A.1 The core shift

> **The editing surface is selected by the *selected layer/op's* media type, not by the
> *asset's* media type.**

Today the surface is bound to the asset: open a video → video view. Because a unified stack
can span media, the surface must follow whichever layer is being edited. We are already
halfway there — [createAssetAdapter.ts](web/src/features/viewer/createAssetAdapter.ts)
already switches viewer adapters (`tiledImageAdapter`, `videoAdapter`,
`threeModelViewerAdapter`; no splat adapter yet) by media type. That is a surface registry;
it is just keyed on the asset (`assetMediaKind`) instead of on the active layer.

### A.2 Shell shape

```
┌─ Annotator shell (single) ─────────────────────────────┐
│ ┌ Layer/op stack ┐ ┌──── Active surface ────┐ ┌params─┐ │
│ │ ▸ image_gen    │ │  chosen by selected     │ │ from  │ │
│ │ ▸ sam2_mask  ◀─┼─┤  layer's media type +    │ │  op   │ │
│ │ ▸ trellis_3d   │ │  mode (author/review)    │ │  reg  │ │
│ └ unified ops[]  ┘ │  Konva2D / timeline /   │ │       │ │
│                    │  Three.js + op tools    │ │       │ │
│                    └─────────────────────────┘ └───────┘ │
└─────────────────────────────────────────────────────────┘
```

One shell, one op model, two registries. **"Unified" means consolidated shell + swapped
surfaces — not one mega-view.** The three surface implementations stay separate (you cannot
put a Konva brush on a mesh); the registry is a mounting contract, not a place to
genericize editing logic.

### A.3 Two registries

**Surface registry** — `mediaType → SurfacePlugin`:

```ts
interface SurfacePlugin {
  mediaType: MediaType          // 'image' | 'video' | '3d_model' | 'gaussian_splat'
  Viewer: ViewerAdapter          // render the media (exists today)
  AnnotationOverlay: Component    // draw a layer's annotations/masks in this media's space
                                  //   Konva 2D · frame overlay · world-space
  ToolPalette: Component          // authoring gestures valid on this surface
  artifactIO: {                   // read/write authoring artifacts in native form
    read(layer): AuthoringArtifact
    write(layer, artifact): void
  }
}
```

**Op registry** — `opType → OpPlugin`:

```ts
interface OpPlugin {
  opType: string                 // 'image_gen' | 'automask' | 'manual_mask' | 'remove' | 'trellis_3d' | ...
  inputPortType: MediaType[]     // what it consumes
  outputPortType: MediaType      // what it produces
  authoringSurface: MediaType | 'none'   // which surface authors it (usually = input media)
  tools: string[]                // which ToolPalette entries light up
  paramsSchema: JSONSchema
  ParamsComponent: Component      // replaces today's video-specific MaskLayerDetailPanel
  dispatch(job): Promise<...>     // → nodegraph / Modal (Part B)
}
```

The shell does exactly one thing: **for the selected layer, mount the surface its op
declares, activate that op's tools, render that op's params.** Selecting `sam2_mask` mounts
the image/video surface with point tools; selecting `trellis_3d` mounts the 3D surface with
orbit + params only.

### A.4 Authoring surface vs review surface

An op has two media types and you look at different ones at different moments:

| Op | Author on (input) | Review on (output) |
|---|---|---|
| `sam2_mask` (image→mask) | image surface + point/scribble tools | image surface (mask overlay) |
| `remove` (video→video) | video surface (pick mask take) | video surface (result track) |
| `trellis_3d` (image→mesh) | image surface (reference) / none | **3D surface** (mesh, orbit) |

So surface selection = `(selectedLayer, mode)` where `mode ∈ {author, review}`. For
same-media ops input and output surface are identical → collapses to today's behavior. For
cross-media ops the shell offers an author/review toggle. **That toggle is the
"switched-out-by-op-type" behavior**, made precise.

### A.5 Layer schema

Add explicit port typing to each layer (derived from the op registry, cached on the layer
for offline rendering):

```ts
interface LayerOp {              // extend existing type
  id: string
  type: LayerOpType              // widen the union as ops are added
  inputMediaType?: MediaType     // NEW — from op registry
  outputMediaType?: MediaType    // NEW
  inputBinding?: PortRef         // NEW — upstream layer output OR source asset version
  params?: {...}
  authoringArtifacts?: {...}     // points / scribble / painted mask handles
}
```

`inputBinding` generalizes video's `source: {layerId}` chaining to any upstream port,
including cross-media. Same-media single-node cases (still image today) are just a stack of
length 1.

### A.6 `mask_op → ops[]` migration (biggest single consolidation)

`AnnotationLayer` already carries **both** `mask_op?` ([types.ts:182](web/src/features/annotator/core/annotations/types.ts#L182))
and `ops?: LayerOp[]` ([types.ts:213](web/src/features/annotator/core/annotations/types.ts#L213)).
Fold still-image `mask_op` onto `ops[]`:

1. Map each `MaskOp` variant to an `OpPlugin` (`inpaint`, `scribble`, `erase`, single-frame
   `segment`).
2. Write a read-time shim: if `mask_op` present and `ops` empty, synthesize a one-element
   `ops[]`. (Mirror the video lineage rebuild already in [AnnotatorPage.tsx](web/src/features/annotator/AnnotatorPage.tsx).)
3. New writes go to `ops[]`; deprecate `mask_op` once persisted layers are migrated.

After this, **one stack component serves image and video**, and the still-image and video
annotators are the same shell with different registered surfaces.

### A.7 The container question

A cross-media stack cannot hang off a single-media `MediaAsset` — its layers produce
different media. Resolution: the annotator opens a **pipeline/stack** (the forward recipe),
each layer's `inputBinding` references an upstream layer output or a source `Version`, and
cross-media outputs (the mesh) materialize as their own `MediaAsset` + `Version` (exactly as
`ingest_generated_asset` already does for image→3D, stamping `VersionLink(init_image)`).
The nexus8 op-stack **is the interactive, authoring-side projection of the same recipe graph
handed to nodegraph** (Part B).

### A.8 3D stops being special

Give the 3D surface a layer concept so it registers like any other `SurfacePlugin`: it hosts
annotation layers today and 3D-mask ops later. No more output-only special case.

### A.9 Built vs new (nexus8 side)

| Piece | State |
|---|---|
| Surface/viewer registry | **exists** ([createAssetAdapter.ts](web/src/features/viewer/createAssetAdapter.ts)) — re-key on active layer |
| Shared annotator shell (image+video) | **exists** ([AnnotatorPage.tsx](web/src/features/annotator/AnnotatorPage.tsx)) |
| Typed op model + take pinning | **exists** for video ([types.ts:138](web/src/features/annotator/core/annotations/types.ts#L138), [MaskLayersPanel.tsx](web/src/features/annotator/components/MaskLayersPanel.tsx)) |
| `mask_op → ops[]` fold | **new** (A.6) |
| Op-registry-driven params/tools | **new** — generalize [MaskLayerDetailPanel.tsx](web/src/features/annotator/components/MaskLayerDetailPanel.tsx) |
| Input/output media types on layers | **new** (A.5) |
| author/review surface toggle | **new** (A.4) |
| 3D layer concept | **new** (A.8) |
| pipeline/stack container | **new** (A.7) |

---

### A.10 Asset → stack entry flow, and the two authoring workflows

The spine already exists: one route lands every media type in the shared shell, and the
annotation doc is a lazily-created stack. The consolidation is re-keying the surface on the
active layer (A.1) and giving the stack a life independent of a single source asset (so a
*new* asset can be born from the stack's first op).

**Current wiring (verified):**

```
AssetPanel ─navigate(`~/p/{code}/annotate/{asset.id}`)─▶ AnnotatorPage({params:{code,assetId}})
  [AssetPanel.tsx:300]                                     [AnnotatorPage.tsx:148]
        getAsset(assetId)                    ◀ asset summary (media_type)   [:158]
        getOrCreateAnnotationDoc(assetId,ver) ◀ the doc == the stack        [:163]
        rehydrate layers from persisted tracks                              [:589]
        snapshot.layers → maskLayers (layers minus DEFAULT)                 [:783]
        createAssetViewerAdapter(asset)      ◀ surface keyed on ASSET  ← re-key on active layer
        [createAssetAdapter.ts:30, assetMediaKind() :9]
```

`getOrCreateAnnotationDoc` **is** the stack resolver; the layer store already carries an
op-stack (+ legacy fallback at [AnnotatorPage.tsx:341](web/src/features/annotator/AnnotatorPage.tsx#L341)).

#### A.10.1 `resolveInput(layer)` — what the active surface displays

```
base layer            → host asset's `selected` Version
chained layer         → upstream layer's pinned output take (Version → media URL)
source/generative op  → none (e.g. image_gen from prompt); surface shows the layer's
                        own output take once produced
review mode           → the layer's own output Version (e.g. trellis_3d mesh)
```

Generalizes the pinned-render resolution already used for the canvas composite
([:470](web/src/features/annotator/AnnotatorPage.tsx#L470), [:993](web/src/features/annotator/AnnotatorPage.tsx#L993)).

#### A.10.2 Workflow W1 — existing asset → modify → publish

The common case; hangs off an existing asset. Same-media outputs become new versions of it,
cross-media outputs become derived assets (exactly today's image→3D behavior, generalized).

1. **Open** — library → asset → route `annotate/:assetId`. `getOrCreateAnnotationDoc` seeds
   the stack with a **base layer bound to the asset's `selected` Version** (back-compat rule:
   no layers ⇒ synthesize this base layer).
2. **Modify** — add op layers on top (`automask`/`manual_mask`, `remove`, `matte`,
   `trellis_3d`, …). Each `dispatch` produces a `Version`/take; selecting a layer swaps the
   surface via A.1 + `resolveInput`.
3. **Iterate** — compare takes (two-axis versions), pin the `selected` take per layer.
4. **Publish** — pick a terminal layer's pinned take → deliverable (A.10.4).

#### A.10.3 Workflow W2 — new asset from scratch → generate → build → publish

Here **the stack exists before any asset** — the asset is *born from the first op's output*,
not the container. This is the forcing function for the container decision (A.7 / C3).

1. **New** — a "New" action creates a **draft host** (draft `MediaAsset`, or a first-class
   `Stack` entity) + an empty stack, then routes to `annotate/:hostId`. No source version yet.
2. **Generate the root** — the first layer is a **source op**: `image_gen` (from prompt),
   `import`/upload, or `text→video`. `inputBinding = none` (or a prompt). Its first `Version`
   **materializes the asset's media**; the host's `media_type` resolves from the op's
   `outputPortType`.
3. **Build** — from here identical to W1 steps 2–3 (add layers, iterate, pin).
4. **Publish** — same terminal step (A.10.4).

> **Container implication (C3):** W2 needs the stack to outlive "no asset yet." Two viable
> hosts: (a) **draft `MediaAsset`** — reuses the entire `assetId` route/doc spine, media_type
> filled in by the root op; (b) **first-class `Stack` entity** — cleaner for multi-terminal
> pipelines but a bigger refactor. Recommend **(a)** first; it makes W2 fall out of the
> existing wiring with only a "create draft + open" action added.

#### A.10.4 Publish (shared terminal for W1 and W2)

Publish = declare an **Output binding** on a terminal layer, pin its take, and promote it to
a deliverable:

- **Same-media** → new `Version` + `approved` symlink on the host asset.
- **Cross-media** → **derived `MediaAsset`** with `VersionLink` to the source (as
  `ingest_generated_asset` already does for image→3D).
- **Naming is deterministic** — iterate / derive / custom modes; never derived from workflow
  names (per the July 2026 intent design, B.5).
- **Convergence:** when the same recipe runs headless on nodegraph, the `Nexus8Output` /
  `Nexus8Pin` nodes perform *this exact write* (B.3). Interactive publish and graph publish
  therefore land the same deliverable shape — the artist path and the automated path are
  interchangeable at the output boundary.

#### A.10.5 Entry-specific build order

Maps onto the P1–P4 phasing in §D:

- **Slice 1 (P1)** — W1 for image+video on unified `ops[]`: base-layer synth (A.10.2 step 1)
  + `mask_op → ops[]` fold (A.6). One stack panel, one shell, no new surfaces.
- **Slice 2 (P1→P4)** — re-key the surface on the active layer (A.1) + `resolveInput`
  (A.10.1): per-layer surface swap within same-media stacks.
- **Slice 3 (P2+P4)** — W2 (draft host + source ops) and cross-media publish: model
  `image→3D` as a `trellis_3d` layer, register the 3D surface → full
  `image_gen → sam2 → trellis_3d` authored and published in one consolidated UI.

Slice 1 alone delivers "asset → layers in a consolidated UI" for image+video with almost no
new surface work, because the shell, the stack resolver, and the layer store already exist.

---

## Part B — nodegraph convergence

`/development/nodegraph` is a Python/FastAPI graph engine + ReactFlow editor, actively
developed. It already provides what we would otherwise build: typed `ValueType` ports
(`IMAGE, LATENT, MASK, MESH, VIDEO, AUDIO`), a dirty-flag + DBOS durable async DAG executor,
imaging nodes (`ImageTo3DNode` for Trellis/Hunyuan3D, `SegmentForegroundNode`,
`RefineMatteNode`, KSampler/video nodes), and a `Nexus8*` integration node family
(`Self`, `ImageAsset`, `EntityRef`, `AssetQuery`, `Output`, `Pin`). The
`image → sam2 → 3d` pipeline ships as POC demos (`pocdemos/ImageTo3D.json`,
`BackgroundRemoval.json`).

### B.1 The seam: authoring vs transform

| | nexus8 op-layers | nodegraph |
|---|---|---|
| Owns | interactive single-media authoring (SAM2 correct, mask paint, scrub, take pin), `Version`/`VersionLink` provenance, two-axis versioning | headless multi-stage cross-media pipelines, Modal dispatch, durable/re-eval execution |
| Latency | sub-second interactive | batch |
| Graph | backward provenance DAG (`VersionLink`) | forward recipe DAG (executor) |

nexus8 authoring ops **emit typed artifacts into** the graph; they are not graph nodes.

### B.2 Artifact type-map

| nexus8 artifact | nodegraph `ValueType` | binding node |
|---|---|---|
| image `MediaAsset` version | `IMAGE` | `Nexus8ImageAsset` |
| video `MediaAsset` version | `VIDEO` | `Nexus8ImageAsset` (extend) |
| mask (FileSet `Version`, per [FILESET_MODEL.md](FILESET_MODEL.md)) | `MASK` | new `Nexus8Mask` |
| 3D `MediaAsset` version (GLB) | `MESH` | `Nexus8ImageAsset` (extend) |
| entity ref / reference slot | (opaque) | `Nexus8EntityRef` / `Nexus8AssetQuery` |

The **FileSet mask migration is the enabler**: it turns a mask from an implicit layer field
into a portable `mask@{image|video}` `Version` a downstream node can bind to.

### B.3 Provenance loop (close it)

A nodegraph run's `Nexus8Output` / `Nexus8Pin` nodes write nexus8 `Version` +
`VersionLink`. Result: a graph run yields the **same** versioned, take-pinnable artifacts as
an interactive op, and the backward provenance DAG auto-derives from the forward recipe.

### B.4 Overlap is narrower than it looked — mostly complementary

Verified against `/development/nodegraph` (2026-09-13). Only **image→3D** genuinely
overlaps, and even that is a model-version choice, not pure duplication. Segmentation and
removal occupy different niches:

| Capability | nexus8 | nodegraph | Relationship |
|---|---|---|---|
| image→3D | `nexus8-trellis2` — Trellis **2**, Modal ([views_trellis.py:36](nexus8/trackables/views_trellis.py#L36)) | `ImageTo3DNode` — Trellis **1** | **overlap — pick a model** |
| segmentation | `nexus8-videoseg` — SAM2 **interactive temporal video** propagation, prompt-driven, Modal ([video_ops.py:30](nexus8/trackables/services/video_ops.py#L30)) | BiRefNet(MIT)/ViTMatte(Apache)/rembg **automatic single-image matting**, in-process, no Modal | **complementary, not a dup** |
| removal | video inpaint VOID/VACE/eraser, Modal ([video_ops.py:31-33](nexus8/trackables/services/video_ops.py#L31)) | cutout/composite only (no video inpaint) | **distinct** |

So the de-dup work collapses to a single decision, and the rest is composition:

- **image→3D** is the only real merge. Recommend standardize on **Trellis 2** (nexus8's
  newer, commercial-friendly, seam-free bake path per [TRELLIS2_IMAGETO3D_PLAN.md](TRELLIS2_IMAGETO3D_PLAN.md))
  and have nodegraph's `ImageTo3DNode` call the `nexus8-trellis2` app — unless nodegraph has
  a reason to stay on Trellis 1. (This *inverts* the "nexus8 delegates to nodegraph"
  direction for 3D specifically: the better model currently lives on the nexus8 side.)

- **segmentation is not a duplicate — it composes.** nexus8 SAM2 = interactive,
  prompt-driven, temporal video authoring (stays native per D1). nodegraph matting =
  automatic, single-image, headless. nodegraph's `IsolateSubject`/`SegmentForeground` is a
  natural **auto-prep** step (clean background) feeding `trellis_3d`; nexus8 SAM2 is the
  interactive authoring op. Register **both** as distinct op types with distinct
  `authoringSurface` — SAM2 = interactive image/video surface; matting = `'none'` (headless).
  The unified op-registry (A.3) already accommodates this with no consolidation.

- **removal** is nexus8-only (video inpaint). No dup.

Net: there is no broad "consolidate the Modal functions" program — just the one Trellis
model decision. The remaining capabilities slot into the op-registry as distinct,
composable ops.

### B.5 The missing backend: intent API

The nexus8↔nodegraph contract was designed (July 2026 — Run Intents, resolve→confirm,
control-surface views, drag-and-drop run form) and the **frontend mockup exists** in
[web/src/features/workflows/](web/src/features/workflows/) (gated by `WORKFLOW_MOCK_ENABLED`),
but the **backend intent API was never built**. That API is the prerequisite for B.3/B.4:
nexus8 resolves+pins inputs, declares output bindings, dispatches the graph, and the engine
fulfills the intent. The two frontends are **complementary**: nodegraph's ReactFlow editor
authors graphs; the nexus8 `workflows/` layer is the run-intent / asset-binding / control
surface on top. Do not build a second graph canvas in nexus8.

---

## C. Open decisions

1. **Trellis model** (B.4) — standardize image→3D on Trellis 2 (nexus8) and re-point
   nodegraph's `ImageTo3DNode`, or keep both. Only genuine overlap; segmentation/removal
   are complementary, not consolidation targets.
2. **Integration depth** — bridge-first (nexus8 ops delegate to nodegraph for headless
   stages; interactive stays native) vs deep (nexus8 op-stacks compile to nodegraph graphs).
   Recommend **bridge-first**, evolving toward compile-to-graph only if it pays off.
3. **Stack container entity** (A.7) — reuse `MediaAsset` + `type_data` recipe, or a new
   first-class pipeline entity.
4. **When to retire `mask_op`** (A.6) — after a data migration pass over persisted layers.

## D. Suggested phasing

- **P1 — nexus8 op-layer unification (Part A):** fold `mask_op → ops[]`; re-key surface
  registry on active layer; op-registry-driven params/tools. No engine change; unlocks a
  single shell across image+video.
- **P2 — artifact typing + intent API (B.2, B.5):** FileSet masks as `MASK`; build the
  backend intent API; wire `Nexus8*` nodes → `Version`/`VersionLink` (B.3).
- **P3 — de-dup compute (B.4):** consolidate Modal functions; nexus8 headless ops (trellis,
  remove) delegate to nodegraph nodes. Retire duplicate wrappers.
- **P4 — cross-media authoring (A.4, A.7, A.8):** author/review surface toggle,
  pipeline/stack container, 3D layer concept → full `image_gen → sam2 → trellis_3d`
  authored in one nexus8 shell, executed on nodegraph.

> Sequenced, task-level implementation → **[OPLAYER_UNIFICATION_PLAN.md](OPLAYER_UNIFICATION_PLAN.md)**.

---

## E. Current-state code audit (findings)

Two audits of the live code (2026-09-13), oriented at the unification. Effort S/M/L, risk in
parens. The load-bearing conclusion: **the target already exists in ~70% form** — backend
`OperationJob` is the one mature envelope to collapse onto; frontend needs two registries +
a discriminated-union `LayerOp` + decomposition of a 2568-line component. Two bugs are
independent of the refactor and should be fixed now.

### E.1 Fix-now correctness bugs (independent of the refactor)

- **BUG-1 — provenance dropped on content-dedup** (S, low). `ingest.py:428-429` and
  `ingest.py:482-486` early-return the existing version when bytes match, **skipping the
  `VersionLink` upstream stamp** (only `publish()` writes edges, `entities.py:291-294`). With
  pinned seeds this is common → derived asset shows only the *first* run's lineage, breaking
  any provenance-derived graph. Fix: `get_or_create` the upstream links before the dedup
  return in both helpers.
- **BUG-2 — non-atomic ingest → double-render** (M, med). `views_trellis.py:159-211` and the
  four still-image status views guard only with a non-atomic `if status=="done"`, unlike
  `video_ops.poll_job`'s atomic claim (`video_ops.py:1101-1143`). Two polls after Modal
  completes can both ingest; `store_run_results` then allocates **two runs** for one result.
  Fixed for free by E.4 (collapse onto `OperationJob`); until then add the claim pattern.
- **BUG-3 — mock fabricates success from stale data** (S, low). `video_ops.py:1050-1067` +
  `SegmentOp` fallback (`:374-380`) return the latest *existing* version as a `done` result
  with fake latency when Modal is unavailable — a stale mask silently "succeeds" outside dev.
  Gate behind `settings.DEBUG`/explicit flag; never fabricate `done` in prod.

### E.2 Frontend — structural blockers (map to Part A)

- **FE-1 — surface keyed on `asset.media_type`, not layer+mode** (L, med) — the core A.1
  blocker. `createAssetAdapter.ts:9-13,30-74`; `isVideo/is3DModel` booleans threaded through
  ~30 sites from `AnnotatorPage.tsx:541-542`. → `SurfaceKind` from
  `(activeLayer.mediaKind ?? assetMediaKind, mode)` + a **surface-plugin registry**; add
  active-layer id to the adapter effect deps.
- **FE-2 — `mask_op` vs `ops[]` duality** (L, med-high) — the A.6 fold. Disjoint vocabularies
  (`MaskOp` 7 values `types.ts:134` vs `LayerOpType` 3 values `:138`); ~15 flat layer-level
  generative fields (`:184-211`) vs per-op `params`. Two separate param UIs in
  `MaskLayerDetailPanel.tsx` (`:96-131,260-595` flat vs `:135-258` ops). Needs a
  rehydration shim (video already has one, `AnnotatorPage.tsx:698-734`).
- **FE-3 — no op-plugin registry** (M, med). Op knowledge scattered across ≥6 sites
  (`LAYER_OP_DEFAULTS` `AnnotatorPage.tsx:66-70`; `LAYER_OP_LABELS` duplicated
  `MaskLayersPanel.tsx:15-19` + `MaskLayerDetailPanel.tsx:139-141`; dispatch switch `:1781-95`;
  `RUNNABLE_OPS`/`OP_TO_MASK_OP`; append rules `MaskLayersPanel.tsx:239-254`). → one
  `opRegistry` keyed by unified `OpType`.
- **FE-4 — `AnnotatorPage.tsx` is a 2568-line god component** (L, med). ~40 hooks; four
  near-identical still-image runners (`:1833-2269`, ~440 dup lines). Extract
  `useViewerEngine`, `useVideoMaskTracks`, `useLiveGeneration` (collapse the four runners),
  `useMaskSidebar`. Prerequisite for consuming the registries.

### E.3 Frontend — type/coupling (map to A.3/A.5)

- **FE-5** (M, low) — `LayerOp.params` is one flat bag (`types.ts:147-163`); make `LayerOp` a
  **discriminated union on `type`** with per-op params. Load-bearing type foundation.
- **FE-6** (S) — `LayerOpType` too narrow; merge `MaskOp`+`LayerOpType` → one `OpType`.
- **FE-7** (S) — `videoOps.ts` dispatch/status are `Record<string,unknown>`; type per op; extract
  `apiErrorMessage()` (inline-parsed 6+ times).
- **FE-8** (S) — the 13-field generative `Pick` is restated 3× (`AnnotatorPage.tsx:937`,
  `MaskLayerDetailPanel.tsx:47-49`, `RenderHistoryPanel.tsx:6-23`); collapses into `params`.
- **FE-9** (M, med) — mount rehydration effect is video-only + monolithic (`:595-740`); split
  into `restoreLayersFromTracks`/`hydrateResultTracks`/`rebuildOpLineage` so a still-image
  surface can supply its own "durable outputs → ops" mapping.
- **FE-10** (S) — effect tears down the collab room on `asset` object identity churn
  (`:544-587,206-208`); depend on `asset.id`/`file_path` primitives.
- **FE-11** (S) — `AssetPanel.tsx` mixes raw `media_type==='image'` (`:156,287,311,413`) with
  helpers; add `assetIsImage()` to `library.ts`.

### E.4 Backend — structural blockers (map to Part A/B)

- **BE-1 — three dispatch→poll→ingest envelopes** (L, med) — the core. `OperationJob`
  (`video_ops.py`) is mature (durable job, registry, **atomic ingest-claim**, stale takeover);
  `views_trellis.py:72-225` uses `type_data["gen3d"]`; the four still-image views use
  op-prefixed keys on the mask `EntityRelation` (copy-pasted trigger+status). → collapse onto
  `OperationJob`; rename module `services/ops.py`, `VideoOp`→`Op`; register `inpaint`, `erase`,
  `sketch_inpaint`, `scribble`, `image_to_3d`; delete per-op views (keep URL aliases as
  `views_video_masks` already does). **Mostly deletion, not new code.**
- **BE-2** (S-M) — `OperationJob` is video-biased in naming only (`related_name="video_op_jobs"`,
  docstring, `layer_id` as first-class); structurally general. De-bias; treat `layer_id` as one
  optional scoping key. `models/operations.py:1-85`.
- **BE-3 — no typed ports** (M, low) — media type is implicit in Modal args + `op` strings +
  hardcoded `media_type=/file_ext=` at each ingest. Add `inputs:[Port]`/`output:Port`
  (`media_type ∈ {image,video,mask,mesh,splat}`) to the `Op` base; extend `describe()`
  (`video_ops.py:178-185`). Drives ingest, op menus, and the nodegraph node schema (B.2).
- **BE-4 — two mask representations** (L, med) — video masks are JSONB `mask_png_b64`
  (`mask_tracks.py:147-164`), image masks are already file-backed. Execute **FILESET_MODEL.md
  Phase A**; masks read via `path_for`/`resolve_frame`, not `Version.data` decode; delete the
  Python correction-merge (`video_ops.py:399-413`). Enabler for a `mask` Port (B.2).
- **BE-5 — 3D output is not a first-class derived render** (M, med) — `image_to_3d` ingests
  with a lone `init_image` edge, no layer-render relation / `selected` symlink / two-axis
  versioning (`views_trellis.py:187-199` vs `layer_renders.store_run_results`). Route through
  shared ingest so it's a first-class derived asset in the graph (BE-1).

### E.5 Backend — plumbing/efficiency

- **BE-6** (M) — one `services/modal_dispatch.py` (`spawn`/`poll` + explicit per-op mock
  policy); Modal wiring is hand-rolled in ≥6 places (`video_ops.py:346-381,656-678,…`;
  `views_trellis.py:74-84,164-179`; image views).
- **BE-7** (S) — one `services/media_paths.py`; MEDIA_URL→ROOT is duplicated with an explicit
  "mirrors" comment (`video_ops.py:139-151` ↔ `views_inpaint.py:39` ↔ `views_blob.py:40`).
- **BE-8** (M, low) — `find_layer_relation` in-Python scan (`layer_renders.py:32-39`) vs
  `MaskTrack`'s JSONB filter (`mask_tracks.py:30-37`) — two strategies for the same lookup;
  add an indexed `layer_id` column (also serves BE-3 scoping).
- **BE-9** (M, w/ queue) — heavy composite/h264 runs in the poll request thread
  (`video_ops.py:680-913`, self-acknowledged); make `Op.ingest` queue-runnable (already
  `request`-free) for the planned Huey queue.
- **BE-10** (S, after BE-1/3) — one `/api/library/ops/` registry endpoint exposing all ops +
  ports; today only the two video ops are exposed (`views_video_ops.py:29-36`).
