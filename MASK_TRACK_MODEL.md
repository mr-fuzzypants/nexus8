# Mask Track Data Model

**Document purpose:** Design the entity schema, migrations, and query patterns for video mask tracks. Informed by [[LAYER_RENDER_SCHEMA.md]] (two-axis versioning for still-image candidates) and [[SRED_VIDEOOP_EXPERIMENTS.md]] (Phase 1.2 and Phase 1.4).

---

## Overview

A **mask track** is a sequence of per-frame masks for a video clip, produced by SAM 2 propagation with interactive correction. It is distinct from a per-layer mask region (still-image) — the track has:

- **Temporal extent**: frame range over the clip's duration
- **Frame-varying geometry**: each frame has its own mask region (shape + confidence)
- **Authorship axis**: user-drawn keyframes vs. model-propagated frames
- **Provenance**: which propagation run produced which frame, what parameters, what corrections applied

The model stores:

1. **One track asset per (video, layer)**, related via `EntityRelation(role="mask_track", type_data.layer_id)`.
2. **One `Version` per propagation run**, with full run metadata (SAM 2 params, prompt frames, span) in `Version.data`.
3. **Per-frame geometry**, stored compactly in `Version.frames` — a JSON array of frame records, each containing:
   - Mask PNG bytes (base64-encoded in Version.data, or stored as a separate media blob per frame — TBD by Phase 1.1 VRAM testing)
   - Frame-local confidence score (0–1)
   - Authorship flag: `'keyframe'` (user-drawn), `'propagated'`, `'correction'`
   - Vector geometry optional on keyframes (polyline/polygon vertices) for editability
4. **Selection tracking**: a `Symlink` pinning the artist's choice of which version/frame to use as the current mask source for downstream operations (remove, edit).

---

## Entity Model

### MaskTrack Asset

New entity type: **`type: 'mask_track'`** (extends the union of `EntityType`).

```
MaskTrack
├── id: string (UUID)
├── type: 'mask_track'
├── created_at: datetime
├── updated_at: datetime
├── code: string (optional, human-readable project-local code)
├── entity_version: string (current version ID, for canonical lookup — same semantic as existing assets)
└── [data]: JSONB (unused; kept for schema consistency)

Version (attached to MaskTrack.id)
├── entity_id: string (FK → MaskTrack.id)
├── version_number: int (starts 1 per entity)
├── created_at: datetime
├── data: JSONB (propagation run metadata + per-frame array, see below)
└── status: 'ready' | 'failed' (allows async ingestion if frame extraction is slow)

Symlink (selected_mask)
├── entity_id: string (FK → MaskTrack.id)
├── label: 'selected'
├── target_version_id: string (the chosen version)
└── [target_frame_index]: int optional (if pinning a specific frame for manual review)
```

### Relations

**VersionLink** edges:

- `MaskTrack --(source_video)--> Video`: the source video asset, with `RESTRICT` (delete protection — cannot delete video while tracks reference it)
- `MaskTrack --(layer_definition)--> AnnotationLayer`: the layer this track belongs to (optional; the `type_data.layer_id` acts as the primary key; this edge is for query convenience)

**EntityRelation** (discovered):

- `Video --(mask_track)--> MaskTrack`: index for "all tracks for this clip"

---

## Version.data Schema

Per-propagation-run metadata, stored in `Version.data`:

