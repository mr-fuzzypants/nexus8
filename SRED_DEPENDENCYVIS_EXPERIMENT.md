# SR&ED Project Documentation & Technical Plan
# Unified Relationship Graph — Multi-Store Dependency Visualization Experiment

**Project codename:** nexus8 relations graph — unified dependency/attachment/provenance visualization
**Claim period:** FY2026 (work commenced July 2026, ongoing)
**Systems involved:** nexus8 Django backend (trackables app), nexus8 SPA (React, @xyflow/react + dagre graph view), PostgreSQL (recursive CTEs, FK-indexed edge tables)
**Prepared:** July 2026 — living document; update as experimental work proceeds

---

# Part A — SR&ED Narrative

## A1. Project objective

Develop a single navigable graph view over **all** relationship stores in the nexus8 asset platform, so an artist can start from any asset and traverse every relationship it participates in — compositional dependencies, mask/render attachments, and generative provenance — regardless of which underlying store records the relationship, and regardless of the context in which the relationship was created.

The platform records relationships in three structurally different stores, each with correct-but-different semantics:

1. **`DependencyLink`** — version→version compositional edges ("model v3 *uses* texture v7"), typed (`uses`, `depends_on`, `imports`, `references`, `extends`) with a free-text `role` context. Visualized today by the existing dependency graph (`/graph/:versionId`, recursive-CTE transitive closure, progressive hop expansion).
2. **`EntityRelation`** — entity→entity descriptive/attachment edges ("this asset *has mask* X scoped to layer L", "this asset *depicts character* Y"), with `role`, `confidence`, `source` (user/AI), and JSONB `type_data` context (e.g. `layer_id`).
3. **`VersionLink`** — version→version generative lineage ("render v4.1 was *generated from* source v2 with *sketch guide* mask v3"), with RESTRICT-protected upstream inputs. Plus **`Symlink`** — named mutable pointers (`selected`, `latest`) that identify the *chosen* member of a candidate set.

No existing production asset-management system (ShotGrid, ftrack, Prism) presents a unified interactive traversal over heterogeneous relationship stores of mixed granularity; each visualizes a single homogeneous edge type (task dependencies or version lineage, never both with attachments).

## A2. Technological uncertainties

### U1 — Mixed granularity: composing version-scoped and entity-scoped edges in one graph

`DependencyLink` and `VersionLink` connect **versions**; `EntityRelation` connects **entities** (with only advisory version snapshots). A graph rooted at version v3 of an asset therefore contains edges that belong to v3 specifically and edges that belong to the asset as a whole, for every version. It was unknown how to represent both in one node/edge model without either (a) falsely implying an entity-level attachment is version-specific, or (b) fragmenting the display into disconnected per-store subgraphs that defeat the purpose of unification. Candidate schemes: dual node types (version nodes + entity nodes) with a `scope` flag on edges; promoting entity edges to a synthetic "all versions" lane node; or duplicating entity edges onto every version node.

### U2 — Edge taxonomy for many-context relationships

The same pair of objects can be related several times in different contexts: a mask asset attached to a source in two different annotation layers (two `EntityRelation` rows differing only in `type_data.layer_id`); a version both *depending on* and *derived from* another. It was unknown whether a flat unified edge payload — `{kind, role, context}` — can represent all three stores' semantics losslessly, and whether the rendering layer (xyflow parallel edges with labels) remains legible when several same-pair edges with different contexts coexist.

### U3 — Index-served hop composition across three stores

The existing dependency graph achieves interactive expansion by fetching one hop per click, each hop a small FK-indexed query. A unified hop must consult up to four tables (`DependencyLink` twice for direction, `VersionLink` twice, `EntityRelation` twice, `Symlink` once) *and* compute a per-neighbor "expand +N" affordance count spanning the same stores. Per SRED finding F12 (inpaint experiment), JSONB `type_data` paths must never be query entry points. It was unknown whether the full hop — edges plus neighbor counts — can be held to a bounded number of index-served queries (target ≤10 per hop) independent of graph size.

### U4 — Artist legibility of a semantically mixed graph

Compositional "uses", descriptive "is attached to", and generative "was made from" are different mental models. It was unknown whether artists can navigate a single canvas mixing all three — with kind filters and distinct visual encodings — or whether the mixture reads as noise, forcing a retreat to separate per-store views. (Prior design discussion settled on separate-but-linked views as the starting point: the existing dependency graph remains, a new relations view is added, and each links to the other; this experiment tests whether the unified view is legible enough to carry the mask/render use case.)

