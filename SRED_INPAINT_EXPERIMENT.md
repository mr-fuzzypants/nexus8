# SR&ED Project Documentation & Technical Plan
# Interactive Inpainting Preview — Canvas Composite & Live Diffusion Experiment

**Project codename:** nexus8 annotation editor — interactive inpainting
**Claim period:** FY2026 (work commenced July 2026, ongoing)
**Systems involved:** nexus8 SPA (React/Konva annotation editor), nexus8 Django backend, Modal.com serverless GPU platform, Stable Diffusion XL / LCM-LoRA inpainting pipeline
**Prepared:** July 2026 — living document; update as experimental work proceeds

---

# Part A — SR&ED Narrative

## A1. Project objective

Develop two complementary systems for interactive AI-guided inpainting within nexus8's mask annotation editor:

1. **Fast canvas preview**: a client-side compositing pass that gives the artist a spatially accurate visual guide of what each mask operation will produce — without triggering server-side inference. The preview is operation-specific: reference-image composited into the mask region for `inpaint`, the reference composited outside the mask for `background_replace`, a checkerboard/hole treatment for `remove`, and so on. The guide updates in real time as strokes are drawn.

2. **Live diffusion experiment**: a debounced stroke-complete generation loop in which, as the artist draws mask strokes, a fast diffusion model (LCM-LoRA or SDXL-Turbo) running on a Modal-hosted GPU rasterizes the current mask, runs prompted inpainting, and composites the result back onto the canvas as a translucent overlay — enabling iterative mask refinement with near-real-time feedback.

No commercial annotation tool or production asset system provides both of these within the same editing surface. Existing inpainting tools (Adobe Firefly, Leonardo AI's inpaint) operate as round-trip submit-and-wait flows with no live spatial preview; they do not integrate with asset versioning systems or support operation-typed masking (inpaint vs. remove vs. background_replace) at the layer level.

## A2. Technological uncertainties

### U1 — Sufficient fidelity of canvas clip-path composite for spatial guidance

The fast preview clips a reference image (or applies a visual treatment) to the user's drawn mask region on the HTML5 Canvas element. Mask regions consist of heterogeneous primitives: polygon vertices, freehand brush strokes (variable-radius circles along a polyline), and future rectangle/ellipse shapes. Achieving pixel-accurate clipping requires constructing a compound clip path from these primitives before compositing the reference image. It was unknown whether: (a) the round-trip cost of clip-path construction and image compositing can be held within one frame budget (~16ms) on large source images (4K+) with many strokes; (b) a bounding-box approximation (clip to mask's axis-aligned bounds rather than stroke shapes) provides sufficient spatial accuracy for artists to make mask decisions from; and (c) the operation-inverted case (`background_replace` clips outside the mask) can be composited correctly within Canvas 2D's compositing mode set without introducing z-order artifacts against the base image.

### U2 — Round-trip latency viability for stroke-complete live generation

The live generation loop requires: pointer-up event → debounce → client-side mask rasterization → HTTP POST → Django dispatch → Modal function call → GPU inference → result bytes → HTTP response → canvas overlay repaint. It was unknown whether this chain can be kept under a perceptual interactivity threshold (~2–3 seconds end-to-end) reliably enough that artists iterate on strokes rather than abandoning the loop and falling back to the commit-and-wait flow. The primary variable is inference latency; the secondary is Modal cold-start behaviour under real traffic patterns.

### U3 — LCM-LoRA / SDXL-Turbo suitability for preview-quality inpainting

Standard SDXL inpainting runs 25–50 denoising steps (~10–30 s on A10G). Latency Consistency Model (LCM) LoRA allows 4–8 step inference on the same base model at the cost of some quality; SDXL-Turbo targets single-step generation. It was unknown whether LCM-LoRA at 4–8 steps or SDXL-Turbo at 1–4 steps produces results of sufficient preview quality (coherent content, plausible fill) to be useful as a stroke-iteration guide — or whether the quality degradation at low step counts makes the live output misleading rather than helpful. Additionally, it was unknown whether the same pipeline serving text-only inpainting and IP-Adapter-guided inpainting (reference image) can be structured as a single Modal deployment without requiring two separate container images with conflicting weight dependencies.

### U4 — Warm container reliability under interactive traffic patterns

Modal's `keep_warm` parameter holds a container alive to eliminate cold-start GPU initialization (~8–15 s for diffusion model loading). It was unknown whether a single warm container suffices for interactive single-user iteration (strokes arrive with ~500ms debounce; requests are serialized) or whether GPU preemption events under Modal's scheduling policies re-introduce cold starts at unpredictable intervals, breaking the latency contract silently. There is no published SLA for warm-container preservation under low sustained traffic.

