# SR&ED Project Documentation & Technical Plan
# Intent-First Provenance Orchestration for Generative Node-Graph Workflows

**Project codename:** nexus8 ↔ nodegraph workflow integration
**Claim period:** FY2026 (work commenced July 2026, ongoing)
**Systems involved:** nexus8 (Django/Postgres asset tracking platform), nodegraph (Python node-graph execution engine, FastAPI/Socket.IO), ComfyUI (planned, third-party diffusion runtime)
**Prepared:** July 2026 — living document; update as experimental work proceeds

---

# Part A — SR&ED Narrative

## A1. Project objective

Develop a system in which generative AI workflows (diffusion-based image/video synthesis and general-purpose node-graph computation) are fully integrated with a production asset-tracking system such that:

1. Every generated asset version is **deterministically named and tracked**, with complete provenance (workflow version, exact input asset versions, parameters, seed).
2. Any generated result can be **reproduced exactly** at an arbitrary later date, even though the inputs are resolved dynamically from a continuously changing production database.
3. The orchestration layer is **engine-neutral**: the same provenance and reproduction guarantees must hold whether the executing engine is nodegraph today or ComfyUI (a third-party runtime not designed for external governance) later.
4. Artists interact through **automatically derived interfaces**: the run form presented in the asset system is derived by scanning the workflow graph itself, not hand-authored per workflow.

No off-the-shelf combination of tools provides this. Commercial production trackers (ShotGrid/Flow, ftrack, Kitsu) record versions but do not orchestrate generative graph execution or pin dynamically resolved input sets. Generative graph tools (ComfyUI, InvokeAI, Houdini PDG) execute graphs but treat asset selection as a runtime concern with no deterministic replay guarantee, and name outputs from workflow-local conventions. The gap between these two categories is the subject of this project.

## A2. Technological uncertainties

The following uncertainties could not be resolved by routine engineering or standard practice at the outset of the project.

### U1 — Deterministic reproduction of dynamically resolved input sets

Workflows must accept inputs declared *intensionally* — "all approved storyboard images related to character X" — rather than as fixed file lists. The production library changes daily. It was unknown whether a resolution model could be designed that (a) gives artists live, current query results at run time, (b) guarantees byte-identical replay months later after the library has changed, and (c) does so without copying/snapshotting asset content per run (prohibitive storage cost at production scale). Standard practice (runtime query evaluation, as ComfyUI custom nodes and Houdini PDG do) fails (b); content snapshotting fails (c).

### U2 — Deriving a complete and correct run interface from an arbitrary graph document

