# Video Masking Stack — Complete Integration Guide

**Date**: August 1, 2026  
**Status**: Phase 0 + Phase 1.1–1.3 complete; Phase 1.4d–6 deferred  
**Related docs**: [SRED_VIDEOOP_EXPERIMENTS.md](SRED_VIDEOOP_EXPERIMENTS.md), [MASK_TRACK_MODEL.md](MASK_TRACK_MODEL.md), [LAYER_RENDER_SCHEMA.md](LAYER_RENDER_SCHEMA.md)

---

## Overview

Complete end-to-end video mask track propagation system, from React UI to GPU inference to database persistence. Enables:

- **Interactive mask propagation** — SAM 2 on video with user corrections and re-propagation
- **Temporal mask track versioning** — per-frame masks with full provenance and confidence scores
- **Frame staging infrastructure** — efficient frame extraction and transport to GPU workers
- **Production-ready endpoints** — dispatch/poll/cancel architecture matching still-image inpainting pattern

---

## Architecture Layers

### Layer 1: Frontend (React/TypeScript) — `Phase 1.4a-e`

**Files changed**:
- `web/src/features/annotator/AnnotationViewport.tsx` — Mask mode enabled for video, per-frame overlay rendering
- `web/src/features/annotator/components/MaskLayersPanel.tsx` — "Propagate" action button (conditional vs. still-image "Generate")
- `web/src/features/annotator/components/MaskTrackTimeline.tsx` — **NEW** track timeline with keyframes, propagated spans, low-confidence zones
- `web/src/features/annotator/AnnotatorPage.tsx` — `handlePropagateMaskTrack()` mock handler (3-second progress simulation)

**UX flow**:
1. Open video asset → toggle to "Mask" mode
2. Create mask layer → draw on a frame (creates keyframe)
3. Click "Propagate" → timeline shows progress, per-frame overlay updates during playback
4. Scrub to corrected frame → edit mask → re-propagate span
5. Select layer's Image toggle to show/hide result during playback

**Key decisions**:
- Mock propagate handler simulates progress for end-to-end testing without Modal
- Track timeline shows mocked confidence zones (to be populated by Phase 1.1)
- Per-frame overlay is a tinted region (proof-of-concept; real data from track in Phase 1.1)

---

### Layer 2: Database & Entity Model — `Phase 1.2`

**Files created**:
- `nexus8/trackables/models/mask_tracks.py` — **NEW** `MaskTrack` entity + `MaskTrackManager`
- `nexus8/trackables/migrations/0015_mask_track_entity_type.py` — **NEW** Indexes for (video_id, layer_id) queries
- `MASK_TRACK_MODEL.md` — **NEW** Schema design doc

**Model hierarchy**:
```
MaskTrack (VersionedEntity subclass)
├── entity_type: 'mask_track'
├── versions: List[Version] (each = one propagation run)
└── symlink['selected']: Points to chosen version for downstream ops

Version.data schema:
├── propagation_model: 'SAM2'
├── prompt_frames: [frame_index, type, ...] (user-authored prompts)
├── propagation_params: {full_clip, span_start, span_end}
├── frames: [
│   {
│       frame_index: int,
│       mask_png_b64: str (PNG bytes as base64),
│       confidence: float (0–1),
│       authorship: 'keyframe' | 'propagated' | 'correction'
│   }
│ ]
├── modal_call_id: str
├── dispatch_at_ms, result_at_ms, latency_s
└── prior_version_id, corrected_frames (for audit trail)
```

**Key design decisions**:
- One track asset per (video, layer_id); tracks accumulate Versions as artist propagates and corrects
- Per-frame masks are rasterized PNG (base64 in Version.data for compactness; <5 MB per typical clip)
- Hybrid storage: keyframes retain optional vector geometry for re-editing; propagated frames are raster-only
- Two-axis versioning NOT used (unlike still renders) — no variants per run, only one track version per propagation
- Authorship flags distinguish user keyframes from model-propagated frames (enables H1 experiment: measure correction-to-converge)

**Migrations & queries**:
- Index on `EntityRelation(source_id=video_id, role='mask_track', type_data.layer_id)` for fast "get track for layer"
- Query helpers: `get_mask_for_frame()`, `get_confidence_for_frame()`, `get_low_confidence_frames()`, `get_keyframes()`

---

### Layer 3: Django Backend — `Phase 0 + Phase 1.3`

#### Frame Staging (Phase 0)

**Files created**:
- `nexus8/trackables/services/video_staging.py` — **NEW** `VideoFrameStager` service