```json
{
  "propagation_model": "SAM2",
  "propagation_model_version": "v2.1",
  
  // Prompt frames: which frames the user clicked/drew to seed propagation
  "prompt_frames": [
    {
      "frame_index": 0,
      "type": "click" | "scribble",
      "clicks": [{"x": 100, "y": 200}],
      "scribble_bytes_b64": "iVBORw0KGgo..."
    }
  ],
  
  // Parameters
  "propagation_params": {
    "full_clip": true,  // true = propagate entire video; false = span_start→span_end
    "span_start": 0,
    "span_end": null
  },
  
  // Per-frame array (indexed by frame_index from 0)
  // Compact representation: omit frames with no mask or low confidence
  "frames": [
    {
      "frame_index": 0,
      "authorship": "keyframe",  // 'keyframe' | 'propagated' | 'correction'
      "mask_png_b64": "iVBORw0KGgo...",  // or null if using separate media blobs
      "confidence": 0.98,
      "vector_geometry": {
        "type": "polygon",
        "vertices": [[100, 100], [200, 100], [200, 200], [100, 200]]
      }
    },
    {
      "frame_index": 1,
      "authorship": "propagated",
      "mask_png_b64": "iVBORw0KGgo...",
      "confidence": 0.87,
      "vector_geometry": null
    }
    // ... more frames
  ],
  
  // Modal job tracking
  "modal_call_id": "call-xyz123",
  "dispatch_at_ms": 1722510000000,
  "result_at_ms": 1722510045000,
  "latency_s": 45.2,
  
  // Lineage / corrections
  "prior_version_id": null,  // if this is a re-propagation from a correction, the version it supersedes (for audit trail)
  "corrected_frames": [10, 45],  // if this version is a correction run, which frames did the user fix
}
```

Notes on frame encoding:
- **Mask PNG b64**: Base64-encoded PNG bytes, self-contained in `Version.data`. For a 240-frame 480p clip, ~2–5 MB total. Acceptable for most clips.
- **Alternative**: Store per-frame mask PNGs as separate MediaAsset blobs, linked via `VersionLink` edges. More scalable for very long clips; adds query complexity. Defer to Phase 1.1 when we measure real storage patterns.
- **Vector geometry on keyframes only** keeps the model compact and allows artists to re-edit keyframes (brush strokes converted to polygon).

---

## Query Patterns

### "Get the current mask for frame N" (used during video playback, removal job dispatch)

```python
# 1. Fetch the selected version (or latest if no selection)
selected = Symlink.objects.filter(
    entity_id=track.id, label='selected'
).first()
version = selected.target_version if selected else track.versions.latest('version_number')

# 2. Lookup frame N in version.data['frames']
frame_record = next(
    (f for f in version.data['frames'] if f['frame_index'] == n),
    None
)

# 3. Decode mask_png_b64 to bytes / HTMLImageElement on the frontend
mask_bytes = base64.b64decode(frame_record['mask_png_b64'])
```

### "Get all frames with low confidence" (timeline directive: which frames to review)

```python
version = track.versions.latest('version_number')
low_conf = [
    f for f in version.data['frames']
    if f['confidence'] < 0.7  # threshold
]
# Front-end renders these as low-confidence spans on the timeline
```

### "Get frames authored by the user (keyframes)" (for re-key planning)

```python
version = track.versions.latest('version_number')
keyframes = [
    f['frame_index'] for f in version.data['frames']
    if f['authorship'] in ('keyframe', 'correction')
]
```

### "List all tracks for a video + layer" (sidebar / track discovery)

```python
# Fast path: EntityRelation index
tracks = EntityRelation.objects.filter(
    source_id=video.id, role='mask_track', type_data__layer_id=layer_id
).select_related('target')
# One query, index-served
```

---

## Django Models (sketch)

```python
class MaskTrack(Entity):
    """Video mask track: per-frame segmentations from SAM 2 propagation."""
    
    class Meta:
        constraints = [
            # One track per (video_source, layer_id)
            UniqueConstraint(
                fields=['video_source_version', 'layer_id'],
                name='unique_track_per_video_layer'
            )
        ]
    
    # Lazy-loaded from VersionLink edges; stored for query convenience
    video_source_id = models.UUIDField(null=True)
    layer_id = models.UUIDField()  # AnnotationLayer.id
    
    @classmethod
    def for_video_layer(cls, video_id, layer_id):
        return (
            cls.objects.filter(
                entity_relations__source_id=video_id,
                entity_relations__role='mask_track',
                entity_relations__type_data__layer_id=layer_id
            )
            .latest('entity_version')
        )


# Version.data is untyped JSONB, but the shape is:
# {
#   "propagation_model": str,
#   "propagation_model_version": str,
#   "prompt_frames": List[{frame_index, type, ...}],
#   "propagation_params": {...},
#   "frames": List[{frame_index, authorship, mask_png_b64, confidence, vector_geometry}],
#   "modal_call_id": str,
#   "dispatch_at_ms": int,
#   "result_at_ms": int,
#   "latency_s": float,
#   "prior_version_id": str | null,
#   "corrected_frames": List[int],
# }
```

