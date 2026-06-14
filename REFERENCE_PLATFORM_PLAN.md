# Reference Intelligence Platform — React Application Plan

**Working name:** Nexus Reference (frontend codename: `refnet`)
**Backend:** nexus8 (Django 5.2 + DRF + PostgreSQL/pgvector) — this repo
**Design language:** inherited from `~/development/toodles/nodegraph/web`

---

## 1. Product framing

Not a file manager. A **Reference Intelligence Platform** whose core loop is:

```
Find Reference → Refine Search → Build Reference Set → Create Board
→ Generate Content → Save Results → Reuse Later
```

Every screen serves that loop. Search is navigation; images are the UI; the
Reference Basket is the connective tissue between discovery and creation.

---

## 2. Tech stack

Inherit the toodles stack wholesale so the two apps share a visual and
architectural dialect, with two deliberate substitutions (TanStack Query,
TanStack Virtual) where this app's needs differ.

| Concern | Choice | Notes |
|---|---|---|
| Framework | React 19 + TypeScript, Vite 8 | identical to nodegraph/web |
| UI library | Mantine v9 (+ Radix primitives) | `primaryColor: 'teal'`, `defaultRadius: 'md'` |
| Styling | Tailwind CSS 4 + CSS custom-property tokens | copy `globals.css` token system |
| Theme | next-themes, dark-first | `forceColorScheme="dark"` initially |
| Routing | wouter | lightweight, same as toodles |
| Server state | **TanStack Query v5** | infinite queries, optimistic mutations, cache — essential for grids/search (toodles uses raw axios; this app needs the cache layer) |
| Client state | zustand (persisted) | basket, selection, board UI state, search draft |
| HTTP | axios via `httpService.ts` pattern | copy auth-retry/token-rotation wrapper from toodles |
| Graphs (entity graph, version trees) | @xyflow/react v12 + dagre | already proven in toodles |
| Boards (infinite canvas) | **tldraw SDK** (fallback: react-konva) | PureRef-grade free transform/zoom/group; xyflow is wrong tool for freeform image boards |
| Grid virtualization | **@tanstack/react-virtual** + custom masonry | justified-rows or masonry layout, 100k+ items |
| Drag & drop | @hello-pangea/dnd (lists) + native HTML5 DnD (grid→basket/board) | toodles already uses pangea |
| Icons | @tabler/icons-react (16–20px, 1.75 stroke) | copy `icons.tsx` wrapper |
| Forms/validation | @mantine/form + zod | toodles pattern |
| Realtime | socket.io-client (later phase) | Django Channels on backend; poll until then |
| Images | blurhash/thumbhash placeholders, `<img srcset>` thumbnail pyramid | |

### Design tokens (copied from nodegraph/web `globals.css`)

```css
--background: #020617;            /* navy-black */
--foreground: #e2e8f0;
--primary: #5eead4;               /* teal accent */
--card: rgba(15, 23, 42, 0.88);
--border: rgba(148, 163, 184, 0.14);
--muted-foreground: #94a3b8;
--ring: rgba(94, 234, 212, 0.4);
--radius-lg: 0.82rem; --radius-md: 0.65rem; --radius-sm: 0.35rem;
font-family: Inter, ui-sans-serif, system-ui;
accent gradient: linear-gradient(120deg, #5eead4, #38bdf8, #a78bfa);
```

Visual character: dark, spacious, semi-transparent slate cards, subtle teal
glow on focus/selection, radial gradient ambience. Images sit on near-black so
color reads true — the same reason PureRef and frame.io default dark.

---

## 3. Mapping product concepts → nexus8 data model

This is the key insight: nexus8's single-table-inheritance `VersionedEntity`
(discriminated by `entity_type`, flexible `type_data` JSON, pgvector
`semantic_embedding`) means most product concepts are **new entity types, not
new tables**.

| Product concept | nexus8 representation |
|---|---|
| Asset (image/video/3D) | `MediaAsset` proxy (`entity_type="media_asset"`); file refs + EXIF/gen-params in `type_data`; `semantic_embedding` (1536-d, HNSW) |
| Folder/Collection | `Container` proxy — materialized path + recursive CTE hierarchy already built |
| **Smart Collection** | new `entity_type="smart_collection"`; saved query (filters + semantic text) in `type_data.query`; evaluated server-side on read |
| **Board** | new `entity_type="board"`; canvas document (tldraw snapshot: item positions, scale, groups, annotations) lives in `Version.data` → **boards get versioning for free**, and `ContainerReference` pins exactly which asset versions were on the board |
| **Reference Basket** | zustand store persisted locally + per-user draft `entity_type="basket"` entity synced in background; "Save basket" promotes it to a Container or Board |
| Entity (Character/Costume/Location/Prop/Scene/Shot/Project) | `entity_type="entity"`, `type_data.category` = character/costume/…; each entity has its own thumbnail + embedding |
| Asset ↔ Entity relationship | **new model** `EntityRelation(asset FK, entity FK, role, confidence, source[ai|user])` — explicit FKs per nexus8 philosophy (no GenericFK); powers `character:wanda` queries and faceting |
| Version lineage (Original → Upscaled → Variant A/B) | `Version` + `VersionLink(from, to, role)` — already built, including `reproduction_manifest()` for AI generations |
| "Latest"/"Approved" pointers | `Symlink` + `SymlinkEvent` audit trail — already built |
| Generation provenance | `ModelCheckpoint` / `LoraAdapter` / `PromptTemplate` / `GenerationRecipe` proxies — already built |
| Comments / review / annotations | `discussions` app (Discussion, threaded Comment with reactions, Note) — already built |
| Workflow states | `Task` model + `Symlink` names as status pointers ("approved") — already built |

