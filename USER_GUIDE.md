# Nexus Reference — User Guide

Nexus Reference is a reference intelligence platform for creative work: AI
image generation, film, animation, game development, storyboarding, and
concept art. You don't browse folders here — you **search, collect, and
build**. The core loop:

```
Find references → Refine → Collect into the Basket → Create a Board
→ Use in your work → Save results back → Reuse later
```

---

## 1. Getting in

Start both servers (see `web/README.md` for setup details):

```bash
# backend, from nexus8/
../.venv/bin/python manage.py runserver 8000

# frontend, from web/
npm run dev
```

Open **http://localhost:5173**. In development there's no login — you're
automatically signed in as the `dev` user.

The window has three zones:

| Zone | What it is |
|---|---|
| **Left rail** | Navigation: Search, Collections, Boards, Entities, Recent, Favorites |
| **Center** | The current page — usually the image grid |
| **Right rail** | Your **Reference Basket** (collapsible; the `›` chevron tucks it away) |

---

## 2. Adding images

Two ways, from anywhere in the app:

- **Drag and drop** image files onto the window.
- Click **Add images** in the search toolbar and pick files.

What happens on upload:

- Files are de-duplicated by content — re-uploading the same image never
  creates a copy, you just get the existing asset back.
- Thumbnails are generated automatically; the grid shows a blurred
  placeholder instantly and sharpens as renditions load.
- The asset is queued for **AI analysis** (see §8).

---

## 3. Searching

The search bar at the top is the main way you move around. Press **`/`**
anywhere to focus it.

### Free text (semantic)

Type what you're imagining, not a filename:

> `dark night scene with cool blue tones`
> `warm glowing abstract circles`

Results are ranked by a blend of keyword matching and **semantic similarity**
— the AI understands the *content* of your images, so assets match even when
no tag or name contains your words.

> Want to know exactly how ranking works, why a query returns broad results, or
> how to tune it? See [SEARCH.md](SEARCH.md).

### Structured tokens

Mix precise filters into the same query:

| Token | Meaning |
|---|---|
| `tag:battle` | has this tag (yours or AI-suggested) |
| `type:image` | media type |
| `status:completed` | AI-analysis state |
| `character:wanda` | related to the entity Wanda as a character |
| `location:forest` | related to the entity Forest as a location |

Tokens combine with free text and with each other (all must match):

> `character:wanda tag:battle close up, dramatic rim light`

Use quotes for multi-word values: `character:"scarlet witch"`.

### Facet chips

Under the search bar, chips show what's *in your current results* with live
counts — entities first (e.g. `character: Wanda 3`), then media types and
tags. **Click a chip to filter; click again to remove.** Counts recompute
against the filtered set, so you can keep narrowing.

Every search is fully encoded in the URL — copy the address bar to share the
exact view, or bookmark it.

### Saving a search

When a search or filter is active, a **Save search** button appears. Name it
and it becomes a **Smart Collection** (see §7).

---

## 4. The grid and the asset panel

The grid is a justified photo wall — images keep their aspect ratio. Use the
**S / M / L** control to change density. Scroll forever; results stream in.

**Hover any image** for quick actions:

- 🛍 **bag** — add to / remove from the Reference Basket
- ♥ **heart** — favorite

**Click an image** to open the asset panel (slide-over on the right). Press
**`Esc`** to close it. Inside the panel:

- **Preview** with the AI-analyzed badge and a link to the original file.
- **AI description and tags** — click any tag to turn it into a search filter.
- **Related entities** — chips like `character: Wanda`. Click a chip to visit
  that entity's hub; `✕` unlinks it. Hit **+** to link the asset to an
  existing entity (pick from a searchable list).
- **Similar** — visually similar assets, with a toggle:
  - **Visual** — true AI similarity (embeddings)
  - **Tags** — overlap of tags
  Click any thumbnail to jump to that asset.
- **Versions** — see §6.
- **Activity** — see §6.
- **Metadata** — code, type, dimensions, date added.

---

## 5. The Reference Basket → Boards

This is the heart of the app: a shopping cart for references.

### Collecting

Tap the 🛍 bag on any image (grid or panel). The basket rail lights up with a
count. Items land in the **Unsorted** slot; use the `⋯` menu on any basket
item to move it into a named slot:

> **Character · Costume · Lighting · Pose · Environment · Style**

Slots matter: they describe *what each reference is for*, which is exactly
how image-generation workflows consume reference sets.

### Basket actions (footer of the rail)

| Button | What it does |
|---|---|
| **Create board** | One click → a new board with your items already laid out in columns, one column per slot. You land directly in the board editor. |
| **Save as collection** | Stores the basket as a permanent collection in the backend (with the exact asset versions recorded). |
| **Export manifest** | Downloads a JSON file organized by slot — hand it to a generation pipeline or teammate. |
| **Clear** | Empties the basket. |

The basket survives reloads and follows you across every page.