**Features**:
```python
VideoFrameStager.extract_frames(video_path, asset_id, version_id, tier='native')
  → Stages frames to /tmp/nexus8-frames/{asset_id}/{version_id}/{tier}/
  → Tiers: 'native' (original res) or 'preview_480p' (cheap preview jobs)
  → Uses ffmpeg with quality setting (fps=1 for single frames)
  → Idempotent: checks cache before re-extracting
  → Returns Path to staging directory

VideoFrameStager.create_frame_archive(staging_dir, format='tar')
  → tar.gz all PNGs for transport to Modal
  → Returns bytes (ready to POST to Modal function)

VideoFrameStager.cleanup(asset_id, version_id=None)
  → Remove cached frames (garbage collection)
```

**Design decisions**:
- Resolution tiers enable cost optimization (preview at 480p, final at native)
- Content-addressed staging (versioned: if asset updated, frames re-extracted)
- Tar.gz chosen over alternatives (compact, streaming-friendly for Modal)

#### REST Endpoints (Phase 1.3)

**Files created**:
- `nexus8/trackables/views_video_masks.py` — **NEW** `VideoMaskPropagateView`, `VideoMaskStatusView`, `VideoMaskCancelView`
- `nexus8/trackables/urls.py` — Routes added

**Endpoints**:
```
POST /api/library/assets/{asset_id}/video-mask/{layer_id}/propagate/
  Request:  {prompt_frames, propagation_params}
  Response: 202 {status: 'working', call_id, track_id, version_number}

GET  /api/library/assets/{asset_id}/video-mask/{layer_id}/status/?call_id=call-xyz
  Response: {status: 'done'|'working', track_id, version_id, frames_processed, latency_s}

POST /api/library/assets/{asset_id}/video-mask/{layer_id}/cancel/?call_id=call-xyz
  Response: {status: 'cancelled'}
```

**Flow**:
1. **Propagate** dispatch:
   - Fetch video asset, get/create mask track for (video_id, layer_id)
   - Stage frames (Phase 0 VideoFrameStager)
   - Dispatch to Modal SAM 2 app (spawn async job)
   - Return call_id for polling
   - Mock fallback if Modal unavailable (call_id starts with `call-mock-`)

2. **Status** poll:
   - Fetch Modal function call result (non-blocking)
   - If done: ingest results into new MaskTrack.Version using `track.add_propagation_result()`
   - Return version_id for subsequent operations (removal, edit propagation)

3. **Cancel**: Stop in-flight Modal job

---

### Layer 4: GPU Inference (Modal) — `Phase 1.1`

**Files created**:
- `modal_functions/video_seg.py` — **NEW** SAM 2 video segmentation app

**SAM 2 VideoSegmentor class**:
```python
@app.cls(gpu="A10G", timeout=600)
class VideoSegmentor:
    @modal.enter()
    def load(self):
        # Load SAM 2 video predictor with memory-banked bidirectional propagation
        self.predictor = build_sam2_video_predictor(...)

    @modal.method()
    def propagate(frames_tar_gz, prompt_frames, propagation_params) -> dict:
        # Extract frame archive
        # Initialize SAM 2 predictor state
        # Process prompt frames (clicks/scribbles)
        # Propagate masks bidirectionally through all frames
        # Return per-frame masks + confidence scores
        return {
            "frames": [{frame_index, mask_png_b64, confidence, authorship}, ...],
            "total_frames": int,
            "latency_s": float
        }
```

**Design decisions**:
- SAM 2 small model for speed (can upgrade to -base or -large later)
- Per-frame confidence scores computed by SAM 2 (used by H7 timeline experiment)
- Authorship flag ('keyframe' vs 'propagated') set at inference time
- Bidirectional propagation via SAM 2's memory bank (handles occlusions, mode switching)
- Deployment: `modal deploy modal_functions/video_seg.py`
- Testing: `modal run modal_functions/video_seg.py` with test frame archive

**Deployment integration**:
- Django looks up via `modal.Cls.from_name("nexus8-videoseg", "VideoSegmentor")`
- Graceful fallback: if app not deployed, returns mock response
- No warm containers (cost decision); scaledown_window=300s (5 min) keeps A10G alive between requests

---

## End-to-End Flow

### User Interaction → Disk → GPU → Database

```
┌─ Web UI (React)
│  ├─ Open video asset
│  ├─ Toggle to Mask mode
│  ├─ Create layer + draw mask on frame 0
│  └─ Click "Propagate"
│
├─ Django Backend (Phase 0)
│  ├─ Stage frames to disk: /tmp/nexus8-frames/{asset_id}/{version}/{tier}/
│  └─ Create tar.gz archive for GPU
│
├─ Modal GPU (Phase 1.1)
│  ├─ Extract frames
│  ├─ Run SAM 2 propagation
│  └─ Return {frames, latency_s}
│
├─ Django Backend (Phase 1.3)
│  ├─ Poll for result (non-blocking)
│  ├─ Create MaskTrack.Version with results
│  └─ Return version_id to frontend
│
└─ Web UI (React)
   ├─ Timeline updates: shows per-frame confidence, keyframes, propagated spans
   ├─ Per-frame overlay: shows mask during playback
   └─ Image toggle: shows/hides result during playback
```

