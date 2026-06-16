# Library Search — How It Works & How to Tune It

This document explains how search works in the Library, the query syntax users
can type, the ranking pipeline behind it, every setting you can adjust (with
when and why), and a glossary of the terms involved.

Audience: developers and operators tuning search behavior. No prior knowledge of
vector search assumed — see the [Glossary](#glossary) for any unfamiliar term.

- **Endpoint:** `GET /trackables/api/library/search/`
- **Backend:** [`LibrarySearchView`](nexus8/trackables/views_library.py) in `nexus8/trackables/views_library.py`
- **Frontend:** [`web/src/features/search/`](web/src/features/search/) (`SearchPage.tsx`, `useSearchState.ts`) → [`searchLibrary`](web/src/api/library.ts) in `web/src/api/library.ts`

---

## 1. Mental model

A search query is two different things mixed into one text box:

1. **Tokens** — structured `key:value` pairs like `type:video` or `character:wanda`. These are **hard filters**: a result either has that property or it's excluded.
2. **Free text** — everything else, e.g. `two people talking`. This is **ranked, not filtered**: results are scored by how well they match and sorted best-first.

Example: `type:video two people talking` →
- token `type:video` narrows the candidate set to videos only,
- free text `two people talking` ranks those videos by relevance.

The whole raw string is sent to the backend as `?q=`. The frontend does **not**
parse it — all parsing happens server-side ([`parse_query`](nexus8/trackables/views_library.py)).

> **Key property:** search is **recall-first**, not precision-first. It favors
> returning everything that *might* match (sorted so the best are on top) over
> returning only exact matches. This is why you sometimes see "more results than
> expected" — see [Section 6](#6-why-am-i-getting-more-results-than-expected).

---

## 2. Query syntax

### Tokens (hard filters)

Parsed by the regex `(\w+):("[^"]*"|\S+)`. Quoted values allow spaces.

| Token | Matches | Example |
|---|---|---|
| `type:` | media type (`type_data.media_type`) | `type:video`, `type:image` |
| `tag:` | user tags **or** AI-suggested tags | `tag:hero`, `tag:"final approved"` |
| `status:` | AI analysis status | `status:completed` |
| `<role>:` | an entity by role + name (roles come from `EntityRelation.role`) | `character:"wanda maximoff"`, `costume:cloak` |
| any other `key:` | exact match on `type_data.<key>` | `department:lighting` |

Tokens can be combined; they all AND together (each further narrows results).
The separate facet chips in the UI (`media_type=`, repeatable `tag=`) feed the
same filters — clicking a facet is equivalent to typing the token.

### Free text (ranked)

Whatever remains after tokens are stripped out. Drives the relevance ranking
described next. An empty free-text query (tokens only, or nothing) just lists
assets newest-first by `created_at`.

---

## 3. The ranking pipeline (free-text search)

When there is free text, ranking is **hybrid**: two independent searches run,
then their results are fused. Implemented in
[`rank_hybrid`](nexus8/trackables/views_library.py).

```
                 free text: "two people talking"
                          │
        ┌─────────────────┴─────────────────┐
        ▼                                    ▼
  KEYWORD branch                       SEMANTIC branch
  (literal text match)                 (meaning match)
        │                                    │
  up to KEYWORD_POOL ids               up to SEMANTIC_POOL ids
        └─────────────────┬─────────────────┘
                          ▼
              Reciprocal Rank Fusion (RRF)
              merges the two ranked lists
                          ▼
              final ordered result list
              (UNION of both branches)
```

### Keyword branch — literal matching

Matches the query text **literally** (case-insensitive substring, SQL `ILIKE`)
against:
- asset `name`
- asset `description`
- AI-generated description (`type_data.ai_generated_description`)
- **plus, for each individual word**, any matching tag

That last part matters: `two people talking` also matches anything tagged with
just `people`. This broadens results (see [Section 6](#6-why-am-i-getting-more-results-than-expected)).

The keyword branch is **exact but literal** — it can't match synonyms. Searching
`talking` won't match a description that says `conversation`.

### Semantic branch — meaning matching

Converts the query into an **embedding** (a vector of numbers representing its
*meaning*) and finds assets whose stored embedding is closest, measured by
**cosine distance**. This matches *meaning*, not words: `talking` can match
`conversation`, `chatting`, `two people speaking`, etc.

Only assets that have been AI-analyzed (and therefore have a `semantic_embedding`)
participate. Assets are admitted only if their distance is within
`SEMANTIC_MAX_DISTANCE`, and at most `SEMANTIC_POOL` are taken.

The query embedding is cached per process ([`query_embedding`](nexus8/trackables/views_library.py),
`lru_cache` of 256 entries) so repeated searches don't re-call the embeddings API.

### Fusion — combining the two lists (RRF)

The two ranked lists are merged with **Reciprocal Rank Fusion** (RRF). Each
asset's score is the sum, across both lists, of `1 / (RRF_K + rank)`, where
`rank` is its position in that list. See the [Glossary](#glossary) for the full
explanation. The upshot:

- Appearing in **both** lists → highest score (these are your best matches).
- Appearing near the **top** of a list scores more than near the bottom.
- The final result set is the **UNION** of both branches — every asset found by
  either keyword or semantic search is included, just ranked lower if weak.

Each result is labeled `"keyword"`, `"semantic"`, or `"both"` so the UI (or you,
when debugging) can see *why* it matched. `"both"` is the strongest signal.

### Modes

`mode=hybrid` (default) runs both branches. `mode=keyword` skips the semantic
branch entirely (literal matching only — narrower, no synonym matching, no
embeddings API call). The frontend never sets this, so production is always
hybrid; it's available for debugging or a future "exact match" toggle.

---

## 4. Settings reference

All constants live at the top of
[`nexus8/trackables/views_library.py`](nexus8/trackables/views_library.py).

| Setting | Default | What it controls |
|---|---|---|
| `SEMANTIC_MAX_DISTANCE` | `0.8` | Max cosine distance for a semantic match. Lower = stricter (fewer, closer matches). `0.8` distance = `0.2` similarity, which is very permissive. |
| `SEMANTIC_POOL` | `100` | Max number of semantic matches pulled per query. |
| `KEYWORD_POOL` | `200` | Max number of keyword matches pulled per query. |
| `RRF_K` | `60` | Fusion smoothing constant. Higher = ranks matter less (flatter); lower = top ranks dominate more. The standard default is 60 — rarely needs changing. |
| `page_size` | `50` (max `200`) | Results per page (request param, not a constant). |

Related (in `services/ai_intelligence.py`): the embedding model is
`text-embedding-3-small` (**1536 dimensions**). Changing the model changes the
vector space — **all stored embeddings must be regenerated** if you change it
(see [Section 7](#7-re-analyzing-assets)).

### When and how to adjust

**"Too many loosely-related results" (most common).**
Lower `SEMANTIC_MAX_DISTANCE`. This is the single biggest lever. Try `0.8 → 0.55`.
- `0.8` ≈ similarity 0.2 — very loose; admits weak neighbors.
- `0.6` ≈ similarity 0.4 — moderate.
- `0.5` ≈ similarity 0.5 — fairly strict; mostly on-topic.
It's one number and fully reversible, so tune by feel against real queries.

**Still too broad after tightening distance.**
The per-word tag matching in the keyword branch is usually the next culprit
(single common words like `people` matching). Options: remove the per-word
`tag_match` loop, or only apply it for queries of 1–2 words, or require a
minimum word length.

**"Good matches are getting cut off / missing results."**
Raise `SEMANTIC_MAX_DISTANCE` (looser) and/or raise `SEMANTIC_POOL` /
`KEYWORD_POOL` (deeper candidate lists). Raising the pools costs a little query
time but no API calls.

**"Exact matches aren't ranked first."**
RRF already favors items in both lists. If you need literal matches to strictly
win, either boost the keyword branch's contribution, or expose `mode=keyword` as
a user toggle.

**Performance tuning.**
The semantic branch makes one embeddings API call per *unique* query (cached).
The pools bound how many rows are scored/sorted in Postgres. Lowering the pools
speeds up very large libraries; raising them improves recall. The pgvector
cosine distance scan benefits from an `ivfflat`/`hnsw` index on
`semantic_embedding` once the table is large.

> **Rule of thumb:** change **one** setting at a time, re-run a few representative
> queries, and compare. Search relevance is subjective — there is no single
> correct value, only what feels right for your library.

---

## 5. How video content is searched

Videos are searched the same way as everything else — via their
`name`, `description`, AI-generated description, tags, and `semantic_embedding`.
What makes content search work is that those fields now reflect the **actual
video content**:

- On AI analysis, up to **8 keyframes** are extracted with `ffmpeg` and analyzed
  by GPT-4 Vision, which writes a description of what's on screen (people,
  actions, setting). That description is embedded and stored.
- `ffprobe` fills real technical metadata (duration, resolution, fps, codec).

So `type:video two people talking` filters to videos, then ranks them by whether
their frames actually showed two people in conversation.

**Requirements & limits:**
- `ffmpeg`/`ffprobe` must be installed and on `PATH`. If absent, video analysis
  **silently falls back** to filename/metadata text only (no frame content) —
  so verify `ffmpeg` is present before relying on video content search.
- This covers the **visual** signal only. Spoken dialogue is **not** transcribed
  — searching for a quoted line of dialogue won't match unless those words also
  appear visually or in the description. (Audio transcription via Whisper is a
  possible future addition.)
- Each video analysis = one multi-frame Vision call. Cheap for a handful of
  videos; for large libraries run analysis on a background queue.

---

## 6. Why am I getting more results than expected?

Three behaviors compound, all by design (recall-first):

1. **Union, not intersection.** The result count is *every* asset matched by the
   keyword branch **or** the semantic branch. Good matches rank at the top (RRF),
   but weak matches still appear in the tail rather than being dropped.
2. **The semantic threshold is loose.** `SEMANTIC_MAX_DISTANCE = 0.8` admits
   anything with similarity ≥ 0.2. With `text-embedding-3-small`, even loosely
   related assets sit in that range, so the semantic branch pulls in a wide net
   (up to `SEMANTIC_POOL = 100`).
3. **Per-word tag matching.** The keyword branch splits your query into words and
   matches tags for each, so a single common word (`people`) can match on its
   own.

Also check you included the `type:` token if you meant to restrict media type —
without `type:video`, images and everything else are eligible.

**To narrow:** start by lowering `SEMANTIC_MAX_DISTANCE` (see
[Section 4](#4-settings-reference)). That removes most of the surprise without
losing the strong hits.

---

## 7. Re-analyzing assets

Changing how analysis works (or the embedding model) requires regenerating
embeddings. Use the `analyze_assets` management command:

```bash
cd nexus8

# Re-analyze all videos (e.g. after enabling keyframe analysis)
../.venv/bin/python manage.py analyze_assets --media-type video --force-reanalysis

# Preview without spending API calls
../.venv/bin/python manage.py analyze_assets --media-type video --force-reanalysis --dry-run

# Specific assets only
../.venv/bin/python manage.py analyze_assets --asset-ids 76,78,84 --force-reanalysis

# Everything
../.venv/bin/python manage.py analyze_assets --all --force-reanalysis
```

`--force-reanalysis` is required to re-process assets already marked `completed`.
Without it, the command only touches `pending` assets.

---

## Glossary

**Token** — a `key:value` filter typed into the search box (`type:video`). A hard
filter: results either have the property or are excluded.

**Free text** — the non-token part of a query. Ranked by relevance rather than
filtered.

**Keyword search** — literal, case-insensitive substring matching (SQL `ILIKE`).
Exact but can't match synonyms. `talking` won't match `conversation`.

**Embedding (vector)** — a list of numbers (here, 1536 of them) that represents
the *meaning* of a piece of text or image. Produced by an AI model. Two things
with similar meaning have embeddings that point in similar directions.

**Semantic search** — finding results by comparing embeddings, so it matches
*meaning* rather than exact words. `talking` can match `conversation`.

**Cosine distance / cosine similarity** — a measure of how close two embeddings
are by the angle between them. **Similarity** ranges 0 (unrelated) to 1
(identical meaning); **distance** = `1 − similarity`. We filter on distance:
`distance ≤ 0.8` is the same as `similarity ≥ 0.2`. Lower distance = more
related.

**Pool** — the maximum number of candidates pulled from one branch before fusion
(`KEYWORD_POOL`, `SEMANTIC_POOL`). A cap for performance; bigger = more recall,
slower.

**RRF (Reciprocal Rank Fusion)** — the method for merging two ranked lists into
one. Each item gets a score based on its *rank* (position) in each list, not its
raw score, which lets two very different scoring systems (literal match vs. cosine
distance) be combined fairly. The formula per list is:

```
score += 1 / (RRF_K + rank)
```

where `rank` is the item's 0-based position. An item ranked #1 in a list
contributes `1 / (60 + 1) ≈ 0.0164`; ranked #10, `1 / (60 + 10) ≈ 0.0143`. An
item in **both** lists sums both contributions, so it outranks items in only one.
`RRF_K` (default 60) smooths the curve: a larger K flattens the difference between
top and bottom ranks; a smaller K makes the top ranks dominate. 60 is the widely
used standard value.

**Recall vs. precision** — *recall* = how much of the relevant stuff you find
(catch everything); *precision* = how little irrelevant stuff you include (only
exact matches). This search is tuned recall-first: it prefers finding everything
that might match, sorted so the best are on top.

**Hybrid search** — running keyword and semantic search together and fusing the
results (the default here). Combines literal precision with semantic recall.

**`ILIKE`** — PostgreSQL case-insensitive `LIKE`. Substring matching, not
full-text search and not synonym-aware.

**Keyframe** — a representative still frame sampled from a video, analyzed to
understand the video's visual content.

---

## File reference

| Concern | Location |
|---|---|
| Search endpoint + ranking | [`nexus8/trackables/views_library.py`](nexus8/trackables/views_library.py) (`LibrarySearchView`, `rank_hybrid`, `parse_query`) |
| Tunable constants | [`views_library.py`](nexus8/trackables/views_library.py) top of file (`SEMANTIC_MAX_DISTANCE`, pools, `RRF_K`) |
| Embedding + video analysis | [`nexus8/trackables/services/ai_intelligence.py`](nexus8/trackables/services/ai_intelligence.py) |
| Re-analysis command | [`nexus8/trackables/management/commands/analyze_assets.py`](nexus8/trackables/management/commands/analyze_assets.py) |
| Frontend search UI/state | [`web/src/features/search/`](web/src/features/search/), [`web/src/api/library.ts`](web/src/api/library.ts) |
