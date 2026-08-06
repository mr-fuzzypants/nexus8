# FileSet Data Model

**Document purpose:** Design a file-based storage primitive for frame sequences — mask tracks first, then staged frames, image-sequence assets, and other per-frame caches. Replaces the inline `mask_png_b64` encoding chosen provisionally in [[MASK_TRACK_MODEL.md]] (open question 1, now resolved by measurement). Informed by [[SRED_VIDEOOP_EXPERIMENTS.md]] Phase 1.x findings.

---

## Motivation (measured)

Mask tracks currently store every frame's mask as a base64 PNG string inside `Version.data` (JSONB). Measured on the dev DB (2026-08-06, 9 mask-track versions):

| metric | value |
|---|---|
| per-frame mask, 480p, on disk (TOASTed) | ~1.7–2.8 KB |
| 600-frame span, one version | ~1.2 MB |
| total mask data | ~7.8 MB |

Disk size is tolerable; the **scaling behaviour** is not:

1. **Corrections copy the whole span.** The correction merge in `views_video_masks.py` (status view) rebuilds all frames into each new version — versions 1147/1156/1157/1158 are the same 366-frame track re-copied per correction. N corrections ⇒ N full copies.
2. **Read amplification.** `MaskTrack.get_mask_for_frame` deserializes the entire version JSON (~1.2 MB) to extract one ~2 KB mask, and `VideoMaskFrameView` does this once per rendered frame on the hot path.
3. **`native` tier** masks will be ~3–5× larger per frame than the 480p numbers above.
4. Blobs in JSONB inflate backups, replication, and any query that touches `Version.data`.

Decision: masks (and frame sequences generally) move to **files under `MEDIA_ROOT`**, referenced from the DB — mirroring how `MediaAsset.file_path` already works for single files.

---

## Overview

A **FileSet** is an immutable, sealed package of files sharing one directory and one padded filename pattern, covering a **possibly discontinuous frame range**:

- **Single file** — degenerate case (`padding=0`, no pattern token): a movie, a still, an archive.
- **Sequence** — `mask.%06d.png` over ranges like `[[0,120],[240,599]]`.

Key properties:

- **Immutable once sealed.** A FileSet is never appended to or edited; new frames ⇒ new FileSet. This makes sharing across versions and garbage collection safe.
- **Shared by reference.** Entity `Version`s reference FileSets through a join table; many versions may reference the same FileSet.
- **Overlay composition.** A version references an *ordered stack* of FileSets; per-frame resolution is last-wins. A correction run stores only its re-run frames as a small discontinuous FileSet layered over the base — no copying.
- **Kind-tagged.** `'mask' | 'frames' | 'cache' | 'render' | …` so eviction and accounting policies can differ (e.g. `cache` filesets are evictable, `mask` filesets are GC'd by reference count).

```
FileSet A  (base propagation)      frames 0–599      600 files
FileSet B  (correction run 1)      frames 120–180     61 files
FileSet C  (correction run 2)      frames 300–310,450–455   17 files

Version 1  → [A]
Version 2  → [A, B]           frame 150 resolves to B; frame 20 to A
Version 3  → [A, B, C]        provenance = which fileset owns the frame
```

---

## Frame Ranges

### Canonical form

A range is a JSON list of **inclusive** `[start, end]` pairs — sorted ascending, non-overlapping, non-adjacent (adjacent pairs are merged on normalization):

```json
[[0, 120], [240, 599]]
```

Frames are **absolute, 0-based** clip frame indices — the same convention as the SAM 2 span math in `views_video_masks.py`. Note this deliberately differs from ffmpeg's 1-based `frame_%06d.jpg` output numbering (`VideoFrameStager.FRAME_FILE_OFFSET`); FileSet files are always named by absolute 0-based index, and any ingest from ffmpeg output renames accordingly. This removes the off-by-one trap at the storage boundary.

### String syntax (API/UI boundaries)

Nuke/RV-style, for logs, URLs, and human entry:

```
"0-120,240-599"        # discontinuous
"37"                   # single frame
"0-599"                # contiguous
```

### `FrameRange` helper

```python
class FrameRange:
    """Immutable normalized frame range: sorted, disjoint, inclusive pairs."""

    def __init__(self, pairs: list[tuple[int, int]]): ...   # normalizes

    @classmethod
    def parse(cls, spec: str) -> 'FrameRange': ...          # "0-120,240-599"
    def format(self) -> str: ...

    def contains(self, frame: int) -> bool: ...             # bisect on pair starts, O(log n)
    def iter_frames(self) -> Iterator[int]: ...
    def count(self) -> int: ...
    def union(self, other) -> 'FrameRange': ...
    def intersect(self, other) -> 'FrameRange': ...
    def first(self) -> int: ...
    def last(self) -> int: ...
```

Lives in `trackables/services/frame_range.py`; no model imports so it is usable from the frontend-facing serializers and the stager alike.

---

## On-Disk Layout

```
MEDIA_ROOT/
└── filesets/
    └── <uuid[:2]>/                 # fan-out shard: 256 dirs max at first level
        └── <uuid>/
            ├── mask.000000.png
            ├── mask.000001.png
            └── …
```

- One directory per FileSet; directory name is the FileSet UUID; `root` column stores the relative path (`filesets/ab/abcd…/`).
- Two-hex-char shard keeps any single directory to a manageable number of children.
- All filesystem access goes through `default_storage` with **relative paths only** (open/save/delete/exists), preserving the option of object storage later.
- A `writing` FileSet's directory may be partially populated; only `sealed` FileSets are readable by consumers. Crash cleanup = delete `writing` rows older than a threshold plus their directories.

---

## DB Model

Two new concrete tables (both `Trackable`, like `Version` and `EntityRelation` — deliberately **not** `VersionedEntity` proxies; FileSets are storage payloads, not domain entities):

```python
class FileSet(Trackable):
    """Immutable, sealed package of files: a single file or a padded frame
    sequence over a possibly discontinuous range. See FILESET_MODEL.md."""

    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)

    root = models.CharField(max_length=255)        # 'filesets/ab/abcd…/' rel. MEDIA_ROOT
    pattern = models.CharField(max_length=255)     # 'mask.%06d.png' | 'clip.mov'
    padding = models.PositiveSmallIntegerField(default=0)   # 0 ⇒ single file
    ranges = models.JSONField(default=list)        # [[0,120],[240,599]] inclusive

    kind = models.CharField(max_length=32, db_index=True)   # 'mask'|'frames'|'cache'|…
    media_type = models.CharField(max_length=64, blank=True, default="")

    # Sparse per-frame metadata, keyed by str(frame):
    #   {"37": {"confidence": 0.61, "authorship": "correction"}}
    frame_meta = models.JSONField(default=dict, blank=True)

    # Denormalized accounting (set at seal time).
    file_count = models.PositiveIntegerField(default=0)
    total_bytes = models.BigIntegerField(default=0)

    STATUS_CHOICES = [('writing', 'writing'), ('sealed', 'sealed')]
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default='writing')

    # -- helpers ------------------------------------------------------------
    @property
    def range(self) -> FrameRange: ...

    def path_for(self, frame: int) -> str:
        """Relative storage path for a frame; raises if not in range."""

    def open(self, frame: int): ...                # default_storage.open(path_for(frame))


class VersionFileSet(Trackable):
    """Ordered reference from an entity Version to a FileSet layer.

    Overlay semantics: higher `order` wins per frame. A real join table (not
    ids inside Version.data) so 'unreferenced filesets' is a single query and
    deletion cascades are visible to the DB.
    """

    version = models.ForeignKey(Version, on_delete=models.CASCADE,
                                related_name='fileset_refs')
    fileset = models.ForeignKey(FileSet, on_delete=models.RESTRICT,
                                related_name='version_refs')
    order = models.PositiveSmallIntegerField(default=0)   # 0 = base layer
    role = models.CharField(max_length=32, blank=True, default="")
    # e.g. 'base' | 'correction' — informational; resolution uses `order` only

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['version', 'order'],
                                    name='unique_layer_order_per_version'),
        ]
```

Notes:

- `VersionFileSet.fileset` uses **RESTRICT**: a FileSet cannot be deleted while any version references it. GC must delete refs (via version deletion) first — same protective pattern as `VersionLink.version`.
- `FileSet.id` is a UUID (unlike `Version`'s integer pk) because the id *is* the directory name; it must be assigned before any file is written.
- `frame_meta` holds what today lives per-frame in `Version.data['frames']` minus the blob: `confidence`, `authorship`. It stays sparse — omit frames with nothing to say. Summary queries (keyframes, low-confidence) read `frame_meta` only and never touch pixel data.

### `Version.data` after migration (mask tracks)

```json
{
  "propagation_model": "SAM2",
  "propagation_model_version": "v2.1",
  "prompt_frames": [...],
  "propagation_params": {...},
  "modal_call_id": "call-xyz123",
  "dispatch_at_ms": 1722510000000,
  "result_at_ms": 1722510045000,
  "latency_s": 45.2,
  "prior_version_id": null,
  "corrected_frames": [120, 180]
  // NO "frames" array — pixels and per-frame meta live on FileSets
}
```

---

## Overlay Resolution

```python
def resolve_frame(version: Version, frame: int) -> FileSet | None:
    """Highest-order FileSet layer containing `frame`, or None."""
    refs = (version.fileset_refs
            .select_related('fileset')
            .order_by('-order'))
    for ref in refs:
        if ref.fileset.range.contains(frame):
            return ref.fileset
    return None
```

- Stacks are short (1 base + one layer per correction; realistically < 10), so the reverse walk is trivial. If a track accrues dozens of corrections, add a periodic **flatten**: write one new merged FileSet and a new version referencing only it (an optimization, not a correctness requirement — defer).
- Provenance falls out structurally: the frame's owning FileSet identifies which run produced it; `role`/`frame_meta.authorship` refine it.

---

## Query Patterns

### "Serve the mask for frame N" (hot path — `VideoMaskFrameView`)

```python
fs = resolve_frame(version, n)
if fs is None:
    return HttpResponse(status=204)
return FileResponse(default_storage.open(fs.path_for(n)), content_type='image/png')
```

One indexed query + one file open. No JSON parse, no base64, and — because the white-RGBA tint conversion moves to **write time** (masks are stored already-converted) — no PIL work either. Cache headers stay as-is (immutable per (version, frame)).

### "Keyframes / low-confidence frames" (timeline rehydration)

```python
out = []
for ref in version.fileset_refs.select_related('fileset').order_by('order'):
    for frame_str, meta in ref.fileset.frame_meta.items():
        if meta.get('authorship') in ('keyframe', 'correction'):
            out.append(int(frame_str))
```

Reads kilobytes of `frame_meta`, never pixel data. (Today this parses the full blob-laden JSON.)

### "Unreferenced FileSets" (GC)

```python
FileSet.objects.filter(version_refs__isnull=True, status='sealed')
```

---

## Write Path (mask ingestion)

`MaskTrack.add_propagation_result` changes to:

1. Create `FileSet(kind='mask', status='writing', pattern='mask.%06d.png', padding=6)`.
2. For each result frame: decode `mask_png_b64` → convert to white-RGBA (tintable) → `default_storage.save(fs.path_for(frame_index), …)`. Record `confidence`/`authorship` into `frame_meta`.
3. Seal: set `ranges`, `file_count`, `total_bytes`, `status='sealed'`.
4. Create the `Version` (metadata-only `data`) and its `VersionFileSet` refs:
   - **Full propagation:** `[(new_fs, order=0, role='base')]`.
   - **Correction:** copy the prior version's refs (same FileSets, same order), then append `(new_fs, order=prev_max+1, role='correction')`. The Modal result for a correction contains only the re-run span, so the new FileSet is naturally small and discontinuous-capable.
5. `update_symlink(track, 'latest', version)` — unchanged.

The correction merge loop in `VideoMaskStatusView` (frame-dict overlay in Python) is deleted; the overlay is now structural.

---

## Deletion & GC

Integrates with the existing `DELETE /video-mask/<layer_id>/` endpoint (`VideoMaskTrackInfoView.delete`):

- **Unlink (default):** delete the `EntityRelation` only — unchanged. Track, versions, and FileSets remain (orphaned but recoverable).
- **Purge (`?purge=1`):** delete symlinks → versions (cascades `VersionFileSet` refs) → track entity, then sweep: for each FileSet formerly referenced, if `version_refs` is now empty, delete the row and `rmtree` its directory (via `default_storage`).

General GC rules:

| kind | policy |
|---|---|
| `mask`, `render` | ref-counted: delete only when no `VersionFileSet` references remain |
| `cache`, `frames` (staging) | evictable: LRU/age-based sweep regardless of refs (they are re-derivable from source media) |
| any, `status='writing'` | crash debris: delete when older than N hours |

A `manage.py fileset_gc` command runs the sweep; purge calls the same sweep function inline for the filesets it touched.

---

## Migration

**Schema:** one migration adding `FileSet` + `VersionFileSet`.

**Data (existing mask tracks — currently 9 versions, ~8 MB):**

```python
def migrate_mask_versions(apps, schema_editor):
    for version in Version.objects.filter(entity__entity_type='mask_track'):
        frames = version.data.get('frames', [])
        if not frames:
            continue
        fs = create_fileset_from_b64_frames(frames)   # decode, RGBA-convert, seal
        VersionFileSet.objects.create(version=version, fileset=fs, order=0, role='base')
        version.data = {k: v for k, v in version.data.items() if k != 'frames'}
        version.save(update_fields=['data'])
```

Each historical version becomes a single base layer (their baked-in correction copies stay baked — flattening history is not worth the code). Given the tiny volume, re-propagating from scratch is an acceptable fallback if the migration is more trouble than it's worth in practice.

Read-path compatibility: not needed — migrate data and code in the same deploy; there is one dev DB.

---

## Adoption Roadmap

1. **Phase A — mask tracks** (this doc's driver): write path, serve path, timeline queries, purge/GC. Removes the JSONB blob problem end-to-end.
2. **Phase B — staging cache:** `VideoFrameStager` output becomes `kind='frames'` FileSets rooted under an evictable area, replacing bare `/tmp/nexus8-frames` dirs. Span extraction requests become range intersections against existing sealed FileSets (partial-hit reuse instead of today's exact-span directory match). `create_frame_archive` takes a FileSet + FrameRange.
3. **Phase C — image-sequence assets:** `MediaAsset` gains a `fileset_id` json_property alongside `file_path`; an EXR/DPX/JPEG sequence ingests as one FileSet and the annotator, thumbnailer, and media server resolve frames via `path_for()`.
4. **Later:** renders, geometry/sim caches, tiles — anything per-frame reuses the primitive unchanged.

---

## Deferred (deliberately)

- **Content-addressed dedup** across FileSets — the overlay model already removes the dominant duplication (correction copies); revisit if identical frames across tracks become common.
- **Multi-token patterns** (UDIM `<UDIM>`, stereo `%V`) — keep `pattern` a plain printf template with one frame token; nothing in the schema blocks adding tokens later.
- **Object storage** — all access is `default_storage` + relative paths, so S3 is mechanically possible; per-frame serving over remote storage (signed URLs / proxy caching) is a separate design when needed.
- **Flatten-on-N-corrections** — structural optimization; add when a real track's stack depth hurts.
- **Tar-packing sealed filesets** for backup friendliness — sealed immutability makes this trivial to add later; no schema impact (a `packed` flag + archive path).

## Open Questions

1. **Where does per-frame `vector_geometry` (editable keyframe polygons, [[MASK_TRACK_MODEL.md]]) live?** Options: `frame_meta` (co-located with authorship; keeps `Version.data` clean) vs. staying in `Version.data.prompt_frames` (it's authoring input, not output). Leaning `frame_meta` — it is per-frame and version-independent once propagated.
2. **Should `preview` one-frame masks be FileSets?** They're ephemeral (client-side prompt refinement), so probably not — keep them as response payloads. Revisit if we want preview provenance.
3. **`native`-tier storage cost** — masks at source resolution may warrant 1-bit PNG or RLE encoding inside the same FileSet contract (`media_type` distinguishes). Measure first.