---

## Migrations

**0015_mask_track_model** (pseudocode; actual Django syntax to follow):

```sql
-- Entity type enum addition
ALTER TABLE entity ADD CONSTRAINT entity_type_check CHECK (type IN ('...existing...', 'mask_track'));

-- No new tables: MaskTrack is a subclass of Entity, with constraints on existing VersionLink / EntityRelation tables
-- The `video_source_id` and `layer_id` fields on MaskTrack are denormalizations for query speed; they mirror data in VersionLink edges

CREATE INDEX idx_mask_track_video_layer ON entity_relation(source_id, type_data)
  WHERE source_entity.type = 'video' AND target_entity.type = 'mask_track' AND target_entity.type_data->>'role' = 'mask_track';

CREATE INDEX idx_mask_track_layer_id ON entity(id, type_data)
  WHERE type = 'mask_track';
```

---

## Lifecycle: Creating a Track from Propagation

When the "Propagate" action fires (Phase 1.3 / Django endpoint):

1. **Fetch or create** the MaskTrack for `(video_id, layer_id)`:
   ```python
   track, created = MaskTrack.objects.get_or_create(
       video_source_id=video_id,
       layer_id=layer_id,
       defaults={'type': 'mask_track'}
   )
   ```

2. **Dispatch to Modal** (Phase 1.1 SAM 2 app):
   - Pass: video asset ID, source frame index (or full video), layer ID
   - Receive: per-frame mask PNGs, confidence scores, call ID

3. **Ingest result** as a new Version:
   ```python
   version = Version.objects.create(
       entity=track,
       version_number=track.versions.count() + 1,
       data={
           "propagation_model": "SAM2",
           "propagation_model_version": "v2.1",
           "prompt_frames": [...],
           "propagation_params": {...},
           "frames": [
               {"frame_index": i, "authorship": "propagated", "mask_png_b64": b64(...), "confidence": conf}
               for i, (mask_png, conf) in enumerate(result_frames)
           ],
           "modal_call_id": call_id,
           "dispatch_at_ms": ...,
           "result_at_ms": ...,
           "latency_s": ...
       }
   )
   track.entity_version = version.id
   track.save()
   ```

4. **Link provenance**:
   ```python
   VersionLink.objects.create(
       source=track.latest_version(),
       target=video.latest_version(),
       role='source_video'
   )
   ```

5. **Return to frontend**:
   - Track created with version 1
   - Timeline re-renders with per-frame data from `version.data['frames']`

---

## Later Phases

- **Phase 1.4d (correction loop):** When the user marks frame N as a keyframe (by editing its mask), create a new Version with `corrected_frames=[N]` and re-propagate the span (N → next keyframe).
- **Phase 2 (removal):** Fetch the selected version's per-frame masks, pass to removal model, store results as a separate removal asset (following the still-image render pattern).
- **Phase 3 (keyframe edits):** Similar: fetch keyframe mask from track, edit with LCM, propagate result via optical flow.

---

## Open Questions / TBD

1. **Per-frame mask storage**: Inline b64 in `Version.data` (simple, <5MB per track) vs. separate MediaAsset blobs per frame (scalable, but more complex). Decide after Phase 1.1 prototype.
2. **Vector geometry priority**: On keyframes only (current design) or on all frames? Keyframes-only keeps storage compact; all-frames enables per-frame vector editing. Defer to artist feedback post-Phase 1.
3. **Confidence threshold for timeline low-confidence spans**: Currently assumed 0.7. Phase 1.6 (H7 experiment) will measure empirically on real clips.
4. **Selection semantics**: Should `Symlink(label='selected')` pin a single version, or (version, frame_index) pair? For now, version-level; extend if Phase 2 (removal) requires per-frame selection.