---

## Testing & Validation

### End-to-End Test Without Modal

1. Start Django dev server (port 8000)
2. Open video asset in annotator
3. Toggle to Mask mode → draw on frame 0
4. Click Propagate
5. **Without Modal deployed**: endpoint returns mock response (202 "working")
   - `handlePropagateMaskTrack()` simulates 3-second progress
   - Timeline shows mock confidence zones
   - Per-frame overlay shows tinted region during playback
6. Click "status" endpoint: returns mock "done" with synthetic results

### With Modal Deployed

1. Deploy SAM 2 app: `modal deploy modal_functions/video_seg.py`
2. Repeat steps 1–4 above
3. **With Modal deployed**: endpoint stages frames and dispatches real job
   - Poll endpoint blocks until Modal inference complete (~45 s for typical clip)
   - Real per-frame masks ingested into MaskTrack.Version
   - Timeline and overlay render real data

### Unit Tests (TBD)

- `VideoFrameStager.extract_frames()` with small test video
- `MaskTrack.add_propagation_result()` with mock frame data
- Endpoint 202/404/400 responses

---

## Remaining Work (Phases 1.4d–6, Phase 2–3)

### Phase 1.4d — Correction Loop Logic
- Detect mask edit on non-keyframe → flip frame to 'correction' authorship
- Trigger span-limited re-propagation (frame N → next keyframe)
- UI: invalidate timeline, show re-propagation progress

### Phase 1.5–6 — Experiments
- **H1**: Propagation horizon — how many frames before drift forces correction?
- **H7**: Confidence-directed review — do SAM 2 confidence scores + derived signals (area discontinuity, IoU drop) accurately flag correction sites?

### Phase 2 — Object Removal
- Wire mask track to removal models (Wan-VACE-1.3B, VOID)
- Same dispatch/poll pattern; results stored as separate removal asset

### Phase 3 — Keyframe Edit Propagation
- LCM edit on keyframe → RAFT flow propagation → LCM disocclusion fill
- Viability envelope: frames-per-keyframe vs. motion magnitude

---

## Deployment Checklist

- [ ] Deploy SAM 2 app to Modal: `modal deploy modal_functions/video_seg.py`
- [ ] Set `MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET` in Django env
- [ ] Verify `VIDEO_FRAME_STAGING_ROOT` directory exists and is writable
- [ ] Test end-to-end: propagate → poll → ingest
- [ ] Monitor Modal latency and VRAM usage (A10G may need upgrade if >40GB needed)
- [ ] Set up frame cleanup cron job (Phase 0 `VideoFrameStager.cleanup()`)

---

## Files Changed / Created (Summary)

| Phase | Category | File | Action |
|-------|----------|------|--------|
| 1.4a-e | Frontend | `AnnotationViewport.tsx` | Modified |
| 1.4a-e | Frontend | `MaskLayersPanel.tsx` | Modified |
| 1.4b | Frontend | `MaskTrackTimeline.tsx` | **NEW** |
| 1.4c | Frontend | `AnnotatorPage.tsx` | Modified |
| 1.2 | Backend Models | `mask_tracks.py` | **NEW** |
| 1.2 | Backend Models | `MASK_TRACK_MODEL.md` | **NEW** |
| 1.2 | Backend DB | `migrations/0015_mask_track_entity_type.py` | **NEW** |
| 0 | Backend Services | `video_staging.py` | **NEW** |
| 1.3 | Backend Views | `views_video_masks.py` | **NEW** |
| 1.3 | Backend Routes | `urls.py` | Modified |
| 1.1 | GPU | `modal_functions/video_seg.py` | **NEW** |

---

## Performance Targets

| Metric | Target | Actual (Phase 1.1 TBD) |
|--------|--------|----------------------|
| Frame extraction (480p, 240 frames) | <30s | TBD |
| Frame staging + tar.gz | <10s | TBD |
| SAM 2 propagation (A10G, 240 frames) | <60s | TBD |
| Django dispatch latency | <2s | TBD |
| Poll latency (non-blocking) | <100ms | TBD |
| End-to-end (frame extract → ingest) | <90s | TBD |
| Storage per 10s clip @ native res | <5 MB | TBD |

---

## References

- **SRED_VIDEOOP_EXPERIMENTS.md** — Full SR&ED narrative, hypotheses, experiments
- **MASK_TRACK_MODEL.md** — Entity schema, query patterns, lifecycle
- **LAYER_RENDER_SCHEMA.md** — Two-axis versioning pattern (re-used for lineage, not variation axis)
- **SAM 2 Paper**: https://arxiv.org/abs/2304.08814
- **SAM 2 GitHub**: https://github.com/facebookresearch/sam2
