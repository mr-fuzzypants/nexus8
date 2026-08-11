import { http } from './library'

export interface PromptClick {
  x: number
  y: number
  positive: boolean
}

export interface PromptFrame {
  frame_index: number
  type: 'click' | 'mask'
  /** Present for type 'click' — positive/negative point prompts. */
  clicks?: PromptClick[]
  /** Present for type 'mask' — base64 PNG (white=object) at source_size resolution. */
  mask_b64?: string
}

export interface PropagateRequest {
  prompt_frames: PromptFrame[]
  propagation_params: {
    full_clip?: boolean
    span_start?: number
    span_end?: number
  }
  layer_name?: string
  layer_color?: string
  /** Native pixel dimensions the click coordinates are expressed in. The backend
   *  rescales clicks to the staged (downscaled) frame size SAM 2 actually sees. */
  source_size?: { width: number; height: number }
  /** Staging resolution tier: 'preview_480p' | 'preview_720p' | 'native'. Higher
   *  preserves fine mask detail at higher upload/GPU cost. */
  staging_tier?: string
  /** Chaining (Phase 3): operate on this layer's removal take (a derived clip)
   *  instead of the library asset. Spans/coords stay source-based; the backend
   *  rebases once at frame extraction. */
  chain_source?: { layer_id: string; run: number }
  /** The chained layer's source layer id, persisted on the track relation so
   *  the layer restores with its chain binding after reload. */
  layer_source_layer_id?: string
}

/** One take of a mask track — a version selectable in the Mask row. */
export interface MaskTrackVersionSummary {
  version_id: string
  version_number: number
  /** 'SAM2' | 'manual' | … */
  model: string | null
  /** From-scratch hand-painted version (no GPU). */
  manual?: boolean
  /** Hand-painted frames overlaid on a prior version (no GPU). */
  manual_correction?: boolean
  /** SAM correction run (span-limited re-propagation merge). */
  corrected?: boolean
  fill_policy?: string | null
  span_start: number
  span_end: number
  frame_count: number
  created_at: string
  /** True for the pinned take (the 'selected' symlink). */
  selected: boolean
  /** The values this run was made with — per-take provenance for the UI. */
  params?: Record<string, unknown>
}

export interface MaskTrackSummary {
  layer_id: string
  layer_name: string | null
  layer_color: string | null
  /** Chained layer: the layer whose removal output this layer operates on. */
  source_layer_id?: string | null
  version_id: string
  span_start: number
  span_end: number
  keyframes: number[]
  low_confidence_frames: number[]
  versions?: MaskTrackVersionSummary[]
}

/** All mask tracks for a video — the durable anchor for restoring layers on load. */
export async function listMaskTracks(assetId: number): Promise<MaskTrackSummary[]> {
  const { data } = await http.get<{ tracks: MaskTrackSummary[] }>(
    `/trackables/api/library/assets/${assetId}/video-masks/`,
  )
  return data.tracks
}

export interface PropagateResponse {
  status: 'working'
  call_id: string
  track_id: string
  version_number: number
  dispatch_at_ms: number
  span_start?: number
  span_end?: number
}

export interface MaskTrackStatusResponse {
  status: 'working' | 'done' | 'failed'
  progress?: string
  elapsed_s?: number
  call_id?: string
  track_id?: string
  version_id?: string
  frames_processed?: number
  latency_s?: number
  error?: string
}

export async function propagateMaskTrack(
  assetId: number,
  layerId: string,
  body: PropagateRequest,
): Promise<PropagateResponse> {
  const { data } = await http.post<PropagateResponse>(
    `/trackables/api/library/assets/${assetId}/video-mask/${layerId}/propagate/`,
    body,
  )
  return data
}

export async function getMaskTrackStatus(
  assetId: number,
  layerId: string,
  callId: string,
  dispatchAtMs?: number,
  spanStart?: number,
  correction?: boolean,
): Promise<MaskTrackStatusResponse> {
  const { data } = await http.get<MaskTrackStatusResponse>(
    `/trackables/api/library/assets/${assetId}/video-mask/${layerId}/status/`,
    { params: { call_id: callId, dispatch_at_ms: dispatchAtMs, span_start: spanStart, correction: correction ? 1 : undefined } },
  )
  return data
}

export interface MaskTrackInfo {
  exists: boolean
  version_id?: string
  version_number?: number
  span_start?: number
  span_end?: number
  keyframes?: number[]
  low_confidence_frames?: number[]
  versions?: MaskTrackVersionSummary[]
}