### U5 — Direction semantics for non-dependency edges

"Downstream/upstream" is well-defined for `DependencyLink` (uses / used-by) and mappable for `VersionLink` (derived-from ≈ uses). For attachments it is ambiguous: is a mask downstream of its source asset (the asset "has" it) or upstream (the mask "describes" it)? It was unknown whether attachments should participate in the direction filter at all, or be direction-agnostic and controlled only by the kind filter.

## A3. Hypotheses

- **H1 (dual node scheme):** Prefixed node ids — `v{id}` for version nodes, `e{id}` for entity nodes — with a `scope: version|entity` flag on every edge represent the mixed granularity honestly with **zero schema changes**: entity-scoped edges attach to the node being expanded but are visually flagged, and entity nodes are visually distinct (dashed border) from version nodes.
- **H2 (unified edge payload):** `{kind: dependency|relation|lineage|pointer, role, context}` covers all four stores; multi-context same-pair edges render legibly as xyflow parallel edges labeled `role · context-abbreviation` (e.g. `mask · 3f2a91c4`).
- **H3 (bounded hop cost):** One unified hop = ≤10 index-served queries (edge fetches on existing FK indexes `(source_version)`, `(target_version)`, `(from_version, role)`, `(to_version, role)`, `(asset, role)`, `(entity, role)`, `(entity_id, name)`, plus grouped `COUNT` aggregates over the returned id set for the +N affordance), independent of total graph size.
- **H4 (legibility via encoding + default pruning):** Kind-filter chips plus per-kind stroke encoding (solid dependency / dotted attachment / dashed lineage / dotted-green pointer) keep the mixed canvas legible; and for the mask/render case, exposing only the `selected` symlink pointer by default (not the full run×variation grid, which stays in the render history panel) bounds the per-layer node cost to ~3 nodes.
- **H5 (direction-agnostic attachments):** Attachment edges should ignore the direction filter (always shown, gated only by the kind filter); the direction control governs dependency and lineage edges only.

## A4. Work performed (systematic investigation to date, July 2026)

**Conceptual design phase (July 30–31 2026).** The three relationship stores were analyzed for unification feasibility. Established: (a) mask/render relationships are *not* representable in `DependencyLink` — they live in `EntityRelation` (structural, entity-scoped, layer-context in JSONB) and `VersionLink` (generative, version-scoped) by design, and duplicating them into `DependencyLink` would create a synchronization liability with no benefit; (b) the granularity mismatch (U1) is the central obstacle — the existing graph's assumption that every node is a version does not survive contact with `EntityRelation`; (c) the existing progressive-hop architecture (react-query cached hops, client BFS over expanded set, dagre layout, >8-sibling aggregation) is reusable if node ids become opaque prefixed strings; (d) the F12 entry-point rule constrains the backend: layer contexts may be *reported* from `type_data` but hops must *enter* through the FK-indexed relation edges. The separate-but-linked view architecture and the selected-render-only default were fixed by design discussion before implementation.

**Implementation iteration 1 (July 31 2026).** First working version of the unified view, built to test H1–H5 in practice:

- *Backend*: `views_relations_graph.py` — `GET /trackables/api/relations-graph/?node=v{id}|e{id}&direction=…` returning one hop of unified `{nodes, edges}`. Version-node hops consult `DependencyLink` (direction-aware), `VersionLink` (downstream = inputs it was generated from; upstream = outputs derived from it), and `EntityRelation` on the version's entity (direction-agnostic per H5). Entity-node hops consult `EntityRelation` both ways plus `Symlink` pointers to version nodes. Neighbor `child_count` computed via grouped COUNT aggregates over the hop's id set (H3).
- *Frontend*: `RelationsGraph.tsx` — adapted from `DependencyGraph.tsx`, preserving the hop cache / BFS / dagre / aggregation machinery; adds kind-filter chips, per-kind edge encoding, dashed entity nodes, layer-context edge labels. Route `/relations/:nodeId`; cross-navigation buttons between the dependency and relations views in both toolbars.

**Implementation iteration 2 (July 31 2026) — curated aggregation pass.** Driven by F1 (below): the endpoint gained a `view=curated` mode (now the default; `view=raw` preserves the exhaustive hop behind a toggle) that aggregates store-level edges to artist concepts before they leave the server — synthetic per-layer group nodes, per-asset collapsing of derived outputs, selected-render resolution, and a blocklist for legacy plumbing roles.