We hypothesized the workflow graph itself could carry its asset-system interface via typed nodes, with the run form derived by static scan. It was unknown whether a small closed node vocabulary (target asset, entity reference, asset query, output, intermediate pin) is *sufficient* to express real production workflows' input topology; how scan-derived asset interfaces interact with the engine's existing parameter-exposure mechanism (Control Surface Views) when both can reference the same graph state (conflict/precedence semantics were undefined); and whether inter-node dependencies (a query node parameterized by an entity node's resolution) can be expressed in graph topology without runtime evaluation.

### U3 — Pre-execution value injection across heterogeneous engines

The reproduction guarantee requires that no asset resolution occur during graph execution — all resolution must be frozen into an "intent" before cooking begins, and injected into the graph as pre-baked values. It was unknown whether this injection model could be implemented without modifying the graph engine's evaluation semantics; whether the same contract could later be honoured by ComfyUI, whose prompt-graph execution model has no external value-injection API; and how failure semantics work (network partition between asset system and engine mid-run must not corrupt provenance — "nothing half-lands").

### U4 — Selective persistence of intermediate artifacts

Diffusion workflows produce large intermediate tensors (latents, ~10s of MB each) that are valuable for iteration (reuse as inputs, debugging) but ruinously expensive to keep for every run of every batch. It was unknown how to design a declaration/arming model where the graph declares what *can* be kept, each run cheaply selects what *is* kept, and kept intermediates acquire provenance equal to final outputs — and whether such artifacts can later be promoted to first-class tracked assets without breaking the provenance chain.

### U5 — Ambiguity semantics safe for both interactive and headless callers

Context-based resolution (a shot referencing two characters, a workflow needing one) is inherently ambiguous. It was unknown what resolution semantics allow the *same* resolver to serve an interactive artist (surface ambiguity in a form) and an unattended API caller (must never silently guess), including whether "fan-out" (one run per candidate) can be made an explicit, safe primitive rather than an error path.

### U6 — Application-wide direct-manipulation binding under HTML5 drag-and-drop constraints

For the run interface, artists must be able to drag any asset from anywhere in a large SPA onto workflow inputs, with per-input type validation feedback *during* the drag. The HTML5 drag-and-drop protocol makes drag payload data unreadable during `dragover` (only on `drop`), and modal run dialogs block interaction with the rest of the application. It was uncertain whether accept/reject affordances and a non-blocking run surface could be achieved within standard browser APIs.

## A3. Hypotheses

- **H1 (Run Intents):** A run can be represented as an immutable *intent* — workflow@version + pinned input versions + materialized query sets + parameters + seed + declared output bindings + armed pins — created *before* execution. If the engine's only job is to fulfill an intent, then naming is deterministic, replay is exact (clone the intent), and the engine is interchangeable.
- **H2 (Graph as interface):** A closed family of five typed asset nodes (Self, Entity Reference, Asset Query, Output, Pin), plus a precedence rule that parameter views may never target asset-node configuration, is sufficient to derive complete run forms by static scan.
- **H3 (Intent-time materialization):** Resolving queries when the run form opens (visible to the artist), then pinning the materialized set into the intent, satisfies both liveness and replay without content snapshotting — pinning references to immutable versions, not bytes.
- **H4 (Injection as parameter override):** Pre-cook injection can reuse the engine's existing parameter-override pathway (as used by Control Surface Views), writing URI values into asset nodes' value stores, requiring no change to evaluation semantics; content I/O remains isolated behind the existing `nexus8://` URI driver.
- **H5 (Two-phase resolve→confirm):** A pure resolution phase (no side effects, returns per-slot resolutions/ambiguities/materialized sets) followed by an explicit confirm phase, with `on_ambiguity: fail | first | fan_out` for headless callers, is safe for both interaction modes.
- **H6 (Type-mirrored drag protocol):** Mirroring the dragged asset's media type into the `DataTransfer.types` list (as a distinct MIME entry readable during `dragover`) enables live accept/reject; replacing the modal with an overlay-free, focus-trap-free side panel keeps the whole application a valid drag source.

## A4. Work performed (systematic investigation to date, July 2026)

**Iteration 0 — analysis of the incumbent approach.** The pre-existing integration (engine-side "push governance": nodegraph's nexus8 driver armed itself mid-cook and named outputs from workflow-local data) was analyzed and found structurally unable to satisfy the objectives: naming derived from workflow names (non-deterministic from the asset system's perspective), no pre-run record of inputs (reproduction impossible for dynamically resolved inputs), engine-specific (no ComfyUI path). This established the need for inversion of control and motivated H1.

**Iteration 1 — conceptual design under H1/H5.** Candidate architectures were enumerated and evaluated (engine-owned provenance vs. asset-system-owned intents vs. hybrid event sourcing; runtime vs. intent-time query evaluation; entity→asset resolution via conventions vs. curated named reference slots). Design selected: intent-first with nexus8 as orchestrator; named reference slots on entities (`character.turnaround @ approved`) as the deterministic entity→asset path; two-phase resolve→confirm with explicit fan-out. Nine user journeys (J1–J9) were specified to test the model's coverage, including authoring, dev-cook, curation, context runs, fan-out, reproduction, failure, and intermediates.

**Iteration 2 — experimental UI prototype, round 1 (fixture-driven).** A frontend-only prototype was built in the nexus8 SPA (`web/src/features/workflows/`) against an API-shaped fixture seam whose types mirror the intended intent contract — a deliberate dry-run of the API design. Validated: pre-resolved input chips with version/policy provenance, ambiguity surfaced as a picker (never guessed), plain-language outcome line, per-frame fan-out plan. This exposed that attachment-level input configuration duplicated information already present in the graph, motivating H2.

**Iteration 3 — graph-derived interface, round 2.** The prototype was rebuilt so the run form is produced by *scanning a graph document fixture* containing the five typed asset nodes — the same code-path shape the real scanner will have. Validated: query-node rows rendering materialized thumbnail sets that re-materialize when an upstream entity selection changes (H3's liveness half); per-run pin arming (U4's arming half); outputs/delivers derived from Output nodes; a graph-interface inspector proving form ↔ graph correspondence. The precedence rule (views never configure asset nodes) was adopted to resolve U2's conflict question.

**Iteration 4 — direct-manipulation binding, round 3 (H6).** Experimental resolution of U6: the modal was replaced with a global, non-blocking side panel (no overlay, no scroll lock, no focus trap) so the entire application remains a live drag source; a drag protocol was developed using a custom MIME payload plus the media type mirrored into `DataTransfer.types`, giving per-input accept/reject feedback during `dragover` — working around the specified unreadability of drag payloads before drop. Single-input override-with-revert and list add/remove editing over materialized query sets were validated. Behaviour was verified by scripted browser automation (synthetic `DragEvent` chains), including negative cases (video rejected by image-only inputs, accepted by `any` inputs).

**Iteration 5 — Phase 1 backend shipped (July 2026).** The nexus8 intent backend was implemented and connected to the SPA. Concrete artifacts: `EntityReferenceSlot`, `WorkflowAttachment`, and `RunIntent` Django models with migrations; a graph scanner (`graph_scanner.py`) that extracts the five typed node kinds from a published graph document; the full intent API surface (`/api/intents/resolve/`, `/api/intents/`, `/api/intents/{id}/dispatch/`, `/api/intents/{id}/status/`, `/api/intents/entities/{code}/reference-slots/`, `/api/intents/browse/`); `views_workflow.py` extended to run `scan_graph()` on every workflow publish and store the result in `Version.data`; and `mockApi.ts` set to route to real endpoints (`WORKFLOW_MOCK_ENABLED = false`), confirmed by 15 `RunIntent` rows with real `engineRunId`s and lifecycle status. The dispatch→nodegraph→status-callback round-trip is working: nexus8 fires the intent, nodegraph executes and calls back `PATCH /api/intents/{id}/status/` with `succeeded`. An important structural finding emerged during this phase: the node IDs in `nodePins` (e.g. `n_self`) are currently hand-authored stubs in nexus8's graph document, not real nodegraph node identifiers. The injection step (H4) cannot be tested until Phase 2 delivers published graph documents with real node IDs. This clarifies that H4 remains the primary open hypothesis. Remaining Phase 1 item: `ReferencesSection` UI not yet connected to the real reference-slot API (1.1).

**Iteration 7 — Phase 2/3 nexus8 preparation (July 2026).** Three items unblocking the Phase 2→3 transition were implemented on the nexus8 side. (1) **Attachment graph\_interface auto-sync**: `WorkflowRegisterView` now bulk-updates the `graph_interface` field on all "follow latest" `WorkflowAttachment` rows whenever a new workflow version is published — so any real nodegraph graph publish immediately propagates its scanned interface to all downstream attachments without manual intervention. (2) **Intent clone/reproduce** (`POST /api/intents/{id}/clone/`): creates an exact copy of an existing intent (same `node_pins`, `params`, `seed`, `armed_pins`, `output_bindings`) as a new `pending` intent, satisfying H1's reproduction guarantee — the clone can be dispatched immediately to re-execute with identical inputs. An optional `newSeed` body field allows seed-only variation. (3) **Reproduce button in RunHistorySection**: each terminal intent row now has a refresh-icon action that calls `cloneIntent` + `dispatchIntent` and invalidates the run-history query, closing the reproduce loop from the SPA.

**Iteration 6 — run lifecycle feedback (July 2026).** The run panel now uses real intent status rather than a simulated node-progress animation. After dispatch, a `useQuery` poll (`refetchInterval: 2 s`, halts on terminal status) tracks the intent through `queued → running → succeeded/failed`. The status badge and outcome card reflect the live DB state; error messages surface on `failed` intents. A `RunHistorySection` component was added to the asset panel, listing the last 8 intents for an asset with status badges and relative timestamps, auto-refreshing every 10 s. 15 real intents (wf=concept\_gen, target=render\_8c3cb5c05e) are now visible here. The mock node-progress animation and `doneCount` state were removed as dead code; the `RunIntent` type was extended with `engineRunId`, `errorMessage`, `createdAt`, and `cancelled`/`pending` statuses from the real API.

**Findings to date.** H1/H2/H3/H5/H6 have survived prototype-level testing; H4 (injection) and the ComfyUI half of H3/H4 remain untested pending real graph publish (Phase 2). One standard-practice failure was documented: React synthetic-event pooling nulls `currentTarget` before state-updater execution (Mantine checkbox handlers), requiring value capture before dispatch. Structural finding (Iteration 5): intent-side node IDs are only meaningful once nodegraph publishes real graph documents — the injection contract cannot be validated against stub graphs.

## A5. Technological advancement sought

- A provenance model for generative pipelines in which **reproduction is a property of the orchestration layer, not the engine**: any run replayable from its intent alone, independent of engine, with dynamically resolved input sets replayed exactly (advance over runtime-resolution norms in ComfyUI/PDG-class tools).
- A **graph-as-interface** technique: production run UIs derived entirely by static scan of typed nodes embedded in the executable graph, with a formal precedence boundary between asset resolution (nodes) and parameter exposure (views).
- An **engine-neutral injection contract** allowing one intent format to govern heterogeneous runtimes (native node engine; wrapped third-party diffusion runtime).
- A browser interaction technique for **type-validated, application-wide drag binding** within HTML5 DnD's payload-opacity constraint.

## A6. Personnel & records

| Role | Work |
|---|---|
| R. Pringle (developer/architect) | All design iterations, prototypes, experimental verification |

Supporting evidence: git history in `nexus8` and `nodegraph` repositories (design docs, prototype commits, this document); design plan (`~/.claude/plans/` working notes → this repo's planning docs); scripted verification drives and screenshot captures; fixture-typed API contract (`web/src/features/workflows/types.ts`) recording the evolving intent schema.

> **Record-keeping practice for the remainder of the claim period:** commit experiment notes with the work (what was hypothesized, what was tried, what failed); keep failed approaches in history rather than force-pushing them away; date design decisions in this document.

---

# Part B — Technical Plan

Work is sequenced so each phase tests the next unresolved hypothesis with the smallest real implementation. **N8** = nexus8 (Django + SPA), **NG** = nodegraph.

## Phase 0 — Contract freeze (N8 + NG, ~1 wk)

The prototype's fixture types become a versioned, engine-neutral schema.

- **0.1** Intent schema v1 (JSON Schema): intent id/status, `nodes` map (node id → pinned URI(s)), materialized query sets, params, seed, output bindings, armed pins, `on_ambiguity`. Derived from `web/src/features/workflows/types.ts`.
- **0.2** Asset-node config schemas for the five node kinds (incl. `accepts: image|video|any`, query criteria, `related_to` as node reference).
- **0.3** Decide Entity Reference outputs: dual sockets (`entity` + `asset`) vs. parameter reference for Asset Query's `related to` (recommendation: dual sockets — dependency visible in topology; drives fan-out correctness).
- **Exit criteria:** schema documents reviewed; prototype fixtures re-expressed in schema v1 with no loss.

## Phase 1 — nexus8 intent backend (N8, ~2–3 wk) — tests H1, H5 ✅ mostly done

- **1.1** Reference slots on entities: CRUD model + API ✅ done; `ReferencesSection` wired to real API via `useQuery` / `setReferenceSlot`, mock fixtures removed ✅ done.
- **1.2** Resolver (`POST /api/intents/resolve/`) ✅ done.
- **1.3** Intent creation & storage (`POST /api/intents/`, `on_ambiguity: fail|first|fan_out`) ✅ done; 15 real intents in DB.
- **1.4** Output binding declaration (iterate/derive/custom) ✅ done.
- **1.5** SPA seam live: `RunWorkflowPanel` and `WorkflowsSection` import directly from `api/intents.ts` for the asset path; `mockApi.ts` shim retained only for `getAttachmentsForShot` / `getFanOutPlan` (fixture-only until Phase 4). `WORKFLOW_MOCK_ENABLED` flag removed from all real-path components ✅ done.
- **Exit criteria:** resolve→confirm round-trips from the real UI on real assets ✅; intent JSON validates against schema v1 ✅; fan-out 🔲 pending Phase 4.

## Phase 2 — nodegraph asset nodes & dev mode (NG, ~2–3 wk) — tests H2 ✅

- **2.1** Register the five typed nodes: `Nexus8Self`, `Nexus8Output`, `Nexus8EntityRef` confirmed live in the real `concept_gen` graph (UUIDs verified July 2026). `Nexus8AssetQuery` and `Nexus8Pin` not yet observed in production graphs but are defined node types. ✅ (three of five confirmed)
- **2.2** Dev-mode pickers: entity-ref/self nodes have `uri` input port wired for injection; `/api/intents/browse/` endpoint exists on N8. Dev-cook behaviour confirmed: nodes cook with empty `uri` when no intent_id present. ✅ N8 side ready.
- **2.3** Graph scanner in NG: N8's `graph_scanner.py` now handles both dict-format (stub) and list-format (nodegraph native) `inputs` — fixed `_extract_port_values` to read list-of-port-objects. No NG-side scanner yet, but N8 scanner produces correct publish-time validation. ✅ N8 side done.
- **2.4** Publish metadata: N8 `WorkflowRegisterView` runs `scan_graph()` on every publish and auto-syncs "follow latest" attachments ✅. Real nodegraph graph published to N8 (concept_gen v2): attachment 1 now has real UUID node IDs (`cfb7ef58d6f540f4a67666746ca6e27b` = Self, `2da515e21c7c4be29c9fefcde5dc6825` = Output, `7edee11510af47eda0b8e39e9cf58807` = EntityRef). New intents created from this attachment will carry correct injection keys in `node_pins`. ✅
- **Exit criteria:** N8 lists scanned interface with real node IDs ✅; TD end-to-end authoring + dev-cook in NG 🔲 (NG-side work; node chrome/pickers not yet confirmed end-to-end).

## Phase 3 — Execution integration (NG + N8, ~2–3 wk) — tests H4, the core uncertainty remaining

- **3.1** Injection walk ✅: on run start, NG fetches intent, builds `input_overrides = {node_id.uri: "nexus8://..."}` via `intent_to_overrides()`, injects into executor. Verified July 2026: intent 21 (`seed=42`, `node_pins: {cfb7ef…: "nexus8://render_8c3cb5c05e/v1", 7ede…: "nexus8://TOS_E_AUD/v4"}`) ran to `succeeded` in ~6 s; `render_8c3cb5c05e v7` created with `source_value='nexus8://render_8c3cb5c05e/v1'` (previous runs v3–v6 had `source_value=''` because node_pins carried stub IDs `n_self`/`n_out` that matched nothing in NG). Injection pathway proven sufficient for URI scalars. `_deliver_intent_outputs` now also calls `update_symlink(target_asset, "latest", new_ver)` so the latest pointer advances after each successful intent output.
- **3.2** Retire `_arm_nexus8_governance` ✅: `_deliver_intent_outputs` wraps all slot creates in a single `transaction.atomic()` — any slot failure rolls back all creates. `IntentStatusView.patch` defers `intent.status = "succeeded"` until after delivery; delivery exception re-marks intent `failed` so no half-landed state can exist. Empty/None output values are skipped before the transaction. `update_symlink(target, "latest", new_ver)` called inside the transaction so the pointer advances atomically with the version create. `failed` status PATCH ignores any `outputs` payload — verified: 8 versions before and after a deliberate `failed` PATCH with spurious outputs. Verified July 2026: intents 21, 22 created v7, v8 with `source_value='nexus8://render_8c3cb5c05e/v1'`; latest symlink → v8.
- **3.3** Run lifecycle events ✅: SPA connects directly to nodegraph Socket.IO (configurable via `VITE_NODEGRAPH_WS_URL`, default `http://localhost:3001`) using `socket.io-client`. `useRunTrace(engineRunId)` hook joins the per-run room `run:{engineRunId}` (nodegraph's `subscribe_run` / `run_trace` M3 stream), tracks `EXEC_STATUS.phase`, `NODE_PENDING`/`NODE_DONE` counts, and fires `polledIntent.refetch()` immediately on `EXEC_DONE`/`EXEC_ERROR` — eliminating the 2 s polling gap at run completion. `RunWorkflowPanel` stores `engineRunId` from the dispatch response, shows live "Running on engine — N/M nodes" during execution, and falls back silently to polling if nodegraph Socket.IO is unreachable (`reconnection: false`).
- **3.4** Reproduce: clone intent verbatim (J6) ✅ N8 side done (`POST /api/intents/{id}/clone/` + Reproduce button in RunHistorySection); reproduce-with-changes (explicit re-materialization of query sets) 🔲 pending.
- **3.5** Auto-derive output bindings (planned experiment): currently, `WorkflowAttachment.output_bindings` must have slot names hand-matched to `Nexus8Output` node `slot` input values in the graph — there is no validation and no UI surface showing the mapping. The graph scanner already extracts Output nodes (with slot names) into `graph_interface.nodes`; the experiment is to auto-generate bindings at attach time from those nodes (defaulting to `new_version_of_self` for `iterate` mode) and expose a two-section attach wizard: (1) pick a Control Surface View for parameter exposure (existing), (2) map each discovered output slot to a destination (new). This is the output-side analogue of the view precedence rule: views own input parameters, output bindings own delivery destinations. Key question: does auto-derive produce correct defaults across real production workflows with multiple output slots, or do edge cases (e.g. depth-only slots, discard targets) require manual override frequently enough to make the default misleading? 🔲 pending.
- **Exit criteria:** the round-3 UI journey runs real: drag-bound overrides land in a real intent, NG cooks with injected values, result appears as the declared new version with full `reproduction_manifest()`; replaying a cloned intent after adding new library assets reproduces the original input set exactly (U1's acid test).
- **Milestone: end of Phase 3 = the incumbent approach is fully replaced.**

## Phase 4 — Pins, intermediates, fan-out execution (NG + N8, ~2 wk) — tests U4

- **4.1** Pin fulfillment: armed pins persist port values (latents → safetensors + metadata) as **run-scoped artifacts** attached to the intent's batch container.
- **4.2** "Use as input" (artifact satisfies latent-typed asset nodes) and "Promote to asset" (provenance chain preserved) — J9.
- **4.3** Fan-out execution at scale: N sibling intents, shared context resolved once, pins default off for batches; batch progress UI (extends `FanOutPlanModal`, which also needs the round-3 non-blocking treatment for drag support).
- **Exit criteria:** batch of 8 runs with pins off costs no intermediate storage; single debug run with pins on yields reusable/promotable latents.

## Phase 5 — ComfyUI (NG, later; ~3–4 wk when scheduled) — tests H4's second half

- **5.1** Wrapped-workflow node hosting a ComfyUI prompt graph inside NG (per the layered decision: no parallel direct adapter).
- **5.2** `Nexus8Output`/`Nexus8Pin` custom comfy nodes implementing the identical slot contract; input injection by prompt-graph rewriting at wrap boundary (this is the open experiment for U3-on-ComfyUI; expect iteration).
- **Exit criteria:** one workflow embedding a ComfyUI graph runs from the same intent format with the same provenance guarantees.

## Cross-cutting

- **Risk — injection insufficiency (3.1):** highest technical risk; scheduled earliest possible after prerequisites; fallback is a dedicated intent-value store consulted by asset-node eval (still no engine-semantics change).
- **Risk — query performance at library scale (1.2):** materialization must be interactive (<1s); pgvector/index work if criteria queries are slow; measure in Phase 1.
- **Access control:** URI driver is the enforcement point (reads); intent creation checks run permissions (see `ACCESS_CONTROL_PLAN.md` for the wider model).
- **Out of scope this claim period:** ComfyUI phase 5 unless reached; video-specific generative workflows; farm scheduling.

## Indicative timeline

| Phase | Duration | Cumulative |
|---|---|---|
| 0 — Contract freeze | 1 wk | wk 1 |
| 1 — Intent backend | 2–3 wk | wk 4 |
| 2 — Asset nodes + dev mode | 2–3 wk | wk 7 |
| 3 — Execution integration | 2–3 wk | wk 10 |
| 4 — Pins + fan-out | 2 wk | wk 12 |
| 5 — ComfyUI | 3–4 wk | when scheduled |

Phases 1 and 2 can overlap once the Phase 0 contract is frozen (different codebases, shared schema).