/** Persisted track state for a layer, so the timeline can rehydrate on reload. */
export async function getMaskTrackInfo(
  assetId: number,
  layerId: string,
): Promise<MaskTrackInfo> {
  const { data } = await http.get<MaskTrackInfo>(
    `/trackables/api/library/assets/${assetId}/video-mask/${layerId}/`,
  )
  return data
}

/** URL for a single frame's mask as a tintable RGBA PNG. Loadable via <img>
 *  (cookie/session auth, same-origin). `version` busts the cache after a
 *  re-propagation produces a new track version. */
export function maskFrameUrl(
  assetId: number,
  layerId: string,
  frame: number,
  version = 0,
): string {
  return `/trackables/api/library/assets/${assetId}/video-mask/${layerId}/mask/?frame=${frame}&v=${version}`
}

export interface PreviewMaskResponse {
  /** RGBA PNG b64, alpha = object — tintable for display, usable as mask prompt.
   *  Null when no mask could be produced (negative-only clicks with no live
   *  propagation session to correct against). */
  mask_b64: string | null
  score?: number | null
  latency_s?: number | null
  /** True when the mask was refined against the retained propagation state
   *  (demo-style correction) rather than solved statelessly from clicks. */
  conditioned?: boolean
}

/** Interactive prompt-frame preview: clicks on one frame → that frame's mask. */
export async function previewMask(
  assetId: number,
  layerId: string,
  body: {
    frame_index: number
    clicks: PromptClick[]
    source_size?: { width: number; height: number }
    staging_tier?: string
    /** span_start of the layer's last propagation — asks the backend to click
     *  against the retained session so the propagated mask conditions the result. */
    session_span_start?: number
    /** Chaining: preview against this layer's removal take, not the source. */
    chain_source?: { layer_id: string; run: number }
  },
): Promise<PreviewMaskResponse> {
  const { data } = await http.post<PreviewMaskResponse>(
    `/trackables/api/library/assets/${assetId}/video-mask/${layerId}/preview/`,
    body,
  )
  return data
}

/** Bake hand-painted masks into a track version — no GPU job. Without
 *  base_version_id, creates a from-scratch 'manual' version (hold-until-next-
 *  keyframe fill). With base_version_id, the painted frames overlay that
 *  version's frames as deterministic corrections. */
export async function bakeManualMask(
  assetId: number,
  layerId: string,
  body: {
    /** Per-frame rasters: RGBA (alpha = object) or grayscale PNGs, native res. */
    frames: { frame_index: number; mask_png_b64: string }[]
    fill_policy?: 'hold' | 'none'
    span?: { start: number; end: number }
    base_version_id?: string
    layer_name?: string
    layer_color?: string
    /** Chained layer: persist its source binding on the track relation. */
    layer_source_layer_id?: string
  },
): Promise<{
  track_id: string
  version_id: string
  version_number: number
  frames_baked: number
  versions: MaskTrackVersionSummary[]
}> {
  const { data } = await http.post(
    `/trackables/api/library/assets/${assetId}/video-mask/${layerId}/manual/`,
    body,
  )
  return data
}

/** Pin a mask take: the version the overlay serves and removal consumes. */
export async function selectMaskTrackVersion(
  assetId: number,
  layerId: string,
  versionId: string,
): Promise<{ status: string; version_id: string; version_number: number }> {
  const { data } = await http.post(
    `/trackables/api/library/assets/${assetId}/video-mask/${layerId}/select/`,
    { version_id: versionId },
  )
  return data
}

/** Unlink a layer's mask track so it no longer restores on reload. With
 *  `purge`, also permanently delete the stored mask data (all versions). */
export async function deleteMaskTrack(
  assetId: number,
  layerId: string,
  purge: boolean,
): Promise<{ deleted: boolean; purged: number }> {
  const { data } = await http.delete<{ deleted: boolean; purged: number }>(
    `/trackables/api/library/assets/${assetId}/video-mask/${layerId}/`,
    { params: purge ? { purge: 1 } : undefined },
  )
  return data
}

export async function cancelMaskTrack(
  assetId: number,
  layerId: string,
  callId: string,
): Promise<void> {
  await http.post(
    `/trackables/api/library/assets/${assetId}/video-mask/${layerId}/cancel/`,
    null,
    { params: { call_id: callId } },
  )
}
