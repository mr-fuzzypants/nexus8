# Nexus Reference — web frontend

React SPA for the Reference Intelligence Platform, backed by the nexus8
Django API. **End-user documentation: [`../USER_GUIDE.md`](../USER_GUIDE.md).**
See `../REFERENCE_PLATFORM_PLAN.md` for the full product plan;
this implements **Phases 0–4** (search, faceted grid, asset panel, ingest,
reference basket, infinite-canvas boards, AI analysis, hybrid semantic
search, find-similar, entities, smart collections, version management,
review comments, recommendations).

All runtime dependencies are MIT-licensed (wouter is Unlicense/public-domain) —
safe for commercial distribution. The board canvas uses Konva/react-konva (MIT),
deliberately chosen over tldraw, whose license is not free for commercial use.

## Run

```bash
# 1. Backend (from ../nexus8, venv at ../.venv)
../.venv/bin/python manage.py runserver 8000

# 2. Frontend
npm install
npm run dev          # http://localhost:5173
```

Vite proxies `/trackables`, `/discussions` and `/media` to Django on :8000 —
same origin in dev, no CORS. Auth is bypassed in dev: Django authenticates
every request as a seeded `dev` user (`NEXUS8_DEV_OPEN=0` to disable).

## What's here

- **Search** (`/`) — debounced hybrid search: free text is ranked by
  reciprocal-rank fusion of keyword matches and pgvector cosine similarity
  (OpenAI `text-embedding-3-small`); tokens like `tag:hero type:image
  character:wanda` filter structurally (`character:` etc. join through
  `EntityRelation`). State fully in the URL. Requires `OPENAI_API_KEY` on the
  Django side for the semantic leg — degrades to keyword-only without it.
- **AI analysis** — GPT-4o vision generates tags + descriptions + embeddings
  per asset (`manage.py analyze_assets` to backfill; status shown per asset).
- **Facet chips** — live counts per tag / media type, recomputed per result set.
- **Grid** — justified-rows masonry, row-virtualized (@tanstack/react-virtual),
  infinite scroll, blur-up placeholders + 256/1024 WEBP `srcset` pyramid.
- **Asset panel** — slide-over detail: preview, tags (click → filter),
  metadata, favorite, AI analysis status.
- **Ingest** — "Add images" button or drop files anywhere;
  `POST /trackables/api/library/upload/` content-addresses by sha256
  (re-uploads dedupe), builds the thumbnail pyramid, publishes version 1.
- **Reference basket** — persistent right rail with named slots
  (Character/Costume/Lighting/Pose/Environment/Style). Collect from any grid
  card or the asset panel; footer actions: **Create board** (one click,
  pre-clustered by slot), **Save as collection** (Container + published
  version), **Export manifest** (JSON hand-off for generation pipelines).
- **Boards** (`/boards`, `/boards/:id`) — PureRef-style infinite canvas
  (Konva): wheel zoom-to-pointer, pan, drag/resize/rotate via transformer,
  shift multi-select, Delete to remove, Tidy (justified re-pack), zoom-to-fit,
  1s debounced autosave, and **Snapshot** publishing an immutable board
  Version (boards are `entity_type="board"`; the canvas doc lives in
  `type_data.canvas`, snapshots in `Version.data`).
- **Asset panel intelligence** — *Similar* (Visual = embedding kNN, Tags =
  overlap) and *Related entities* (link/unlink characters, costumes,
  locations… which power `role:name` search tokens and entity facet chips).
- **Entities** (`/entities`, `/entities/:id`) — entity cards by category and
  per-entity hubs showing all related assets.
- **Collections** (`/collections`) — smart collections: “Save search” stores
  the query; opening one re-runs it live.
- **Versions** — upload a new version of any asset from its panel (content-
  addressed, moves the `latest` symlink, repoints the grid rendition,
  re-queues AI analysis); visual version timeline with symlink badges and a
  **two-up wipe-compare slider**; lineage edges (`VersionLink`) shown as
  “Derived from / Used by”.
- **Activity** — review comments per asset (discussions app); first comment
  auto-creates a review discussion.
- **Home discovery** — “Based on your recent activity” strip: embedding-
  centroid neighbors of your recently viewed assets.
- **Recent / Favorites** — client-side (zustand persist).

## Stack

React 19 + TypeScript + Vite, Mantine 9 (teal/dark theme tokens ported from
toodles/nodegraph), wouter, TanStack Query + Virtual, zustand, axios,
Tabler icons. Design tokens live in `src/globals.css`.

Keyboard: `/` focuses search, `Esc` closes the panel, `Enter`/`Space` opens
a focused card.