### U5 — Coherence of generated inpaints over partial and evolving masks

During iterative mask drawing, the mask region changes with each new stroke: it may be small (single brush stroke over a patch), irregular, or semantically incomplete (half an object masked). It was unknown whether a prompted inpainting model produces coherent, useful output on partial mask regions — or whether the model requires a "complete" mask (the full intended region) before the generation is meaningful enough to guide further stroke decisions. If partial-mask outputs are incoherent, the debounce timing strategy (fire on each stroke-complete) must be replaced by a user-gated trigger (fire only when the artist explicitly requests it), removing the "live" quality but retaining the fast-model benefit.

### U6 — Overlay integration without contaminating the annotation layer state

The live inpainting result must appear as a distinct visual overlay (not a committed annotation or a new asset version) so the artist retains the ability to edit strokes freely. It was unknown how to represent this ephemeral overlay in the existing annotation canvas architecture — which is driven by an immutable annotation list rendered via `buildAnnotationSceneRenderPlan()` — without: introducing a parallel mutable render path that diverges from the annotation's source-of-truth; blocking the normal annotation interaction (selection, undo) while a generation is in flight; or leaving stale overlay frames visible after stroke edits invalidate a prior generation.

### U7 — Organizing generated candidates within a linear asset-versioning system

Live testing of the generation loop (sketch-inpaint with `num_variants` up to 4, repeated runs per layer) exposed a data-model uncertainty: the platform's `Version` sequence models *iteration of the same artifact*, but a regeneration with a new prompt or seed is not an iteration — it is a parallel *candidate*. It was unknown how to store many-runs × many-variants of generated renders per mask layer such that: (a) every render remains individually addressable with its own immutable provenance (seed, prompt, parameters, exact input versions); (b) an artist's *selection* of one candidate is a first-class, auditable operation; (c) all lookups remain index-served at scale (the interim implementation's entry path — JSONB `type_data` matching on the entity table — is an un-indexed sequential scan executed on every dispatch and poll); and (d) the linear version semantics of the rest of the platform are not broken for non-generated assets.

## A3. Hypotheses

- **H1 (Bounding-box approximation):** Clipping the reference image to the mask region's axis-aligned bounding box (rather than pixel-accurate stroke shapes) provides sufficient spatial guidance for mask decision-making in practice. The discrepancy between box and true mask shape is small enough relative to the uncertainty inherent in diffusion output that artists will not be misled.
- **H2 (Canvas compositing within frame budget):** Reference image composite operations over the mask region can be completed within a single animation frame (~16ms) for source images up to 4K resolution, using Canvas 2D's `drawImage` with clipping, provided the reference image is decoded and cached in memory ahead of time on layer selection.
- **H3 (LCM-LoRA at 4–8 steps for preview):** LCM-LoRA applied to SDXL-inpainting at 4–8 steps produces output that, while not final-quality, is coherent and plausible enough for a stroke-iteration guide. The quality is better suited to the "guide, not output" framing than SDXL-Turbo at 1–2 steps.
- **H4 (Single deployment for text + IP-Adapter):** A single Modal function, parameterized by whether `reference_bytes` is provided, can load IP-Adapter weights lazily and serve both text-only and reference-guided inpainting requests from the same warm container, avoiding two separate deployments.
- **H5 (Warm container under low interactive traffic):** A single `keep_warm=1` Modal container is sufficient for interactive single-user iteration; round-trip latency stays under 2.5 s (inference ~1–1.5 s + network ~0.5 s + rasterization ~0.1 s + canvas repaint ~0.05 s) reliably outside of cold-start events.
- **H6 (Ephemeral overlay via out-of-band render pass):** The live generation result can be composited as an ephemeral layer in a second `drawImage` pass after the main `renderPrimitiveBatchesToCanvas()` call, without modifying the annotation list or scene render plan. Invalidation (clearing stale overlays on new strokes) is handled by resetting a ref on `pointerdown`.
- **H7 (Two-axis versioning for generated candidates):** Adding a second axis to the `Version` model — `variation_number` alongside `version_number`, unique on `(entity, version_number, variation_number)` — resolves U7 without new tables: one render asset per (source, layer); each generation run is a `version_number`; each parallel candidate is a `variation_number` under it. Per-render provenance lives in each variation's immutable `Version.data`; exact input pinning uses `VersionLink` edges (`init_image`, `sketch_guide`); selection is a `Symlink` (`selected`) pinning an exact `vN.M`, with the existing `SymlinkEvent` audit trail and `RESTRICT` deletion protection. All hot queries enter through FK-indexed edges (`EntityRelation (asset, role)`, `Version.entity`), eliminating the JSONB sequential scans.

## A4. Work performed (systematic investigation to date, July 2026)

**Conceptual design phase.** The annotation editor's existing mask rendering path was analyzed: mask strokes are stored as `AnnotationLayer` records with `maskRegion: true`, rendered via `buildAnnotationSceneRenderPlan()` in `AnnotationViewport.tsx`, and rasterized client-side on commit via `rasterizeMask.ts`. The `mask_op`, `prompt`, and `reference` fields exist in the layer model and are persisted to backend but are not consumed in any rendering or generation path. The `handleGenerateMaskForLayer()` function in `AnnotatorPage.tsx` rasterizes and uploads the mask PNG but makes no AI call. This analysis established the baseline and confirmed no preview or live generation capability exists in the current system.

**Framing experiment (canvas preview — U1, H1, H2).** The five mask operations were analyzed for the most informative client-side visual treatment achievable without server inference: `inpaint` → reference image clipped to mask region; `background_replace` → reference image composited outside mask (Canvas `destination-out` / `destination-over` sequence); `remove` → checkerboard fill within mask bounds (communicates "absence" rather than "content here"); `outpaint` → reference image (if present) extended beyond canvas edge bounds, or neutral grey extension zone; `segment` → strong outline + desaturate-outside treatment. The bounding-box vs. pixel-accurate clip tradeoff (H1) was identified as the key question: pixel-accurate requires constructing a clip path from all brush-stroke circles and polygon vertices per frame, which for dense masks on 4K images will exceed the frame budget. Bounding-box approximation reduces this to a single `rect()` clip call. H1 and H2 remain experimental — not yet implemented.

**Architecture design (live generation — U2–U6).** The live generation architecture was designed: Modal function (`nexus8-inpaint`) with `keep_warm=1` on A10G; LCM-LoRA as the default fast pipeline (H3); lazy IP-Adapter load (H4); Django trigger endpoint (`POST /api/library/assets/<id>/mask/inpaint/`) that resolves the base image and reference URI, calls `inpaint.spawn()`, returns a `call_id`; Django poll endpoint (`GET .../inpaint/status/`) that calls `FunctionCall.from_id(call_id).get(timeout=0)` and stores the result as a linked asset on completion; frontend debounce on `pointerup` (400ms), short-poll at 200ms intervals, overlay rendered in a second canvas pass (H6). No implementation yet — design only.

**Implementation iteration 1 (July 2026).** Phases 1–4 implemented and verified end-to-end:

- *Canvas preview (Phase 1)*: `maskBounds.ts` (shared bbox helper, also refactored into the existing generate path) and `maskOpPreview.ts` (all five op treatments). Even-odd clip paths were used for all "outside the region" composites (`background_replace`, `outpaint`, `segment`) instead of `destination-out` compositing — the preview draws onto the same canvas as the stroke primitives, and destination-out would erase them (resolves U1(c) by construction). `ctx.filter: saturate()` was rejected for the segment treatment in favour of a flat dim fill (frame-budget concern, H2). Reference images resolve through the existing `blob/resolve` endpoint (no new backend surface needed) and are cached as decoded `HTMLImageElement`s keyed by URI.
- *Modal function (Phase 2)*: deployed as app `nexus8-inpaint` (A10G, weights baked into the image via `run_function`; no `min_containers` per the cost decision; `scaledown_window=300`). Cold start ≈30 s total round-trip; warm inference ≈1.1 s at 6 LCM steps.
- *Django (Phase 3)*: `views_inpaint.py` trigger/status endpoints; result stored as a separate `inpaint_preview`-role asset that gains a new version per generation. Verified by curl: 202 dispatch → poll → done with `latency_s` telemetry; 404 unknown layer; 400 missing prompt; idempotent status re-poll.
- *Live loop (Phase 4)*: debounce-on-commit → rasterize+save → trigger → 500 ms poll → overlay, with a monotonic generation counter for invalidation (H6). Browser verification pending.

**Implementation iteration 2 (July 2026) — insertion failure investigation.** Live browser use exposed that prompted generations appeared to do nothing. Systematic isolation: (1) mask polarity conversion verified correct locally (white ellipse on black, 11% coverage); (2) container-side diagnostics confirmed prompt/mode/guidance/scheduler all reached the pipeline; (3) the canonical diffusers demo (dog→tiger) succeeded in the same deployment, isolating the failure to input characteristics rather than environment; (4) `padding_mask_crop=64` identified as the resolution (F6). The dual-mode (fast/quality) deployment and the layer-level `gen_mode` selector were built in this iteration.

**Implementation iteration 3 (July 2026) — recolor envelope and live-use hardening.** A real artist request ("red puppy nose") drove a parameter-space sweep (strength 0.99 / 0.65, guidance 7–9, negative prompts), concluding that attribute recolor is outside the model's reliable envelope (F7) while establishing the working prompt strategy (F8). `strength` and `negative_prompt` were exposed end-to-end; the live overlay was changed to full-opacity with a region border after the 0.75 blend was shown to perceptually erase small-region results. Result storage, API lookup paths, and the commit gap were documented (F10).

**Implementation iteration 4 (July 29 2026) — storage-model investigation for generated candidates.** Live testing of multi-variant sketch-inpaint (batched Modal generation returning up to 4 PNGs per dispatch) surfaced U7. The interim storage model was analyzed end-to-end: one preview `MediaAsset` per (source, layer, *variant index*), each regeneration stacking a new `Version` on its slot; generation parameters held on the mask relation's `type_data` and overwritten on every dispatch; the relation's `entity_version` pointer bumped to latest, leaving only the newest render addressable. Four defects were identified (F11, F12), the design space was mapped against three candidate reorganizations — (A) generation-batch containers reusing the existing `generation.py` provenance machinery (`ContainerReference` pinning, `GENERATED_FROM_BATCH` lineage, `reproduction_manifest`); (B) flat per-render assets with soft run grouping; (C) a two-axis version grid — and evaluated against retention ("keep everything"), a cross-run contact-sheet query surface, library visibility, and expected volume (tens of renders per layer). Option C was initially rejected (linear version numbers misrepresent parallel candidates) and then **rehabilitated by the `variation_number` schema change** (migration 0014), which removes exactly that objection; with it, C dominates A/B on row count and machinery reuse at the expected scale (H7). The resulting schema — models, roles, lineage edges, worked example, write path, and per-query index coverage — is documented with UML in `LAYER_RENDER_SCHEMA.md` (F13). Implementation (variation-aware `add_version`, run allocation at dispatch, rework of the three `_store_result` paths, selection endpoint) is designed but not yet built.

**Experimental findings (July 2026).**

- **F1 — LCM cannot insert objects (U3/H3 partially refuted).** At LCM's usable guidance range (≤2.0), prompted *object insertion* fails outright: "a snowman" into a masked snow region yields beautifully harmonized background (rocks, snow mounds) with no snowman, at 6, 8, and 12 steps. LCM-mode output is excellent for *removal/harmonization* (a masked rock was replaced with style-consistent snow) but the low CFG cannot steer content semantically. H3 must be restated: LCM is preview-quality for `remove`-like operations and texture fill, not for semantic insertion.
- **F2 — insertion requires real CFG, so the deployment is dual-mode (H4 extended).** The LCM LoRA is deliberately left **unfused** so each request selects `mode="fast"` (LCM scheduler + LoRA, 6 steps, guidance 1.5) or `mode="quality"` (base EulerDiscrete scheduler, LoRA disabled, 20 steps, guidance 7–8). Verified with the canonical diffusers demo (dog-on-bench → tiger): quality mode inserts a full tiger; fast mode at the same seed yields a soft, low-detail but correctly-placed animal — acceptable as a spatial/semantic guide, confirming the dual-mode design.
- **F3 — mask salience gates insertion even at CFG 8.** With a peripheral mask (bottom-left ellipse, ~11% of area) in a strong-context scene, even quality mode at guidance 8.0 background-fills rather than inserting the prompted object ("a bright red wooden crate" → snowy rocks). The same pipeline inserts reliably when the mask covers a compositionally salient region (the demo's centred subject). Consequence for U5: coherence depends less on mask *size* than on mask *position/salience* — the planned area-percentage sweep should be redesigned around salience.
- **F4 — latency (H5, U2).** Warm end-to-end round-trip through Django (byte loads → spawn → inference → PNG → ingest as new version → poll): **4.6 s**. Cold: **31 s**. Warm is above the 2.5 s hypothesis but within the usable range for stroke-iteration; the cold-start UX mitigation ("GPU warming up…" after 5 s) is implemented. `modal run` CLI invocations never hit warm deployed containers (each is an ephemeral app) — warm-path measurements must go through the deployed app handle, which the Django path does.
- **F5 — content-hash dedup collides identical masks across layers (pre-existing).** `ingest_file`'s sha256 dedup means two layers whose rasterized masks are byte-identical resolve to the *same* mask asset, and the second save re-stamps `mask_layer_id` — silently unbinding the first layer. Surfaced while testing the missing-prompt path. Not fixed in this iteration; noted as a MaskSaveView issue to address separately.
- **F6 — mask-crop inpainting resolves F3 and substantially revises F1 (July 2026, iteration 2).** Enabling diffusers' `padding_mask_crop=64` (inpaint the mask's cropped neighbourhood at full pipeline resolution, then paste back) makes the previously-stubborn peripheral mask insert reliably: the identical prompt/seed/mask that background-filled at CFG 7 without cropping produced a fully-formed, style-matched snowman with it. More significantly, **fast (LCM) mode also inserts under mask-crop** — a soft, low-detail but unmistakable snowman at 6 steps / guidance 1.5. F1's conclusion ("LCM cannot insert objects") was therefore confounded: the dominant failure factor was mask salience within the model's field of view, not the low CFG. Revised model: LCM insertion is *weak but usable as a guide* once the mask is made salient by cropping; full CFG remains meaningfully sharper. The dual-mode deployment stands (quality for fidelity, fast for iteration speed), with `padding_mask_crop=64` now unconditional in the Modal function. A `gen_mode` selector (auto/quality/fast) was added to the layer detail panel; auto resolves to quality when a prompt is present. A separate UX finding motivated this iteration: an artist's instruction-style prompt ("paint this area a bright blue") both reads poorly as a diffusion prompt (imperative, not descriptive) and ran in fast mode pre-selector — prompt phrasing guidance may belong in the panel UI.
- **F7 — attribute recolor is outside the model's reliable envelope (July 2026, iteration 3).** Real-use test: "red puppy nose" over a small (78×88 px) mask on a black puppy nose. The region *was* regenerated every time (shape/sheen changed), but the colour prior won across the whole parameter space: strength 0.99 → new nose, still dark; +negative "black" at guidance 9 → out-of-distribution glass-ball artifacts; strength 0.65 (structure-preserving) → original reasserts, no recolor. Conclusion: insert/remove/replace-with-object are reliable (F6); *recolouring small features to prior-violating colours is not*, and a deterministic client-side tint using the already-rasterized mask would be the correct tool for that class of edit. Two supporting changes shipped: `strength` and `negative_prompt` are now exposed end-to-end for experimentation, and the live-preview overlay now composites at full opacity with a hairline region border (the previous 0.75 blend over the original made subtle regenerations read as "nothing changed" — a UX-masking effect that initially mimicked a generation failure).
- **F8 — prompt strategy determines success as much as mode selection (July 2026, iteration 3).** Live-use sessions established a working prompt model, confirmed by a clean success case: the prompt "blue eye" over an eye mask produced convincing blue eyes on the puppy image — *in fast mode* — while "red puppy nose", "a strawberry", and "a fuzzy yellow tennis ball" over the nose mask all failed or produced weak results. The discriminating factors: (a) **describe an object, never issue an instruction** — "paint this area bright blue" carries almost no usable conditioning signal; (b) **recruit the prior instead of fighting it** — asking for a *plausible variant of what is already there* ("blue eye" on an eye) or an *object whose canonical colour matches the request* succeeds where attribute-override prompts fail; (c) **mask generously** — a mask tightly tracing the old feature invites restyling of the old shape, while a mask with surrounding context gives the model room to compose the new object. This suggests the layer panel should eventually carry prompt-phrasing guidance, since the failure mode (a technically-successful generation that looks like "nothing happened") is indistinguishable from a system fault from the artist's perspective.
- **F9 — interaction-model observations from live use (July 2026).** (a) Only stroke commits trigger generation: editing the prompt alone, undo, or stroke deletion do not re-fire — deliberate for a small trigger surface, but users expect prompt edits to regenerate; a manual "regenerate" affordance is the likely fix. (b) A stale SPA bundle is a live confound in an HMR dev workflow: mid-session frontend changes (overlay opacity, mode selector) do not apply to an already-open annotator tab, so a user can be exercising superseded behaviour while the operator believes the fix is live. (c) The full-opacity overlay + hairline border (F7) is required for small masks — at overlay opacity <1 a small-region result composited over the similar original is perceptually invisible.
- **F10 — storage, observability, and the commit gap (July 2026).** Generated results are fully governed: bytes land in the standard content-addressed media store, catalogued as one `inpaint_preview`-typed MediaAsset per (source, layer) that accrues a Version per generation, linked to the source via an `EntityRelation(role="inpaint_preview")`, with dispatch/result timestamps and `latency_s` on the mask relation. Three consequences surfaced: (a) rapid live iteration accumulates preview versions (~0.3–2 MB each) with no cleanup policy; (b) the relations API does not surface the owning `mask_layer_id` in the relation payload (it lives on the mask asset's `type_data`), so mapping preview→layer over HTTP requires a join through the mask relations — a one-line summary change would fix it; (c) there is deliberately **no commit path yet**: results are previews only, and promoting a chosen preview version to a new version of the *source* asset (via the existing `add_version` machinery, with mask/prompt/mode provenance) is the designed next step.

- **F11 — the interim storage model conflates iteration with alternatives and destroys provenance (July 29 2026, iteration 4).** Four defects confirmed in the shipped sketch-inpaint/scribble storage path: (a) *provenance overwrite* — prompt, seed, and scales live on the mask relation's `type_data` and are clobbered on every dispatch, so a stored render `Version` has pixels but no durable record of what produced it (the `reproduction_manifest` machinery in `generation.py` solves exactly this and the interim path bypasses it); (b) *only-latest addressability* — the preview relation's `entity_version` tracks the newest version, so an earlier render an artist preferred is recoverable only by digging through version history with no distinguishing metadata; (c) *variant-slot lies* — slots are keyed by variant index, so "variant 1, version 3" and "variant 1, version 4" may derive from unrelated prompts, and shrinking `num_variants` strands stale slot assets whose relations survive; (d) *no selection concept* — artists generate many and keep one, and nothing models the choice. Extends F5 and F10(a,b).
- **F12 — JSONB `type_data` entry paths are unindexed sequential scans (July 29 2026, iteration 4).** `_mask_lookup` — executed on every dispatch and every status poll — filters `MediaAsset` on `type_data__mask_of_asset_id` + `type_data__mask_layer_id`, a sequential scan over the *entire* single-table entity store (assets, containers, boards, annotations). Django JSONB path lookups (`data__key=`) also do not use the existing GIN indexes (only containment queries do). Consequence adopted as a design rule: `type_data` values may mirror identifiers for debuggability but must never be query entry points; all hot lookups must enter through FK-indexed edges (`EntityRelation` `(asset, role)` — index already present — then in-memory `layer_id` match over the per-layer row set).
- **F13 — two-axis versioning (versions × variations) resolves U7 with zero new tables (July 29 2026, iteration 4).** With migration 0014 (`variation_number` on `Version`, unique `(entity, version_number, variation_number)`, ordering `-version_number, -variation_number`), the render storage model becomes: one render asset per (source, layer) related via `EntityRelation(role="layer_render", type_data.layer_id)`; each dispatch allocates the next `version_number` (the run); each returned PNG is an immutable variation `vN.M` whose `Version.data` carries its full self-contained generation record (per-variation seed = run seed + index, prompt, scales, `mask_dims`, Modal call id, latency); `VersionLink` edges pin the exact source-image version (`init_image` — the role named in the `VersionLink` docstring) and guide-bitmap version (`sketch_guide`), with `RESTRICT` preventing deletion of inputs while derived renders exist; artist selection is `update_symlink(render_asset, "selected", vN.M)`, audited by `SymlinkEvent` and `RESTRICT`-protected. The contact-sheet query (all renders for a layer, grid of runs × variations) is a single FK-indexed fetch; seed/prompt filtering is served by the existing GIN index via containment queries. At the expected volume (tens of renders per layer) this stays ~two orders of magnitude smaller in entity rows than per-render-asset alternatives while keeping every render individually addressable. Full schema with UML: `LAYER_RENDER_SCHEMA.md`.

**Hypothesis status (end of July 2026 iterations).**

| Hypothesis | Status |
|---|---|
| H1 (bbox approximation suffices) | Implemented; no fidelity complaints in live use, formal artist assessment pending |
| H2 (composite within frame budget) | Implemented with cheap primitives (single rect clips, no `ctx.filter`); 4K/50-stroke measurement pending |
| H3 (LCM preview quality) | **Revised** — LCM alone cannot insert (F1); with `padding_mask_crop` it inserts softly (F6); reliable envelope excludes attribute recolor (F7) |
| H4 (single deployment, lazy IP-Adapter) | **Validated**, and extended to dual fast/quality modes via unfused LoRA (F2) |
| H5 (latency < 2.5 s warm) | **Partially refuted** — warm 4.6 s, cold 31 s under the no-keep-warm cost decision (F4); usable but above target |
| H6 (ephemeral overlay + invalidation) | **Validated** in live use — overlay never touches annotation state; stroke-start invalidation works (F9c refined its rendering) |
| H7 (two-axis versioning for candidates) | **Design validated** against retention/query/volume requirements (F13); schema change landed (migration 0014); write-path implementation pending |

## A5. Technological advancement sought

- A **real-time, operation-specific canvas preview** technique for mask-based generative AI operations, derived entirely from client-side compositing, that gives artists spatial guidance without server round-trips or inference cost — advancing beyond the single-colour overlay that is standard practice in annotation tools.
- An **interactive stroke-iteration loop** coupling a browser annotation editor to a serverless GPU runtime (Modal) via a debounce-and-poll protocol, targeting sub-3-second stroke-to-result latency for inpainting previews during active mask editing — a pattern with no established precedent in production asset management tooling.
- Experimental determination of whether **LCM-LoRA at low step counts** is suitable as a preview-quality inpainting model in an interactive annotation context, and whether **partial / evolving mask regions** yield sufficiently coherent model outputs to support iterative mask refinement.

## A6. Personnel & records

| Role | Work |
|---|---|
| R. Pringle (developer/architect) | All design, conceptual analysis, experimental verification |

Supporting evidence: git history in `nexus8` repository; design discussion records; this document.

> **Record-keeping practice:** commit experiment notes with the work — what was hypothesized, what step counts were tested, what partial-mask sizes produced coherent vs. incoherent output, what latency was measured. Keep failed parameter choices in history. Date all design decisions in this document.

---

# Part B — Technical Plan

Work is sequenced to test the highest-risk uncertainty (U5, partial-mask coherence) first, before investing in the full live-generation infrastructure.

**N8** = nexus8 Django backend. **SPA** = nexus8 React frontend. **M** = Modal.com.

## Phase 1 — Canvas preview composite (SPA, ~1 wk) — tests H1, H2

Implement the client-side fast preview; no Modal or server changes required.

- **1.1** Add `previewMode: boolean` state to `AnnotatorPage` (default off); surface as a toggle button in the mask mode toolbar, visible only when the active layer has a `mask_op` set.
- **1.2** Add a second canvas render pass in `AnnotationViewport` after `renderPrimitiveBatchesToCanvas()`. When `previewMode` is on, call `renderMaskOpPreview(ctx, activeLayer, visibleMaskAnnotations, baseImageDimensions)`.
- **1.3** Implement `renderMaskOpPreview()`:
  - Compute bounding box of all annotations on the active layer (reuse the existing bounding-box logic from `handleGenerateMaskForLayer`).
  - `inpaint`: decode and cache the `reference` asset image on layer selection; `drawImage` into the bounding box at 0.8 opacity.
  - `background_replace`: same reference image but composited outside the mask bounding box using `destination-out` / `destination-over`.
  - `remove`: draw a 10×10 px checkerboard fill within the bounding box at 0.7 opacity.
  - `outpaint`: reference image (if set) drawn beyond canvas bounds; grey zone if no reference.
  - `segment`: `strokeRect` with 2px accent colour, plus a desaturate pass outside the box (Canvas `filter: saturate(0.2)` on a clipped region).
- **1.4** Cache the decoded reference `HTMLImageElement` in a ref keyed by `layer.reference`; clear on layer switch.
- **Exit criteria:** toggling preview mode on an `inpaint` layer with a reference shows the reference image spatially composited into the mask region; `remove` shows checkerboard; frame rate does not drop below 30fps on a 4K base image with 50 brush strokes (H2 test). Pixel-accurate vs. bounding-box accuracy noted in experiment log (H1 test).

## Phase 2 — Modal inpaint function (M, ~2–3 days) — tests H3, H4, U3

Deploy the GPU-side function and validate model quality at low step counts.

- **2.1** Create `nexus8/modal/inpaint.py`. Modal `App("nexus8-inpaint")` with an A10G-GPU function, `keep_warm=1`, 120 s timeout.
- **2.2** Pipeline: `AutoPipelineForInpainting` from `diffusers/stable-diffusion-xl-1.0-inpainting-0.1`; `LCMScheduler` loaded from `SimianLuo/LCM_Dreamshaper_v7` for LCM-LoRA mode.
- **2.3** LCM-LoRA weights loaded at container startup (`pipe.load_lora_weights("latent-consistency/lcm-lora-sdxl")`); `num_inference_steps` parameter (default 6) exposed to callers to allow step-count experiments.
- **2.4** IP-Adapter loaded lazily on first request with `reference_bytes` (H4): `pipe.load_ip_adapter("h94/IP-Adapter", subfolder="sdxl_models", weight_name="ip-adapter_sdxl.bin")`; `ip_adapter_loaded` flag prevents double-load.
- **2.5** Partial-mask coherence test (U5): deploy and run a sweep of mask sizes (5%, 15%, 30%, 50% of image area) with the same prompt; record generated images and subjective coherence score. Decide trigger strategy (auto-debounce vs. explicit button) based on findings.
- **Exit criteria:** function deployed and callable via `modal run`; LCM-LoRA 6-step inference completes in <2 s on a warm container (H3 test); IP-Adapter mode callable from same function (H4 test); partial-mask coherence assessment documented in experiment log.

## Phase 3 — Django dispatch & poll endpoints (N8, ~1–2 days) — tests H5

Wire the Django side to Modal; validate warm-container latency reliability.

- **3.1** New endpoint `POST /api/library/assets/<asset_id>/mask/<mask_id>/inpaint/`:
  - Load base image bytes from asset file path via Pillow.
  - Load mask PNG bytes from the mask's linked asset.
  - Resolve `reference` URI (`nexus8://asset/{code}`) → load image bytes if present.
  - Call `inpaint.spawn(image_bytes, mask_bytes, prompt, reference_bytes)` → store `call_id` in `EntityRelation.type_data["inpaint_call_id"]`.
  - Return `{"call_id": ..., "status": "working"}`.
- **3.2** New endpoint `GET /api/library/assets/<asset_id>/mask/<mask_id>/inpaint/status/`:
  - Fetch `call_id` from `EntityRelation.type_data`.
  - Call `modal.functions.FunctionCall.from_id(call_id).get(timeout=0)`.
  - If done: save result PNG as a linked asset (reuse `MaskSaveView` storage path but with `source="inpaint_result"`); return `{"status": "done", "result_asset_code": ...}`.
  - If pending: return `{"status": "working"}`.
- **3.3** Latency logging: record `dispatch_at`, `result_at` timestamps in `type_data` for every generation; expose as fields in the status response for frontend display and experiment tracking (H5 test).
- **Exit criteria:** end-to-end round-trip confirmed from `curl`; warm-container latency recorded across 10 sequential requests; cold-start frequency noted over a 1-hour idle period (H5 / U4 test).

## Phase 4 — Frontend live generation loop (SPA, ~2–3 days) — tests H5, H6, U5

Connect the annotation editor to the dispatch/poll endpoints.

- **4.1** Add `liveGenEnabled: boolean` state to `AnnotatorPage`; surface as a second toggle in the mask mode toolbar (distinct from the canvas preview toggle from Phase 1). Only enabled when `mask_op === 'inpaint'` and `prompt` is non-empty.
- **4.2** On `pointerup` inside the annotation canvas (when `liveGenEnabled` and active layer qualifies): debounce 400ms, then:
  - Call `rasterizeMask()` for the active layer.
  - Upload mask via `saveMask()` to get a `mask_id`.
  - POST to the inpaint trigger endpoint.
  - Begin polling status at 200ms intervals.
- **4.3** On poll result `status === "done"`: decode `result_asset_code` → fetch the result image URL → store in a `livePreviewImage` ref. Clear on `pointerdown` (H6: invalidate stale overlay).
- **4.4** Render `livePreviewImage` in the second canvas pass (from Phase 1) at 0.75 opacity, with a small "AI preview" label badge in the corner. The overlay does not block stroke editing.
- **4.5** Abort in-flight generation on `pointerdown` (cancel the poll loop; do not store stale result).
- **4.6** If U5 testing in Phase 2 finds partial-mask outputs are too incoherent: replace the auto-debounce trigger with an explicit "Generate preview" button in the `MaskLayersPanel`; all other infrastructure unchanged.
- **Exit criteria:** drawing a stroke, lifting the pen, and waiting <3 s produces a visible AI-generated overlay on the canvas (H5 test); editing a subsequent stroke clears the prior overlay immediately (H6 test); latency displayed to artist (e.g. "preview in 1.8 s") for experiment feedback.

## Phase 5 — Experiment assessment (~1 day)

- Document measured latencies (P50/P95) for the full round-trip across 30+ generations.
- Document partial-mask coherence findings from the Phase 2 step-count sweep.
- Assess H1: collect artist feedback on whether bounding-box preview adequately guides mask decisions, or whether pixel-accurate clipping is necessary.
- Decide next steps: promote to production flow, upgrade to pixel-accurate clip (H1 rejected), switch to streaming intermediate steps (WebSocket path), or deprioritize.
- Update this document with findings.

## Cross-cutting

- **Risk — U5 (partial-mask incoherence):** highest risk; scheduled as first experimental test in Phase 2. If auto-debounce is not viable, Phase 4.6 fallback preserves the fast-model value while removing the "live" quality.
- **Risk — U4 (warm container reliability):** monitor across Phase 3/4 work; if cold starts occur frequently, evaluate `keep_warm=2` (two warm containers) or a pre-warm ping on editor open.
- **Out of scope this experiment:** video frame inpainting; multiple simultaneous users; streaming intermediate denoising steps (WebSocket path); ComfyUI as the inference backend.

## Indicative timeline

| Phase | Duration | Cumulative |
|---|---|---|
| 1 — Canvas preview composite | ~1 wk | wk 1 |
| 2 — Modal function + quality test | ~2–3 days | wk 2 |
| 3 — Django dispatch/poll | ~1–2 days | wk 2–3 |
| 4 — Frontend live loop | ~2–3 days | wk 3 |
| 5 — Experiment assessment | ~1 day | wk 3–4 |