### Backend gap-closure work (new Django code)

1. **File ingest + thumbnail pyramid** — upload endpoint, S3/local storage,
   background worker (Celery + Redis) generating 5-level pyramid
   (thumbhash → 256 → 1024 → 2048 → original) + EXIF/gen-param extraction.
2. **AI analysis pipeline** — Celery task per asset: embedding (CLIP or
   provider API → `semantic_embedding`), auto-tags + description (vision
   model → `type_data`, `EntityRelation` suggestions), driven by the existing
   `ai_analysis_status` state machine. Users should rarely tag manually.
3. **Unified `/api/search/` endpoint** — one endpoint the search bar calls:
   - parses structured tokens (`character:wanda episode:4`) + free text
   - metadata/tag path: indexed JSONB + `EntityRelation` joins (<150 ms)
   - semantic path: pgvector cosine over HNSW (<500 ms)
   - hybrid ranking: reciprocal rank fusion of the two lists
   - returns `results[]` **and `facets{}`** (counts per character, costume,
     lighting, style, source, collection, date bucket) computed from the
     filtered set in the same round trip
4. **`/api/similar/{asset}/?mode=visual|character|costume|lighting|composition|style`**
   — v1: visual = raw embedding kNN; entity modes = kNN pre-filtered by shared
   `EntityRelation`; later: per-aspect embeddings.
5. **`EntityRelation` model + migration** (above).
6. **Board/basket/smart-collection entity types** — registration + thin
   serializers; CRUD already exists via `VersionedEntityViewSet`.
7. **Recommendations** — "frequently used together" from board/basket
   co-occurrence + embedding neighbors; nightly batch into `type_data`.
8. **Auth for SPA** — session or JWT endpoints matching the toodles
   `httpService` refresh pattern; CORS for the Vite dev origin.
9. *(Later)* Django Channels for live grid/board updates; poll until then.

---

## 4. Information architecture & routes

```
┌──────────────────────────────────────────────────────────────────┐
│  ⌘K  Universal search bar (persistent, top center)               │
├──────────┬───────────────────────────────────────┬───────────────┤
│ Nav rail │                                       │  Reference    │
│  Search  │      Virtualized masonry grid         │  Basket       │
│  Collect.│      (or board canvas / entity page)  │  (collapsible │
│  Boards  │                                       │   right rail, │
│  Entities│  ┌─ Facet bar (chips, live counts) ─┐ │   always      │
│  Recent  │  └───────────────────────────────────┘ │   reachable)  │
│  Favorite│                                       │               │
├──────────┴───────────────────────────────────────┴───────────────┤
│  Selection action bar (appears on select: Add to basket · Board  │
│  · Tag · Compare · Download)                                     │
└──────────────────────────────────────────────────────────────────┘
```

Routes (wouter):

| Route | View |
|---|---|
| `/` | Search home: search bar + recent searches + recommended/recent assets |
| `/search?q=…&f=…` | Results grid + facet bar (state fully URL-encoded → shareable) |
| `/asset/:id` | Asset detail **as overlay panel** over the grid (deep-linkable); full page on direct load |
| `/collections`, `/collections/:id` | Container tree (reuse `ProductionTreeSidebar` pattern) + grid |
| `/boards`, `/boards/:id` | Board gallery / infinite canvas |
| `/entities`, `/entities/:id` | Entity cards by category / entity hub page |
| `/recent`, `/favorites` | Grids |

Progressive complexity: default chrome is just Search / Collections / Boards.
Entity graph, version trees, tasks, and discussions live inside the asset
panel and entity pages as tabs — power users find them; beginners never see a
schema.

---

## 5. Core screens & components

### 5.1 Universal search (`<CommandSearch>`)
- Persistent bar + ⌘K palette. As the user types, structured tokens
  (`character:wanda`) render as **inline chips**; autocomplete suggests
  entities/tags/metadata keys after `:`.