**Implementation iteration 3 (August 1 2026) — hop query-plan optimization.** The curated hop was profiled (CaptureQueriesContext + 20-request wall clock on the 14-layer test asset) and restructured to a fixed three-phase plan — fetch raw rows per store/direction, batch-resolve symlinks/stats/thumbs over the collected id sets, emit in pure Python — validating H3's bounded-cost claim in its stronger form: query count bounded by *store count*, not edge count. Changes: the seven grouped `child_count` COUNTs → one UNION ALL (all branches index-served); four per-role `EntityRelation` reads → two (one per direction, partitioned in memory); two `selected`-symlink resolutions → one batch; the render run-count aggregate, derived-latest resolution, and entity-thumbnail `DISTINCT ON` pass → one `DISTINCT ON` + window-COUNT query (run count recovered as the newest `version_number`, valid by `store_run_results`' sequential run allocation). A psycopg3 porting note: raw `IN %s` tuple adaptation is gone; `= ANY(%s)` with a list is the portable form.

**Experimental findings (July–August 2026).**

- **F3 — the profiler cost more than the endpoint; instrumentation overhead dominates dev latency (August 1 2026).** Profiling isolated three cost tiers for one curated hop: the endpoint's own ~21 queries ≈ 12 ms of SQL; django-silk's middleware ≈ 35 bookkeeping queries per intercepted request (its `silk_sqlquery` INSERT alone, 13 ms, exceeded the entire app workload) plus cursor-wrapper double-recording of every query; total 158 ms wall clock. After excluding the endpoint from silk (`SILKY_INTERCEPT_FUNC`) and applying the iteration-3 query plan: **11 queries (17 ms SQL), 55 ms wall clock** for the 14-layer hop; 8 queries for a render-version hop; response payloads byte-equivalent before/after. Two generalizable rules adopted: (a) always separate instrumentation cost from app cost before optimizing — the first profile's numbers were ~2× wrong in query count and ~3× in latency; (b) per-store round trips, not per-row work, dominate an index-served hop — the win came entirely from query *consolidation* (UNION ALL, batched `ANY(%s)` sets, window functions), not from touching fewer rows.

- **F1 — store-level unification is complete but artist-illegible; H4 partially refuted (July 31 2026).** First live use on a real annotated asset (14 mask layers, 4 render layers, 38 render candidates) returned 69 edges for a single version hop. Three distinct causes were isolated: (a) *per-variation lineage fan-out* — every render candidate vN.M carries its own `init_image` edge, so one render asset appears as 38 provenance edges when the artist-relevant fact is "this image has renders"; (b) *invisible layer structure* — masks and render assets share a `layer_id` context but render as flat siblings, flattening the hierarchy artists actually think in (image → layer → mask/render); (c) *plumbing leakage* — legacy interim-storage roles (`inpaint_preview`, `sketch_inpaint_preview`, `scribble_preview`; see inpaint F11) and `latest` pointers surface as discovery-grade information. Kind filters and per-kind stroke encoding (H4's mechanism) do not restore legibility — they gate whole stores, while the noise is *within* stores. Consequence: legibility requires **semantic aggregation to artist concepts** (inputs / layers / outputs) server-side, not client-side visual encoding of raw edges. The raw view is retained behind a toggle as the debugging surface.
- **F2 — layer identity is split across a legacy and a current convention (July 31 2026).** Grouping by layer exposed that mask relations created before the `layer_id`-on-relation convention carry the layer key only on the mask *asset's* legacy `type_data.mask_layer_id` field (inpaint F5's data path), while newer relations carry `type_data.layer_id` on the relation edge. The curated pass reads both (relation first, asset fallback) — as *context on rows already fetched via FK-indexed edges*, preserving the F12 entry-point rule. Layer display names are not stored anywhere queryable; they are recovered by stripping the source-asset prefix from the mask asset's name (`"{source}-{layer}"` naming convention from MaskSaveView).

## A5. Technological advancement sought