### Boards (infinite canvas)

**Boards** in the left rail lists your boards as cards; **New board** starts
a blank one. Inside the editor:

| Action | How |
|---|---|
| Pan | drag empty canvas |
| Zoom | mouse wheel (zooms toward the cursor) |
| Move an image | drag it |
| Resize / rotate | click to select, then use the teal handles |
| Multi-select | shift-click |
| Delete selected | `Delete` / `Backspace` |
| Add basket items | **Add basket (n)** button — drops them to the right of existing content |
| Auto-arrange | **Tidy** (grid icon) — packs everything into clean rows |
| Fit to view | zoom-scan icon |
| Rename | click the title and type |

Your board **autosaves** about a second after every change ("Saved" shows in
the toolbar). When the board reaches a state worth keeping, press
**Snapshot** — this publishes an immutable version (the `v1`, `v2`… badge).
Snapshots are permanent history; keep working freely afterwards.

---

## 6. Versions and review

### Version history

Creative assets evolve — upscales, retouches, generated variants. In the
asset panel's **Versions** section:

- The list shows every version, newest first, with a `latest` badge on the
  current one and who/when it was made.
- **Upload icon** — add a new version of *this* asset (instead of creating a
  separate asset). The grid and boards immediately show the new rendition,
  and the AI re-analyzes it.
- **Compare** — toggle it, select any two versions, then **drag the slider**
  across the two-up preview to wipe between them. Perfect for "did the
  retouch help?" checks.
- If a version was derived from (or used by) another asset — e.g. an AI
  generation traced to its inputs — that lineage is listed under the
  versions.

### Comments

The **Activity** section is a lightweight review thread per asset. Type a
comment and press Enter (or the send icon). The first comment automatically
opens a review discussion; everyone's notes accumulate with names and
timestamps.

---

## 7. Organizing: entities, smart collections, favorites

### Entities

Entities are the *things in your world*: characters, costumes, locations,
props, scenes, styles. They power structured search (`character:wanda`) and
give every character/location its own gallery.

- **Entities** page → filter chips by category → **New entity** to create one.
- Link assets to entities from the asset panel (**Related entities → +**).
  The AI also suggests links from its tags.
- Click an entity card to open its **hub**: every related asset in one grid.

You never have to think about how this is stored — just link things and
search them.

### Smart Collections

A smart collection is a **saved search that stays fresh**. Save one from the
search toolbar; find them on the **Collections** page. Opening one re-runs
the query live — new uploads that match appear automatically. Delete with the
trash icon.

### Recent & Favorites

- **Recent** — every asset you've opened, newest first.
- **Favorites** — everything you've ♥'d.

Both are personal and live on your machine.

### Home recommendations

When you visit Search with no active query, a **"Based on your recent
activity"** strip appears — AI-picked neighbors of what you've been looking
at. A quiet way to rediscover assets you forgot you had.

---

## 8. AI analysis

Every uploaded image is queued for analysis (`pending` badge in the asset
panel). Analysis produces:

- a written **description** of the image,
- **suggested tags** (these feed the facet chips),
- a **semantic embedding** (this powers free-text search, Find Similar, and
  recommendations).

Run the analyzer over anything pending:

```bash
# from nexus8/
../.venv/bin/python manage.py analyze_assets
```

Useful flags: `--all --force-reanalysis` (redo everything),
`--asset-ids 12,15` (specific assets), `--dry-run` (preview). Analysis
requires `OPENAI_API_KEY` in the backend environment; without it, everything
still works except semantic search, Visual similarity, and recommendations
(they fall back to keyword/tag behavior).

---

## 9. Keyboard reference

| Key | Action |
|---|---|
| `/` | focus the search bar |
| `Esc` | close the asset panel / deselect on a board |
| `Enter` / `Space` | open the focused grid card |
| `Shift`+click | multi-select on a board |
| `Delete` / `Backspace` | remove selected board items |
| Mouse wheel | zoom a board toward the cursor |

---

## 10. A worked example

Say you're prepping generation references for an angry Wanda battle shot:

1. Press `/`, type `character:wanda tag:battle angry close up`.
2. Click the `character: Wanda` facet chip variants to narrow; open a few
   results, use **Similar → Visual** to find neighbors you'd forgotten.
3. Bag the keepers. In the basket, sort them: portraits → **Character**,
   the moody red frames → **Lighting**, the torn-cape ones → **Costume**.
4. **Create board** — everything lands clustered by slot. Drag, scale, and
   **Tidy** until the board reads well. **Snapshot** it (v1).
5. **Export manifest** for the generation pipeline, or keep iterating.
6. When the generated output comes back, drop it into the library, open the
   original asset and **upload it as a new version** — then wipe-compare
   v1 vs v2 and leave a comment for the team.
7. **Save search** as "Wanda — battle looks" so next episode it's one click.

That's the whole loop. Happy hunting.