- Plain text → hybrid semantic+keyword. Debounced 150 ms; results stream into
  the grid via TanStack Query `placeholderData: keepPreviousData` so the grid
  never blanks.
- Recent searches and saved searches (→ one click becomes a Smart Collection).

### 5.2 Results grid (`<AssetGrid>`)
- Justified-rows masonry, virtualized with @tanstack/react-virtual; cursor
  infinite scroll (`useInfiniteQuery`).
- Cards: thumbhash placeholder → 256px → 1024px on hover/zoom (browser
  `srcset`). Hover reveals quick actions: **＋ basket**, ♥, "Find similar",
  version badge (e.g. `v4 · latest`).
- Click → detail overlay. Shift/drag-rectangle multi-select → selection
  action bar. Drag selected thumbnails onto the basket rail or a board tab.
- Grid density slider (S/M/L/XL) in the toolbar.

### 5.3 Facet bar (`<FacetBar>`)
- Horizontal chip row above the grid (not an enterprise left-rail of
  checkboxes): `Character (12) ▾  Lighting ▾  Style ▾  Date ▾ …`
- Facets and counts come from the search response; clicking re-queries and
  facets recompute live. Active filters render as removable chips inline with
  the search bar.

### 5.4 Asset detail (`<AssetPanel>`)
- Slide-over panel (~480 px) over the grid; `←/→` walk results; `esc` closes.
- Hero preview with zoom/pan. Tabs:
  - **Info** — AI description, tags (click = search), metadata, generation
    recipe (prompt/model/LoRA via `reproduction_manifest`)
  - **Similar** — mode selector (Visual · Character · Costume · Lighting ·
    Composition · Style) → mini-grid
  - **Versions** — version tree (xyflow + dagre): lineage from `VersionLink`,
    symlink badges ("latest", "approved"); two-up compare with wipe slider
  - **Related** — entity chips (Character: Wanda · Costume: Battle-damaged…),
    boards/collections containing it, "frequently used together"
  - **Activity** — discussions/comments/tasks (discussions API)

### 5.5 Reference Basket (`<BasketRail>`) — the signature feature
- Collapsible right rail with thumbnail stack, grouped into **named slots**:
  Character / Costume / Lighting / Pose / Environment / Style (user can add
  custom slots).
- Add via hover ＋, drag, or `B` on focused card. Count badge always visible
  even collapsed. Persists across routes and reloads (zustand persist +
  background sync to a draft `basket` entity).
- Footer actions: **Create Board** (one click → board pre-populated with
  basket, auto-clustered by slot), **Save as Collection**, **Export**
  (zip / JSON manifest of exact pinned version IDs for generation pipelines),
  Clear.
- The slot structure is precisely what image-generation workflows consume
  (character ref + style ref + pose ref), so basket → generation handoff is a
  manifest, not a re-selection.

### 5.6 Boards (`<BoardCanvas>`) — PureRef-inspired
- tldraw infinite canvas: drag/scale/rotate images, snap-pack ("tidy"),
  groups with labels, text + arrow annotations, zoom-to-fit.
- Drop targets: drag in from any grid, the basket, or OS file drop (→ ingest).
- Right-click an image → Find Similar / Open detail / Replace with version….
- Canvas doc saves into `Version.data` (debounced autosave); **Snapshot**
  button publishes a new immutable board version with `ContainerReference`
  pins — boards become reproducible reference sets, and board history is a
  version timeline you can scrub.
- Live cursors/co-editing deferred to the realtime phase.

### 5.7 Entity hub (`/entities/:id`)
- Hero: entity thumbnail, AI summary, key tags.
- **All assets** grid (an implicit smart collection: `character:wanda`),
  facetable by expression/costume/lighting.
- **Relationship view**: xyflow mini-graph centered on the entity (Wanda —
  costumes, episodes, boards) rendered as navigable cards-with-edges; clicking
  a node navigates rather than exposing graph mechanics. Users never see the
  words "graph database".

### 5.8 Smart Collections
- "Save search as collection" from any results view. Edits via the same
  chip/facet UI (no query-builder forms). Auto-update on read; optional badge
  showing new-since-last-visit count.

### 5.9 Discovery
- Home shows: Continue (recent boards/baskets), Recommended (embedding
  neighbors of recent activity), New in your library (recent ingests),
  Frequently used together strips. Pinterest-style serendipity, computed by
  the recommendations batch job.

---

## 6. Interaction & accessibility

**Keyboard map:** `⌘K` search · `←→↑↓` grid navigation · `space` quick-look ·
`B` add to basket · `F` favorite · `S` find similar · `V` versions ·
`1-4` grid density · `esc` close panel.