- A **unified traversal model over heterogeneous relationship stores of mixed granularity** (version-scoped typed dependencies, entity-scoped contextual attachments, version-scoped generative lineage, mutable named pointers) presented as a single interactive graph — advancing beyond the single-edge-type graphs that are standard in production asset management.
- An **index-served hop-composition query pattern** that bounds the cost of expanding one node across N edge stores to a constant number of FK-indexed queries plus grouped aggregates, honoring the platform's no-JSONB-entry-point rule (F12).
- Experimental determination of whether **semantically mixed graphs are artist-legible** under kind filtering and per-kind visual encoding, or whether unification must yield to federated per-store views.

## A6. Personnel & records

| Role | Work |
|---|---|
| R. Pringle (developer/architect) | All design, conceptual analysis, experimental verification |

Supporting evidence: git history in `nexus8` repository; design discussion records; this document.

> **Record-keeping practice:** commit experiment notes with the work — which hop shapes were slow, which visual encodings confused, whether the scope flag was understood. Keep rejected designs in history. Date all design decisions in this document.

---

# Part B — Technical Plan

**N8** = nexus8 Django backend. **SPA** = nexus8 React frontend.

## Phase 1 — Unified hop endpoint (N8) — tests H1, H3, H5

- **1.1** `views_relations_graph.py`: `RelationsGraphView` at `GET /trackables/api/relations-graph/?node=<v{id}|e{id}>&direction=downstream|upstream|both`.
- **1.2** Version-node hop: `DependencyLink` edges (direction-aware, kind=`dependency`, scope=`version`); `VersionLink` edges (downstream → `to_version=id` rows yield input targets; upstream → `from_version=id` rows yield derived sources; kind=`lineage`, scope=`version`); `EntityRelation` edges on the version's entity, both directions, always included (H5; kind=`relation`, scope=`entity`, context from `confidence`, `source`, `type_data.layer_id`).
- **1.3** Entity-node hop: `EntityRelation` both directions (entity↔entity edges); `Symlink` rows → `pointer` edges to version nodes (role = symlink name).
- **1.4** `child_count` per returned node via grouped COUNT over the hop's version-id and entity-id sets — one aggregate query per (store, direction) pair, ≤7 total.
- **1.5** Edge convention: `source uses/derives-from/attaches target` — lineage edges point derived→input so "downstream" uniformly means "what this is made of".
- **Exit criteria:** curl a source asset's version → hop returns dependency + attachment edges; expanding a render-asset entity node returns its `selected` pointer; expanding the selected render version returns `init_image`/`sketch_guide` lineage edges; every query index-served (H3 verified via `EXPLAIN` if in doubt).

## Phase 2 — Relations graph view (SPA) — tests H2, H4

- **2.1** `api/relationsGraph.ts`: types + `getRelationsHop(nodeId, direction)`.
- **2.2** `RelationsGraph.tsx`: adapted hop/BFS/dagre/aggregation machinery from `DependencyGraph.tsx` with opaque prefixed node ids; kind-filter chips (Dependencies / Attachments / Provenance / Pointers); per-kind stroke encoding; dashed-border entity nodes; `role · layer-id` edge labels for layer-scoped attachments.
- **2.3** `RelationsGraphPage.tsx` at route `/relations/:nodeId`.
- **Exit criteria:** rooted at an annotated asset's version, the view shows its masks and render assets as attachment edges to entity nodes; expanding reveals selected renders and their lineage back to the source version and guide mask; filter chips isolate each kind.

## Phase 3 — Cross-navigation (SPA) — supports U4

- **3.1** Dependency graph toolbar → "Relations" button (`/relations/v{versionId}`); relations graph toolbar → "Dependencies" button (`/graph/{versionId}` when the root is a version node). Double-click navigation to entity pages preserved in both.
- **Exit criteria:** round-trip between the two views from the same root in two clicks.

## Phase 4 — Experiment assessment

- Record hop query counts and latencies on seeded data (including `seed_stress_dependency_graph`).
- Live-use assessment of H4 (legibility) on a real annotated asset with multiple mask layers and render runs; record confusions verbatim.
- Decide: promote unification (fold the dependency view into the relations view as a filter preset), keep federated views, or revise the node scheme (U1 alternatives).
- Update this document with findings.

## Cross-cutting

- **Out of scope this iteration:** run×variation grid aggregation inside the graph (stays in the render history panel); transitive closure for relation/lineage edges (hop-by-hop only); creating/editing links from the graph; annotator entry point (render-history-panel link) — candidate for iteration 2.
- **Risk — U4:** if the mixed canvas is illegible, the fallback is kind-exclusive presets (the chips become radio tabs), preserving the unified backend.