- Single-click everything; context menus (Mantine `Menu`) on right-click;
  inline rename/edit; zero multi-step wizards; the only modals are
  create-name dialogs (copy toodles `NewProjectModal` pattern).
- Optimistic UI for favorite/tag/basket/move (TanStack Query `onMutate`
  rollback pattern).
- WCAG AA: full keyboard operability (roving tabindex grid), visible teal
  focus ring (`--ring`), `aria-live` result counts, alt text from AI
  descriptions, `prefers-reduced-motion` honored (no parallax/zoom
  animations), contrast-checked token pairs; tldraw canvas gets a parallel
  list view of board contents for screen readers.
- Responsive: desktop-first 3-pane; tablet collapses basket to a floating
  button + sheet; mobile = search + grid + bottom-sheet detail, boards
  read-only pan/zoom.

---

## 7. Performance plan

| Target | Mechanism |
|---|---|
| <150 ms metadata search | indexed JSONB/GIN + `EntityRelation` joins; debounce; TanStack Query cache; `keepPreviousData` |
| <500 ms semantic search | pgvector HNSW (already indexed); single round trip returns results+facets |
| 60 fps grid at 10M assets | virtualization (render ~60 DOM nodes), cursor pagination, fixed-height rows computed from aspect ratios in the search response |
| Instant-feeling images | thumbhash inline in API payload → paint before network; 5-level pyramid via `srcset`; `loading=lazy`; LQIP on boards |
| No blocking ops | all ingest/AI work in Celery; UI shows per-asset status from `ai_analysis_status`; optimistic mutations |
| Scale 100 → 10M | nothing architectural changes: same endpoints, cursor pagination, HNSW kNN is sub-linear, materialized paths keep tree ops flat |

---

## 8. Frontend repo structure

```
refnet/
├── src/
│   ├── main.tsx            # Mantine + next-themes (copy toodles setup)
│   ├── globals.css         # design tokens (copied, re-skinnable)
│   ├── app/routes.tsx      # wouter routes
│   ├── api/                # httpService.ts (from toodles), generated types
│   │   └── client/         # openapi-typescript from drf-spectacular schema
│   ├── features/
│   │   ├── search/         # CommandSearch, FacetBar, query-token parser
│   │   ├── grid/           # AssetGrid, AssetCard, masonry+virtual, selection
│   │   ├── asset/          # AssetPanel, VersionTree, SimilarGrid, compare
│   │   ├── basket/         # BasketRail, slots, store, export manifest
│   │   ├── boards/         # BoardCanvas (tldraw), BoardGallery, snapshot
│   │   ├── entities/       # EntityHub, EntityGraph (xyflow), entity cards
│   │   ├── collections/    # tree sidebar (toodles pattern), smart collections
│   │   └── activity/       # discussions/comments/tasks panels
│   ├── stores/             # zustand: basket, selection, ui prefs
│   ├── components/         # icons.tsx, LoadingState, shells (from toodles)
│   └── lib/                # query-string utils, keyboard map, thumbhash
└── vite.config.ts
```

API types are **generated** from nexus8's drf-spectacular schema
(`/api/schema/` → `openapi-typescript`), keeping front/back contracts honest.

---

## 9. Phased roadmap

**Phase 0 — Foundations (1–2 wks)**
Scaffold Vite app with toodles tokens/shell; auth + httpService; CORS/JWT on
nexus8; generated API types; file ingest + thumbnail pyramid worker.

**Phase 1 — Search & Grid (2–3 wks)** *first usable product*
`/api/search/` (metadata+tags+facets), virtualized masonry grid, facet chips,
asset detail panel (Info tab), favorites/recents. Embedding worker running in
background populating vectors.

**Phase 2 — Basket & Boards (2–3 wks)** *the differentiator*
BasketRail with slots + persistence; board entity type; tldraw canvas with
drag-in from grid/basket; one-click basket→board; board snapshots with pinned
references; export manifest.

**Phase 3 — Intelligence (2–3 wks)**
Semantic + hybrid search live; Find Similar modes; AI auto-tagging/descriptions
populating facets; `EntityRelation` + entity hubs + structured query chips;
smart collections.

**Phase 4 — Depth & polish (ongoing)**
Version trees + compare UI; entity relationship graph; recommendations/home
discovery; discussions/tasks tabs; realtime (Channels); mobile pass;
WCAG audit; 100k-asset load test.

Each phase ends shippable; the core loop (find → collect → board) is complete
at end of Phase 2 and gets smarter every phase after.

---

## 10. Anti-goals (enforced)

No dense tables as primary surfaces; no admin-form CRUD pages; no multi-step
wizards; no exposed "graph database" vocabulary; no settings-heavy taxonomy
managers (taxonomies emerge from AI tags + entity relations, edited inline);
no page reloads. If a feature needs a wizard to explain, redesign it.
