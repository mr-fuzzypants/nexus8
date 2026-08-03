import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useLocation, useSearch } from 'wouter'
import { useQuery } from '@tanstack/react-query'
import * as Y from 'yjs'
import { assetIs3DModel, assetIsVideo, type AssetSummary } from '../../api/library'
import { createAssetViewerAdapter } from '../viewer/createAssetAdapter'
import { AnnotationViewport } from './components/AnnotationViewport'
import {
  DEFAULT_FREEHAND_PIPELINE_OPTIONS,
  type FreehandPipelineOptions,
} from './core/annotations/freehandPipeline'
import { framePointToWorld } from './core/annotations/geometry'
import type {
  AnnotationDocumentSnapshot,
  AnnotationEntity,
  AnnotationTool,
  CollaborationProfile,
  ParticipantState,
} from './core/annotations/types'
import { BroadcastCollaborationRoom } from './core/collaboration/broadcast'
import type { ViewerAdapter } from './core/viewers/adapters'
import {
  getAsset,
  getEraseStatus,
  getInpaintStatus,
  getOrCreateAnnotationDoc,
  getScribbleStatus,
  getSelectedRenders,
  saveDocState,
  saveMask,
  snapshotAnnotationDoc,
  triggerErase,
  triggerInpaint,
  triggerScribble,
  triggerScribbleDraft,
  triggerSketchInpaint,
  getSketchInpaintStatus,
  type AnnotationDoc,
} from './annotatorApi'
import { getVersionHistory } from '../../api/versions'
import { propagateMaskTrack, getMaskTrackStatus, listMaskTracks } from '../../api/videoMasks'
import { isMaskShape, rasterizeMask, rasterizeScribble, rasterizeSketchInpaintGuide } from './rasterizeMask'
import { computeMaskBounds } from './maskBounds'
import { MaskLayersPanel } from './components/MaskLayersPanel'
import { MaskLayerDetailPanel } from './components/MaskLayerDetailPanel'
import { RenderHistoryPanel } from './components/RenderHistoryPanel'
import { DEFAULT_LAYER_ID } from './core/annotations/types'
import type { AnnotationLayer } from './core/annotations/types'
import './annotator.css'

const PROFILE_COLORS = ['#5eead4', '#f97316', '#60a5fa', '#f472b6', '#a78bfa', '#facc15']
// Live-inpaint pacing: debounce after stroke commit, then poll the dispatch.
// 500ms polling (not tighter) — inference is ≥1.5s so faster polling only adds chatter.
const LIVE_DEBOUNCE_MS = 400
const POLL_INTERVAL_MS = 500
const LIVE_GEN_TIMEOUT_MS = 90_000
const MASK_LAYER_COLORS = ['#f97316', '#a78bfa', '#34d399', '#f472b6', '#60a5fa', '#facc15', '#fb923c', '#e879f9']
const PROFILE_STORAGE_KEY = 'nexus8-annotator-profile'
const MASK_SIDEBAR_WIDTH_KEY = 'nexus8-annotator-mask-sidebar-width'
const MASK_SIDEBAR_MIN = 220
const MASK_SIDEBAR_MAX = 720
const MASK_SIDEBAR_DEFAULT = 440
function hashString(value: string) {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0
  }
  return hash
}

/** Stable per-browser identity so collaborators are distinguishable across tabs and reloads. */
function loadProfile(): CollaborationProfile {
  try {
    const stored = localStorage.getItem(PROFILE_STORAGE_KEY)
    if (stored) {
      return JSON.parse(stored) as CollaborationProfile
    }
  } catch {
    // fall through to create a fresh profile
  }
  const id = crypto.randomUUID()
  const profile: CollaborationProfile = {
    id,
    name: `You ${id.slice(0, 4)}`,
    color: PROFILE_COLORS[hashString(id) % PROFILE_COLORS.length],
  }
  try {
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile))
  } catch {
    // ignore storage failures (private mode, etc.)
  }
  return profile
}

/** Resolve an image's pixel size, decoding it if the asset metadata lacks dimensions. */
function loadImageSize(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => resolve(null)
    image.src = url
  })
}

function fromBase64(serialized: string) {
  const binary = atob(serialized)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function toBase64(data: Uint8Array) {
  let binary = ''
  data.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary)
}

export default function AnnotatorPage({ params }: { params: { code: string; assetId: string } }) {
  const assetId = Number(params.assetId)
  const search = useSearch()
  const versionParam = new URLSearchParams(search).get('version')
  const pinnedVersionNumber = versionParam != null ? Number(versionParam) : null
  const [, navigate] = useLocation()
  const back = () => navigate(`/p/${params.code}`)

  const assetQuery = useQuery({
    queryKey: ['annotator', 'asset', assetId],
    queryFn: () => getAsset(assetId),
    enabled: Number.isFinite(assetId),
  })
  const docQuery = useQuery({
    queryKey: ['annotator', 'doc', assetId, pinnedVersionNumber],
    queryFn: () => getOrCreateAnnotationDoc(assetId, pinnedVersionNumber),
    enabled: Number.isFinite(assetId),
  })
  // Only fetch version history when opening from a specific version row.
  const versionHistoryQuery = useQuery({
    queryKey: ['annotator', 'versions', assetId],
    queryFn: () => getVersionHistory(assetId),
    enabled: Number.isFinite(assetId) && pinnedVersionNumber != null,
  })

  const isLoading =
    assetQuery.isLoading ||
    docQuery.isLoading ||
    (pinnedVersionNumber != null && versionHistoryQuery.isLoading)

  if (isLoading) {
    return (
      <div className="annotator-page">
        <button className="annotator-page__action" onClick={back}>
          ← Back
        </button>
        <p style={{ color: 'rgba(226,232,240,0.7)' }}>Loading annotator…</p>
      </div>
    )
  }

  if (assetQuery.isError || !assetQuery.data || docQuery.isError || !docQuery.data) {
    return (
      <div className="annotator-page">
        <button className="annotator-page__action" onClick={back}>
          ← Back
        </button>
        <p style={{ color: '#fda4af' }}>Could not load this asset for annotation.</p>
      </div>
    )
  }

  // If a specific version was requested, use that version's file_path so the
  // viewer shows the correct image (not the current/latest one).
  const pinnedVersion =
    pinnedVersionNumber != null
      ? versionHistoryQuery.data?.versions.find((v) => v.version_number === pinnedVersionNumber)
      : undefined
  const asset = pinnedVersion
    ? { ...assetQuery.data, file_path: pinnedVersion.file_path }
    : assetQuery.data

  return (
    <AnnotatorWorkspace
      asset={asset}
      doc={docQuery.data}
      versionNumber={pinnedVersion?.version_number ?? asset.latest_version_number ?? undefined}
      onBack={back}
    />
  )
}

function AnnotatorWorkspace({
  asset,
  doc,
  versionNumber,
  onBack,
}: {
  asset: AssetSummary
  doc: AnnotationDoc
  versionNumber?: number
  onBack: () => void
}) {
  const [profile] = useState(loadProfile)
  const [engine, setEngine] = useState<{ room: BroadcastCollaborationRoom; adapter: ViewerAdapter } | null>(
    null,
  )
  const [snapshot, setSnapshot] = useState<AnnotationDocumentSnapshot | null>(null)
  const [participants, setParticipants] = useState<ParticipantState[]>([])
  const [activeTool, setActiveTool] = useState<AnnotationTool>('select')
  const [selectedId, setSelectedId] = useState<string>()
  const [textValue] = useState('Note')
  const [freehandPipelineOptions] = useState<FreehandPipelineOptions>(
    DEFAULT_FREEHAND_PIPELINE_OPTIONS,
  )
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [snapshotState, setSnapshotState] = useState<'idle' | 'working' | string>('idle')
  const [annotatorMode, setAnnotatorMode] = useState<'annotate' | 'mask'>('annotate')
  const [activeMaskLayerId, setActiveMaskLayerId] = useState<string | null>(null)
  const [maskGenerateState, setMaskGenerateState] = useState<Record<string, 'idle' | 'working' | string>>({})
  // Per-layer keyframes (frame indices where user drew a mask stroke) and propagated segments.
  // Keyframes are added when onMaskStrokeCommitted fires with a frameIndex on video.
  // Segments are set after propagation completes (mock or real).
  const [maskTrackKeyframes, setMaskTrackKeyframes] = useState<Record<string, number[]>>({})
  const [maskTrackSegments, setMaskTrackSegments] = useState<Record<string, Array<{startFrame: number; endFrame: number; type: 'propagated' | 'lowConfidence'}>>>({})
  // User-selected propagation span (absolute frame indices). null → backend
  // auto-scopes. Persisted per-asset in localStorage so it survives reloads.
  const [maskSpan, setMaskSpan] = useState<{ start: number; end: number } | null>(() => {
    try {
      const raw = localStorage.getItem(`nexus8.maskSpan.${asset.id}`)
      if (!raw) return null
      const parsed = JSON.parse(raw)
      return typeof parsed?.start === 'number' && typeof parsed?.end === 'number' ? parsed : null
    } catch {
      return null
    }
  })
  useEffect(() => {
    try {
      const key = `nexus8.maskSpan.${asset.id}`
      if (maskSpan) localStorage.setItem(key, JSON.stringify(maskSpan))
      else localStorage.removeItem(key)
    } catch {
      // Storage unavailable (private mode etc.) — span stays session-only.
    }
  }, [maskSpan, asset.id])
  // Layers with a propagated mask track; `version` bumps per re-propagation to bust the image cache.
  const [videoMaskTracks, setVideoMaskTracks] = useState<Record<string, { version: number }>>({})
  // Guards the one-time mask-track seeding per asset (see rehydration effect below).
  const maskSeededRef = useRef<string | null>(null)
  // Sidebar tab below the layers list: parameter controls vs render history.
  const [sidebarTab, setSidebarTab] = useState<'params' | 'history'>('params')
  const [previewMode, setPreviewMode] = useState(false)
  const [imageDims, setImageDims] = useState<{ width: number; height: number } | null>(null)
  const [liveGenEnabled, setLiveGenEnabled] = useState(false)
  const [liveGenStatus, setLiveGenStatus] = useState<{
    phase: 'idle' | 'saving' | 'generating' | 'error'
    latencyS?: number
    message?: string
    seedUsed?: number
  }>({ phase: 'idle' })
  const [livePreviewImage, setLivePreviewImage] = useState<HTMLImageElement | null>(null)
  const [livePreviewIsScribble, setLivePreviewIsScribble] = useState(false)
  // When previewing a stored render from History: that run's own mask_dims,
  // so the overlay border shows the region the render actually regenerated
  // rather than the layer's current strokes. Null for live results.
  const [livePreviewRegion, setLivePreviewRegion] = useState<{
    x: number
    y: number
    w: number
    h: number
  } | null>(null)
  // Batch generation variants: populated when a run returns >1 image. The strip
  // lets the user pick which variant shows as the live preview overlay.
  const [liveVariants, setLiveVariants] = useState<{ img: HTMLImageElement; seed?: number }[]>([])
  const [liveVariantIndex, setLiveVariantIndex] = useState(0)
  const liveDebounceRef = useRef<number | null>(null)
  const livePollTimerRef = useRef<number | null>(null)
  // AbortController for the currently in-flight mask propagation job (one at a time).
  const propagationAbortRef = useRef<AbortController | null>(null)
  // Object URL of the current draft preview — revoked when the next draft replaces it.
  const draftUrlRef = useRef<string | null>(null)
  // Monotonic generation counter: bumping it aborts in-flight debounce/poll work
  // and marks any late-arriving results as stale (SRED H6 invalidation).
  const liveGenerationRef = useRef(0)
  // Bumped when a generation completes or a selection moves, so the render
  // history grid and the selected-render composite both refetch.
  const [renderHistoryKey, setRenderHistoryKey] = useState(0)
  // Each layer's pinned render, decoded and ready for the canvas composite.
  // Region is the run's mask_dims (the area it regenerated); null = full frame.
  const [layerRenderMap, setLayerRenderMap] = useState<
    Record<string, { img: HTMLImageElement; region: { x: number; y: number; w: number; h: number } | null }>
  >({})
  // Bumped when a history recipe is applied so the detail panel's local
  // slider state re-syncs from the updated layer.
  const [paramsAppliedKey, setParamsAppliedKey] = useState(0)
  const [maskSidebarWidth, setMaskSidebarWidth] = useState(() => {
    try {
      const stored = Number(localStorage.getItem(MASK_SIDEBAR_WIDTH_KEY))
      if (Number.isFinite(stored) && stored >= MASK_SIDEBAR_MIN && stored <= MASK_SIDEBAR_MAX) {
        return stored
      }
    } catch {
      // ignore storage failures (private mode, etc.)
    }
    return MASK_SIDEBAR_DEFAULT
  })

  function startMaskSidebarResize(e: React.PointerEvent) {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = maskSidebarWidth
    const clampWidth = (clientX: number) =>
      Math.min(MASK_SIDEBAR_MAX, Math.max(MASK_SIDEBAR_MIN, startWidth + (startX - clientX)))
    const onMove = (ev: PointerEvent) => setMaskSidebarWidth(clampWidth(ev.clientX))
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      try {
        localStorage.setItem(MASK_SIDEBAR_WIDTH_KEY, String(clampWidth(ev.clientX)))
      } catch {
        // ignore storage failures
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }
  const prevGenPhaseRef = useRef<string>('idle')
  useEffect(() => {
    if (prevGenPhaseRef.current === 'generating' && liveGenStatus.phase === 'idle') {
      setRenderHistoryKey((k) => k + 1)
    }
    prevGenPhaseRef.current = liveGenStatus.phase
  }, [liveGenStatus.phase])

  useEffect(() => {
    let cancelled = false
    if (asset.width && asset.height) {
      setImageDims({ width: asset.width, height: asset.height })
      return
    }
    if (asset.file_path) {
      loadImageSize(asset.file_path).then((dims) => {
        if (!cancelled && dims) {
          setImageDims(dims)
        }
      })
    }
    return () => {
      cancelled = true
    }
  }, [asset])

  // Selected-render composite inputs: fetched per asset, refreshed whenever a
  // generation completes or the selection moves (renderHistoryKey bumps).
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const records = await getSelectedRenders(asset.id)
        const entries = await Promise.all(
          records.map(async (record) => {
            if (!record.file_path) return null
            const img = await loadImageElement(record.file_path)
            if (!img) return null
            const region =
              (record.generation?.mask_dims as
                | { x: number; y: number; w: number; h: number }
                | undefined) ?? null
            return [record.layer_id, { img, region }] as const
          }),
        )
        if (!cancelled) {
          setLayerRenderMap(
            Object.fromEntries(entries.filter((entry) => entry != null)),
          )
        }
      } catch {
        // The composite is an enhancement — a failed fetch just leaves it empty.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [asset.id, renderHistoryKey])

  function invalidateLiveGeneration() {
    liveGenerationRef.current += 1
    if (liveDebounceRef.current != null) {
      window.clearTimeout(liveDebounceRef.current)
      liveDebounceRef.current = null
    }
    if (livePollTimerRef.current != null) {
      window.clearTimeout(livePollTimerRef.current)
      livePollTimerRef.current = null
    }
    setLivePreviewIsScribble(false)
    setLivePreviewImage((prev) => (prev ? null : prev))
    setLivePreviewRegion((prev) => (prev ? null : prev))
    setLiveVariants((prev) => (prev.length ? [] : prev))
    setLiveVariantIndex(0)
    setLiveGenStatus((prev) =>
      prev.phase !== 'idle' || prev.latencyS != null || prev.seedUsed != null
        ? { phase: 'idle' }
        : prev,
    )
  }

  // Stale overlays never survive a layer switch; timers never survive unmount.
  useEffect(() => {
    invalidateLiveGeneration()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMaskLayerId])
  useEffect(
    () => () => {
      if (liveDebounceRef.current != null) window.clearTimeout(liveDebounceRef.current)
      if (livePollTimerRef.current != null) window.clearTimeout(livePollTimerRef.current)
      propagationAbortRef.current?.abort()
    },
    [],
  )

  // Create the viewer adapter + collaboration room inside the effect so it is
  // StrictMode-safe (created and destroyed together, recreated on remount).
  const isVideo = assetIsVideo(asset)
  const is3DModel = !isVideo && assetIs3DModel(asset)

  useEffect(() => {
    // Image, video, and 3D-model annotations share the same per-asset targetId so
    // a single annotation doc round-trips regardless of which viewer opened it.
    const targetId = `asset-${asset.id}`
    let disposed = false
    let unsubStore = () => {}
    let unsubParticipants = () => {}

    const room = new BroadcastCollaborationRoom(doc.room_id, profile)
    if (doc.doc_state) {
      try {
        Y.applyUpdate(room.doc, fromBase64(doc.doc_state), 'server-hydrate')
      } catch {
        // ignore malformed persisted state
      }
    }
    room.setLocalProfile(profile)

    const attach = (adapter: ViewerAdapter) => {
      if (disposed) {
        return
      }
      setEngine({ room, adapter })
      setSnapshot(room.store.getSnapshot())
      setParticipants(room.getParticipants())
      unsubStore = room.store.subscribe(() => setSnapshot(room.store.getSnapshot()))
      unsubParticipants = room.subscribeParticipants(() => setParticipants(room.getParticipants()))
    }

    // Viewer selection (and lazy-loading the heavy three.js adapter) lives in the
    // shared factory so the editing annotator and the read-only viewer agree.
    createAssetViewerAdapter({ asset, targetId, label: asset.name }).then(({ adapter }) => {
      attach(adapter)
    })

    return () => {
      disposed = true
      unsubStore()
      unsubParticipants()
      room.destroy()
      setEngine(null)
      setSnapshot(null)
    }
  }, [asset, doc.room_id, doc.doc_state, profile])

  // Rehydrate mask layers + timeline from the video's persisted TRACKS on load.
  // Layer ids in the Yjs doc churn across sessions, so a track keyed by an old
  // layer id would orphan. Anchoring on the track list (the durable source of
  // truth) lets us restore the layer if the doc lost it, then repopulate the
  // keyframe diamonds / propagated bar / mask overlay. Runs once per asset.
  // Declared BEFORE the early return below so hook order stays stable.
  useEffect(() => {
    if (!isVideo || !engine) return
    if (maskSeededRef.current === String(asset.id)) return
    maskSeededRef.current = String(asset.id)
    let cancelled = false
    void (async () => {
      try {
        const tracks = await listMaskTracks(asset.id)
        if (cancelled || tracks.length === 0) return
        const store = engine.room.store
        const existingById = new Map(store.getSnapshot().layers.map((l) => [l.id, l]))
        tracks.forEach((t, i) => {
          const existing = existingById.get(t.layer_id)
          if (!existing) {
            // The doc lost this layer — restore it so its strokes, timeline
            // markers and mask overlay reattach.
            store.upsertLayer({
              id: t.layer_id,
              name: t.layer_name || `Mask ${i + 1}`,
              visible: true,
              supportedSpaces: ['image2d'],
              color: t.layer_color || MASK_LAYER_COLORS[i % MASK_LAYER_COLORS.length],
              order: i,
            })
          } else if (!existing.visible) {
            // Layer survived but was hidden (selection hides non-active layers);
            // a layer with a persisted track must be visible to show its masks.
            store.upsertLayer({ ...existing, visible: true })
          }
          setMaskTrackKeyframes((prev) => {
            const merged = new Set([...(prev[t.layer_id] ?? []), ...t.keyframes])
            return { ...prev, [t.layer_id]: Array.from(merged).sort((a, b) => a - b) }
          })
          setMaskTrackSegments((prev) => ({
            ...prev,
            [t.layer_id]: [{ startFrame: t.span_start, endFrame: t.span_end, type: 'propagated' as const }],
          }))
          setVideoMaskTracks((prev) => ({
            ...prev,
            [t.layer_id]: { version: prev[t.layer_id]?.version ?? 1 },
          }))
        })
        // Focus a track layer so it stays visible (mask-mode selection hides
        // non-active layers). Keep the current active layer if it already has a
        // track; otherwise focus the first restored track layer.
        setActiveMaskLayerId((cur) =>
          cur && tracks.some((t) => t.layer_id === cur) ? cur : tracks[0].layer_id,
        )
      } catch {
        // No tracks for this video, or endpoint unreachable — leave timeline empty.
      }
    })()
    return () => { cancelled = true }
  }, [asset.id, isVideo, engine])

  // Keyframe diamonds derived from the PERSISTED strokes in the Yjs doc, so
  // drawn-but-not-yet-propagated masks keep their timeline markers across
  // reloads (onMaskStrokeCommitted state is session-only). Merged with the
  // track-derived keyframes below. Declared before the early return (hooks).
  const drawnMaskKeyframes = useMemo(() => {
    if (!isVideo || !snapshot) return {} as Record<string, number[]>
    const byLayer: Record<string, Set<number>> = {}
    for (const ann of snapshot.annotations) {
      if (!ann.maskRegion) continue
      const frame = ann.frame?.mediaBinding?.frame
      if (typeof frame !== 'number') continue
      ;(byLayer[ann.layerId] ??= new Set()).add(frame)
    }
    return Object.fromEntries(
      Object.entries(byLayer).map(([id, frames]) => [id, Array.from(frames).sort((a, b) => a - b)]),
    )
  }, [isVideo, snapshot])

  const mergedMaskKeyframes = useMemo(() => {
    const out: Record<string, number[]> = { ...maskTrackKeyframes }
    for (const [layerId, frames] of Object.entries(drawnMaskKeyframes)) {
      const merged = new Set([...(out[layerId] ?? []), ...frames])
      out[layerId] = Array.from(merged).sort((a, b) => a - b)
    }
    return out
  }, [maskTrackKeyframes, drawnMaskKeyframes])

  if (!engine || !snapshot) {
    return (
      <div className="annotator-page">
        <button className="annotator-page__action" onClick={onBack}>
          ← Back
        </button>
        <p style={{ color: 'rgba(226,232,240,0.7)' }}>Preparing canvas…</p>
      </div>
    )
  }

  const { room, adapter } = engine

  // Mask layers are all layers except the default annotation layer, sorted by order.
  const maskLayers = snapshot.layers.filter((l) => l.id !== DEFAULT_LAYER_ID)

  // Canvas composite: render-visible layers' pinned renders, bottom of the
  // panel first (higher `order`) so the top-of-panel layer draws last and wins
  // overlaps. The active layer drops out while an ephemeral live preview is
  // showing — the preview is that layer's current visual.
  const layerRenderComposite = maskLayers
    .filter((l) => l.render_visible !== false && layerRenderMap[l.id])
    .filter((l) => !(livePreviewImage && l.id === activeMaskLayerId))
    .sort((a, b) => (b.order ?? 0) - (a.order ?? 0))
    .map((l) => ({ layerId: l.id, ...layerRenderMap[l.id] }))

  const selectedAnnotation = snapshot.annotations.find((annotation) => annotation.id === selectedId)
  const activeSelectionId = selectedAnnotation ? selectedAnnotation.id : undefined

  function handleSelectMaskLayer(id: string) {
    setActiveMaskLayerId(id)
    maskLayers.forEach((layer) => {
      if (layer.id !== id && layer.visible) {
        room.store.upsertLayer({ ...layer, visible: false })
      }
      // Re-show the newly active layer's strokes — it may have been hidden
      // while inactive; the eye toggle controls this after selection.
      if (layer.id === id && !layer.visible) {
        room.store.upsertLayer({ ...layer, visible: true })
      }
    })
  }

  function handleAnnotatorModeChange(mode: 'annotate' | 'mask') {
    setAnnotatorMode(mode)
    if (mode === 'mask') {
      // Auto-create the first mask layer if none exist.
      if (maskLayers.length === 0) {
        const newLayer = createMaskLayer('Mask 1', 0, 0)
        room.store.upsertLayer(newLayer)
        setActiveMaskLayerId(newLayer.id)
      } else {
        const targetId = activeMaskLayerId && maskLayers.find((l) => l.id === activeMaskLayerId)
          ? activeMaskLayerId
          : maskLayers[0].id
        handleSelectMaskLayer(targetId)
      }
    }
  }

  function createMaskLayer(name: string, order: number, totalCount: number): AnnotationLayer {
    return {
      id: crypto.randomUUID(),
      name,
      visible: true,
      supportedSpaces: ['image2d'],
      color: MASK_LAYER_COLORS[totalCount % MASK_LAYER_COLORS.length],
      order,
    }
  }

  function handleAddMaskLayer() {
    const nextOrder = maskLayers.length > 0
      ? Math.max(...maskLayers.map((l) => l.order ?? 0)) + 1
      : 0
    const newLayer = createMaskLayer(`Mask ${maskLayers.length + 1}`, nextOrder, maskLayers.length)
    // Hide existing layers before adding; handleSelectMaskLayer iterates the
    // current maskLayers (pre-add) so the new layer isn't included yet.
    handleSelectMaskLayer(newLayer.id)
    room.store.upsertLayer(newLayer)
  }

  function handleRemoveMaskLayer(id: string) {
    room.store.removeLayer(id)
    if (activeMaskLayerId === id) {
      const remaining = maskLayers.filter((l) => l.id !== id)
      setActiveMaskLayerId(remaining.length > 0 ? remaining[0].id : null)
    }
    setMaskTrackKeyframes(({ [id]: _, ...rest }) => rest)
    setMaskTrackSegments(({ [id]: _, ...rest }) => rest)
  }

  function handleRenameMaskLayer(id: string, name: string) {
    const layer = maskLayers.find((l) => l.id === id)
    if (layer) {
      room.store.upsertLayer({ ...layer, name })
    }
  }

  function handleToggleLayerVisibility(id: string) {
    const layer = maskLayers.find((l) => l.id === id)
    if (layer) {
      room.store.upsertLayer({ ...layer, visible: !layer.visible })
    }
  }

  function handleToggleRenderVisibility(id: string) {
    const layer = maskLayers.find((l) => l.id === id)
    if (layer) {
      room.store.upsertLayer({ ...layer, render_visible: layer.render_visible === false })
    }
  }

  /** A History click re-pinned the star: drop any ephemeral preview overlay so
   *  the composite shows the new selection, then refetch. Leaves the live-gen
   *  counter alone — an in-flight run keeps polling and stores normally. */
  function handleRenderSelectionChanged() {
    setLivePreviewIsScribble(false)
    setLivePreviewImage(null)
    setLivePreviewRegion(null)
    setLiveVariants([])
    setLiveVariantIndex(0)
    setRenderHistoryKey((k) => k + 1)
  }

  function handleMoveMaskLayerUp(id: string) {
    const index = maskLayers.findIndex((l) => l.id === id)
    if (index <= 0) return
    const above = maskLayers[index - 1]
    const current = maskLayers[index]
    room.store.upsertLayer({ ...current, order: above.order ?? index - 1 })
    room.store.upsertLayer({ ...above, order: current.order ?? index })
  }

  function handleMoveMaskLayerDown(id: string) {
    const index = maskLayers.findIndex((l) => l.id === id)
    if (index === -1 || index >= maskLayers.length - 1) return
    const below = maskLayers[index + 1]
    const current = maskLayers[index]
    room.store.upsertLayer({ ...current, order: below.order ?? index + 1 })
    room.store.upsertLayer({ ...below, order: current.order ?? index })
  }

  function handleUpdateMaskLayer(id: string, fields: Partial<Pick<AnnotationLayer, 'mask_op' | 'prompt' | 'negative_prompt' | 'reference' | 'gen_mode' | 'controlnet_scale' | 'guidance_scale' | 'num_inference_steps' | 'scribble_scope' | 'seed' | 'num_variants' | 'denoise_strength' | 'reference_scale'>>) {
    const layer = maskLayers.find((l) => l.id === id)
    if (layer) {
      room.store.upsertLayer({ ...layer, ...fields })
    }
  }

  /** Replace a layer's mask strokes with a run's recorded input strokes
   *  (History → Restore mask). Goes through the collaborative store, so undo
   *  brings the replaced strokes back. Fresh ids: the originals may still
   *  exist (unchanged strokes) or echo back from collaborators. */
  function handleRestoreMaskShapes(layerId: string, shapes: unknown[]) {
    invalidateLiveGeneration()
    const current = room.store
      .getSnapshot()
      .annotations.filter((a) => isMaskShape(a) && a.layerId === layerId)
    for (const a of current) {
      room.store.removeAnnotation(a.id)
    }
    for (const shape of shapes as AnnotationEntity[]) {
      room.store.upsertAnnotation({ ...shape, id: crypto.randomUUID(), layerId })
    }
  }

  /** The layer's current mask strokes as plain JSON — sent with each dispatch
   *  so the run's generation record can restore the exact input mask later
   *  (History → Restore mask). Reads the live store snapshot like
   *  rasterizeAndSaveLayerMask, for the same commit-timing reason. */
  function getLayerMaskShapes(layerId: string) {
    return room.store
      .getSnapshot()
      .annotations.filter((a) => isMaskShape(a) && a.layerId === layerId)
  }

  /** Rasterize a layer's mask strokes and upload them (with the layer's current
   *  op/prompt/reference metadata). Reads the live store snapshot rather than the
   *  React one — callers may run before React has re-rendered a fresh commit.
   *  Throws with a user-facing message on precondition failures. */
  async function rasterizeAndSaveLayerMask(layerId: string): Promise<AssetSummary | null> {
    const liveSnapshot = room.store.getSnapshot()
    const layerShapes = liveSnapshot.annotations.filter(
      (a) => isMaskShape(a) && a.layerId === layerId,
    )
    if (layerShapes.length === 0) {
      throw new Error('Draw strokes on this layer first')
    }
    const dims = imageDims ?? (asset.file_path ? await loadImageSize(asset.file_path) : null)
    const width = dims?.width ?? asset.width ?? 0
    const height = dims?.height ?? asset.height ?? 0
    if (!width || !height) {
      throw new Error('Dimensions unknown')
    }
    const blob = await rasterizeMask(layerShapes, width, height)
    if (!blob) {
      return null
    }
    const layer = liveSnapshot.layers.find((l) => l.id === layerId)
    const bounds = computeMaskBounds(layerShapes)
    const maskDims = bounds
      ? {
          x: Math.max(0, Math.round(bounds.x)),
          y: Math.max(0, Math.round(bounds.y)),
          w: Math.round(Math.min(bounds.x + bounds.w, width) - Math.max(0, bounds.x)),
          h: Math.round(Math.min(bounds.y + bounds.h, height) - Math.max(0, bounds.y)),
        }
      : undefined
    return saveMask(asset.id, blob, {
      annotationId: doc.id,
      name: `${asset.name}-${layer?.name ?? 'mask'}`,
      versionNumber,
      layerId,
      maskOp: layer?.mask_op,
      prompt: layer?.prompt,
      reference: layer?.reference,
      maskDims,
    })
  }

  async function handleGenerateMaskForLayer(layerId: string) {
    setMaskGenerateState((s) => ({ ...s, [layerId]: 'working' }))
    try {
      const mask = await rasterizeAndSaveLayerMask(layerId)
      setMaskGenerateState((s) => ({ ...s, [layerId]: mask ? `Saved ${mask.code}` : 'idle' }))
      if (mask) {
        window.setTimeout(() => setMaskGenerateState((s) => ({ ...s, [layerId]: 'idle' })), 2500)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'idle'
      setMaskGenerateState((s) => ({ ...s, [layerId]: message }))
      window.setTimeout(() => setMaskGenerateState((s) => ({ ...s, [layerId]: 'idle' })), 2500)
    }
  }

  /** Extract per-frame click prompts from mask brush strokes stored in the Yjs doc.
   *  Reads live annotation state so it works even after page reload. */
  function buildPromptFrames(layerId: string, annotations: AnnotationEntity[]) {
    const byFrame = new Map<number, Array<{ x: number; y: number; positive: boolean }>>()
    for (const ann of annotations) {
      if (!ann.maskRegion || ann.layerId !== layerId) continue
      const frameIndex = ann.frame.mediaBinding?.frame
      if (typeof frameIndex !== 'number') continue
      const geom = ann.geometry
      if (geom.kind !== 'brush' && geom.kind !== 'freehand' && geom.kind !== 'polygon') continue
      const pts = geom.points
      if (pts.length === 0) continue
      // Geometry points are FRAME-LOCAL offsets from the stroke's anchor, not
      // absolute image coords — convert via framePointToWorld (same as
      // computeMaskBounds) or every click collapses to the image's top-left.
      const worldPts = pts.map((p) => framePointToWorld(ann.frame, p))
      const existing = byFrame.get(frameIndex) ?? []
      if (geom.kind === 'polygon') {
        // Polygon vertices sit on the boundary; the centroid is the best
        // interior guess (imperfect for concave shapes).
        const cx = worldPts.reduce((s, p) => s + p.x, 0) / worldPts.length
        const cy = worldPts.reduce((s, p) => s + p.y, 0) / worldPts.length
        existing.push({ x: cx, y: cy, positive: true })
      } else {
        // Brush/freehand points are ON the painted object; sample up to 3
        // evenly along the stroke. (The centroid of a curved stroke can fall
        // OFF the object — e.g. a C-shaped stroke around a torso.)
        const sampleCount = Math.min(3, worldPts.length)
        for (let i = 0; i < sampleCount; i++) {
          const p = worldPts[Math.floor((i * (worldPts.length - 1)) / Math.max(sampleCount - 1, 1))]
          existing.push({ x: p.x, y: p.y, positive: true })
        }
      }
      byFrame.set(frameIndex, existing)
    }
    return Array.from(byFrame.entries())
      .sort(([a], [b]) => a - b)
      .map(([frame_index, clicks]) => ({ frame_index, type: 'click' as const, clicks }))
  }

  async function handlePropagateMaskTrack(layerId: string) {
    // Cancel any previous in-flight propagation.
    propagationAbortRef.current?.abort()
    const abort = new AbortController()
    propagationAbortRef.current = abort

    setMaskGenerateState((s) => ({ ...s, [layerId]: 'working' }))

    try {
      const promptFrames = buildPromptFrames(layerId, snapshot.annotations)

      if (promptFrames.length === 0) {
        setMaskGenerateState((s) => ({ ...s, [layerId]: 'Draw a mask first' }))
        window.setTimeout(() => setMaskGenerateState((s) => ({ ...s, [layerId]: 'idle' })), 2500)
        return
      }

      // Dispatch to Django → Modal SAM 2. Send the user-selected span if any;
      // otherwise the backend auto-scopes a window around the earliest prompt.
      const propagatedLayer = maskLayers.find((l) => l.id === layerId)
      const dispatched = await propagateMaskTrack(asset.id, layerId, {
        prompt_frames: promptFrames,
        propagation_params: maskSpan
          ? { span_start: maskSpan.start, span_end: maskSpan.end }
          : { full_clip: true },
        layer_name: propagatedLayer?.name,
        layer_color: propagatedLayer?.color,
        source_size: imageDims ?? undefined,
      })
      if (abort.signal.aborted) return

      const dispatchAt = dispatched.dispatch_at_ms ?? Date.now()
      const spanStart = dispatched.span_start ?? maskSpan?.start ?? 0

      // Poll until done. Prefer the backend's phase string (e.g. "Segmenting… 12s"),
      // falling back to a locally-computed elapsed counter.
      const result = await new Promise<typeof dispatched & { version_id?: string; frames_processed?: number; latency_s?: number }>(
        (resolve, reject) => {
          const poll = async () => {
            if (abort.signal.aborted) { reject(new Error('Cancelled')); return }
            try {
              const status = await getMaskTrackStatus(asset.id, layerId, dispatched.call_id, dispatchAt, spanStart)
              if (status.status === 'done') {
                resolve({ ...dispatched, ...status })
              } else if (status.status === 'failed') {
                reject(new Error(status.error ?? 'Propagation failed'))
              } else {
                const elapsed = Math.round((Date.now() - dispatchAt) / 1000)
                const label = status.progress ?? `${elapsed}s…`
                setMaskGenerateState((s) => ({ ...s, [layerId]: label }))
                window.setTimeout(poll, 2000)
              }
            } catch (err) {
              reject(err)
            }
          }
          void poll()
        },
      )

      if (abort.signal.aborted) return

      // Update timeline: propagated segment spans the processed window, plus
      // keyframes from the prompt frames.
      const totalFrames = asset.nb_frames ?? (asset.fps && asset.duration ? Math.round(asset.fps * asset.duration) : 240)
      const segStart = dispatched.span_start ?? maskSpan?.start ?? 0
      const segEnd = dispatched.span_end ?? maskSpan?.end ?? totalFrames - 1
      const promptedFrameIndices = promptFrames.map((pf) => pf.frame_index)
      setMaskTrackKeyframes((prev) => {
        const merged = new Set([...(prev[layerId] ?? []), ...promptedFrameIndices])
        return { ...prev, [layerId]: Array.from(merged).sort((a, b) => a - b) }
      })
      setMaskTrackSegments((prev) => ({
        ...prev,
        [layerId]: [{ startFrame: segStart, endFrame: segEnd, type: 'propagated' as const }],
      }))
      // Enable per-frame mask overlay for this layer; bump version to invalidate
      // any cached mask images from a prior propagation.
      setVideoMaskTracks((prev) => ({
        ...prev,
        [layerId]: { version: (prev[layerId]?.version ?? 0) + 1 },
      }))

      const latencyStr = result.latency_s != null ? ` · ${result.latency_s.toFixed(0)}s` : ''
      const frameStr = result.frames_processed != null ? `${result.frames_processed} frames` : 'Done'
      setMaskGenerateState((s) => ({ ...s, [layerId]: `${frameStr}${latencyStr}` }))
      window.setTimeout(() => setMaskGenerateState((s) => ({ ...s, [layerId]: 'idle' })), 3000)

    } catch (error) {
      if (abort.signal.aborted) return
      const message = error instanceof Error ? error.message : 'Failed'
      setMaskGenerateState((s) => ({ ...s, [layerId]: message }))
      window.setTimeout(() => setMaskGenerateState((s) => ({ ...s, [layerId]: 'idle' })), 3000)
    }
  }

  /** Dispatch the layer's mask_op to its generation runner. No-op when the op
   *  is unrunnable or a required prompt is missing. Shared by live stroke-commit
   *  generation and the explicit Regenerate button. */
  function runGenerationForLayer(layerId: string) {
    const layer = room.store.getSnapshot().layers.find((l) => l.id === layerId)
    const op = layer?.mask_op
    const eligible =
      (op === 'inpaint' && layer?.prompt?.trim()) ||
      (op === 'scribble' && layer?.prompt?.trim()) ||
      (op === 'sketch_inpaint' && layer?.prompt?.trim()) ||
      op === 'remove'
    if (!eligible) {
      return
    }
    // A new run supersedes the previous batch — drop the stale variant strip.
    setLiveVariants((prev) => (prev.length ? [] : prev))
    setLiveVariantIndex(0)
    if (op === 'inpaint') void runLiveGeneration(layerId)
    else if (op === 'scribble') void runScribbleGeneration(layerId)
    else if (op === 'sketch_inpaint') void runSketchInpaintGeneration(layerId)
    else if (op === 'remove') void runEraseGeneration(layerId)
  }

  function handleMaskStrokeCommitted(layerId: string, frameIndex?: number) {
    // Track which video frames have been drawn on (for the track timeline).
    if (typeof frameIndex === 'number') {
      setMaskTrackKeyframes((prev) => {
        const existing = prev[layerId] ?? []
        if (existing.includes(frameIndex)) return prev
        return { ...prev, [layerId]: [...existing, frameIndex].sort((a, b) => a - b) }
      })
    }
    if (!liveGenEnabled || layerId !== activeMaskLayerId) {
      return
    }
    if (liveDebounceRef.current != null) {
      window.clearTimeout(liveDebounceRef.current)
    }
    liveDebounceRef.current = window.setTimeout(() => {
      liveDebounceRef.current = null
      runGenerationForLayer(layerId)
    }, LIVE_DEBOUNCE_MS)
  }

  /** Explicit regenerate: cancels any pending live-gen debounce, then runs the
   *  layer's op immediately. Works regardless of the live-generation toggle. */
  function handleRegenerateLayer(layerId: string) {
    if (liveDebounceRef.current != null) {
      window.clearTimeout(liveDebounceRef.current)
      liveDebounceRef.current = null
    }
    runGenerationForLayer(layerId)
  }

  async function runLiveGeneration(layerId: string) {
    const gen = ++liveGenerationRef.current
    setLiveGenStatus({ phase: 'saving' })
    try {
      const saved = await rasterizeAndSaveLayerMask(layerId)
      if (!saved || gen !== liveGenerationRef.current) {
        if (gen === liveGenerationRef.current) setLiveGenStatus({ phase: 'idle' })
        return
      }
      const layer = room.store.getSnapshot().layers.find((l) => l.id === layerId)
      // Auto mode: a real prompt needs full CFG to be followed (LCM harmonizes
      // but ignores semantics — see SRED finding F1), so default to quality.
      const mode = layer?.gen_mode ?? (layer?.prompt?.trim() ? 'quality' : 'fast')
      await triggerInpaint(asset.id, {
        layer_id: layerId,
        prompt: layer?.prompt,
        mode,
        mask_shapes: getLayerMaskShapes(layerId),
      })
      if (gen !== liveGenerationRef.current) {
        return
      }
      setLiveGenStatus({ phase: 'generating' })
      const startedAt = Date.now()
      const poll = async () => {
        if (gen !== liveGenerationRef.current) {
          return
        }
        if (Date.now() - startedAt > LIVE_GEN_TIMEOUT_MS) {
          setLiveGenStatus({ phase: 'error', message: 'Generation timed out' })
          return
        }
        try {
          const status = await getInpaintStatus(asset.id, layerId)
          if (gen !== liveGenerationRef.current) {
            return
          }
          if (status.status === 'done' && status.result?.file_path) {
            const img = new Image()
            img.onload = () => {
              if (gen === liveGenerationRef.current) {
                setLivePreviewImage(img)
                setLivePreviewRegion(null)
                setLiveGenStatus({ phase: 'idle', latencyS: status.latency_s })
              }
            }
            img.onerror = () => {
              if (gen === liveGenerationRef.current) {
                setLiveGenStatus({ phase: 'error', message: 'Could not load result image' })
              }
            }
            img.src = status.result.file_path
            return
          }
          if (status.status === 'error') {
            setLiveGenStatus({ phase: 'error', message: status.detail ?? 'Generation failed' })
            return
          }
          if (Date.now() - startedAt > 5000) {
            setLiveGenStatus({ phase: 'generating', message: 'GPU warming up…' })
          }
        } catch {
          // Transient poll failure — keep polling until the timeout cap.
        }
        livePollTimerRef.current = window.setTimeout(() => void poll(), POLL_INTERVAL_MS)
      }
      void poll()
    } catch (error) {
      if (gen === liveGenerationRef.current) {
        setLiveGenStatus({
          phase: 'error',
          message: error instanceof Error ? error.message : 'Generation failed',
        })
      }
    }
  }

  async function runScribbleGeneration(layerId: string) {
    const gen = ++liveGenerationRef.current
    setLiveGenStatus({ phase: 'saving' })
    try {
      const liveSnapshot = room.store.getSnapshot()
      const layerShapes = liveSnapshot.annotations.filter(
        (a) => isMaskShape(a) && a.layerId === layerId,
      )
      if (layerShapes.length === 0) {
        setLiveGenStatus({ phase: 'idle' })
        return
      }
      const dims = imageDims ?? (asset.file_path ? await loadImageSize(asset.file_path) : null)
      const width = dims?.width ?? asset.width ?? 1024
      const height = dims?.height ?? asset.height ?? 1024
      if (!width || !height) {
        setLiveGenStatus({ phase: 'idle' })
        return
      }
      const blob = await rasterizeScribble(layerShapes, width, height)
      if (!blob || gen !== liveGenerationRef.current) {
        if (gen === liveGenerationRef.current) setLiveGenStatus({ phase: 'idle' })
        return
      }
      const layer = liveSnapshot.layers.find((l) => l.id === layerId)
      const scribbleScope = layer?.scribble_scope ?? 'full'

      // For region mode, compute the bounding box of the sketch strokes.
      let maskDims: { x: number; y: number; w: number; h: number } | undefined
      if (scribbleScope === 'region') {
        const bounds = computeMaskBounds(layerShapes)
        if (bounds) {
          maskDims = {
            x: Math.max(0, Math.round(bounds.x)),
            y: Math.max(0, Math.round(bounds.y)),
            w: Math.round(Math.min(bounds.x + bounds.w, width) - Math.max(0, bounds.x)),
            h: Math.round(Math.min(bounds.y + bounds.h, height) - Math.max(0, bounds.y)),
          }
        }
      }

      // Draft mode: synchronous low-res generation with no asset round-trips.
      // The scribble goes straight to Modal and the JPEG comes back in the same
      // response — nothing is saved, so drafts don't pollute version history.
      if (layer?.gen_mode === 'fast') {
        setLiveGenStatus({ phase: 'generating' })
        const startedAtDraft = Date.now()
        const { imageUrl, seedUsed } = await triggerScribbleDraft(asset.id, {
          scribble: blob,
          prompt: layer.prompt ?? '',
          controlnet_scale: layer.controlnet_scale,
          num_inference_steps: layer.num_inference_steps,
          seed: layer.seed,
          width,
          height,
          scribble_mode: scribbleScope,
          mask_dims: maskDims,
        })
        if (gen !== liveGenerationRef.current) {
          URL.revokeObjectURL(imageUrl)
          return
        }
        const img = await loadImageElement(imageUrl)
        if (gen !== liveGenerationRef.current || !img) {
          URL.revokeObjectURL(imageUrl)
          if (gen === liveGenerationRef.current) {
            setLiveGenStatus({ phase: 'error', message: 'Could not load draft image' })
          }
          return
        }
        if (draftUrlRef.current) URL.revokeObjectURL(draftUrlRef.current)
        draftUrlRef.current = imageUrl
        setLivePreviewIsScribble(scribbleScope === 'full')
        setLiveVariants([])
        setLiveVariantIndex(0)
        setLivePreviewImage(img)
        setLivePreviewRegion(null)
        setLiveGenStatus({
          phase: 'idle',
          latencyS: (Date.now() - startedAtDraft) / 1000,
          seedUsed,
        })
        return
      }

      await saveMask(asset.id, blob, {
        annotationId: doc.id,
        name: `${asset.name}-${layer?.name ?? 'scribble'}`,
        versionNumber,
        layerId,
        maskOp: 'scribble',
        prompt: layer?.prompt,
      })
      if (gen !== liveGenerationRef.current) return
      await triggerScribble(asset.id, {
        layer_id: layerId,
        prompt: layer?.prompt,
        controlnet_scale: layer?.controlnet_scale,
        guidance_scale: layer?.guidance_scale,
        width,
        height,
        scribble_mode: scribbleScope,
        mask_dims: maskDims,
        seed: layer?.seed,
        num_variants: layer?.num_variants,
        num_inference_steps: layer?.num_inference_steps,
        mask_shapes: getLayerMaskShapes(layerId),
      })
      if (gen !== liveGenerationRef.current) return
      setLiveGenStatus({ phase: 'generating' })
      const startedAt = Date.now()
      const poll = async () => {
        if (gen !== liveGenerationRef.current) return
        if (Date.now() - startedAt > LIVE_GEN_TIMEOUT_MS) {
          setLiveGenStatus({ phase: 'error', message: 'Generation timed out' })
          return
        }
        try {
          const s = await getScribbleStatus(asset.id, layerId)
          if (gen !== liveGenerationRef.current) return
          if (s.status === 'done' && (s.results?.length || s.result?.file_path)) {
            const entries = (s.results?.length ? s.results : [{ ...s.result!, seed: s.seed_used }])
              .filter((e) => e.file_path)
            const loaded = await Promise.all(entries.map((e) => loadImageElement(e.file_path!)))
            if (gen !== liveGenerationRef.current) return
            const variants = loaded
              .map((img, i) => (img ? { img, seed: entries[i].seed } : null))
              .filter((v): v is { img: HTMLImageElement; seed?: number } => v !== null)
            if (!variants.length) {
              setLiveGenStatus({ phase: 'error', message: 'Could not load result image' })
              return
            }
            setLivePreviewIsScribble(scribbleScope === 'full')
            setLiveVariants(variants.length > 1 ? variants : [])
            setLiveVariantIndex(0)
            setLivePreviewImage(variants[0].img)
            setLivePreviewRegion(null)
            setLiveGenStatus({
              phase: 'idle',
              latencyS: s.latency_s,
              seedUsed: variants[0].seed ?? s.seed_used,
            })
            return
          }
          if (s.status === 'error') {
            setLiveGenStatus({ phase: 'error', message: s.detail ?? 'Generation failed' })
            return
          }
          if (Date.now() - startedAt > 5000) {
            setLiveGenStatus({ phase: 'generating', message: 'GPU warming up…' })
          }
        } catch {
          // Transient poll failure — keep polling until the timeout cap.
        }
        livePollTimerRef.current = window.setTimeout(() => void poll(), POLL_INTERVAL_MS)
      }
      void poll()
    } catch (error) {
      if (gen === liveGenerationRef.current) {
        setLiveGenStatus({
          phase: 'error',
          message: error instanceof Error ? error.message : 'Generation failed',
        })
      }
    }
  }

  /** Load an image element, resolving null on error so batch loads tolerate a bad variant. */
  function loadImageElement(src: string): Promise<HTMLImageElement | null> {
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => resolve(null)
      img.src = src
    })
  }

  async function runSketchInpaintGeneration(layerId: string) {
    const gen = ++liveGenerationRef.current
    setLiveGenStatus({ phase: 'saving' })
    try {
      const liveSnapshot = room.store.getSnapshot()
      const layerShapes = liveSnapshot.annotations.filter(
        (a) => isMaskShape(a) && a.layerId === layerId,
      )
      if (layerShapes.length === 0) {
        setLiveGenStatus({ phase: 'idle' })
        return
      }
      const dims = imageDims ?? (asset.file_path ? await loadImageSize(asset.file_path) : null)
      const width = dims?.width ?? asset.width ?? 1024
      const height = dims?.height ?? asset.height ?? 1024
      if (!width || !height) {
        setLiveGenStatus({ phase: 'idle' })
        return
      }
      const bounds = computeMaskBounds(layerShapes)
      if (!bounds) {
        setLiveGenStatus({ phase: 'idle' })
        return
      }
      const maskDims = {
        x: Math.max(0, Math.round(bounds.x)),
        y: Math.max(0, Math.round(bounds.y)),
        w: Math.round(Math.min(bounds.x + bounds.w, width) - Math.max(0, bounds.x)),
        h: Math.round(Math.min(bounds.y + bounds.h, height) - Math.max(0, bounds.y)),
      }
      const blob = await rasterizeSketchInpaintGuide(layerShapes, width, height)
      if (!blob || gen !== liveGenerationRef.current) {
        if (gen === liveGenerationRef.current) setLiveGenStatus({ phase: 'idle' })
        return
      }
      const layer = liveSnapshot.layers.find((l) => l.id === layerId)
      await saveMask(asset.id, blob, {
        annotationId: doc.id,
        name: `${asset.name}-${layer?.name ?? 'sketch-inpaint'}`,
        versionNumber,
        layerId,
        maskOp: 'sketch_inpaint',
        prompt: layer?.prompt,
      })
      if (gen !== liveGenerationRef.current) return
      await triggerSketchInpaint(asset.id, {
        layer_id: layerId,
        prompt: layer?.prompt,
        negative_prompt: layer?.negative_prompt,
        controlnet_scale: layer?.controlnet_scale,
        guidance_scale: layer?.guidance_scale,
        num_inference_steps: layer?.num_inference_steps,
        mask_dims: maskDims,
        seed: layer?.seed,
        num_variants: layer?.num_variants,
        denoise_strength: layer?.denoise_strength,
        reference: layer?.reference,
        reference_scale: layer?.reference_scale,
        mask_shapes: getLayerMaskShapes(layerId),
      })
      if (gen !== liveGenerationRef.current) return
      setLiveGenStatus({ phase: 'generating' })
      const startedAt = Date.now()
      const poll = async () => {
        if (gen !== liveGenerationRef.current) return
        if (Date.now() - startedAt > LIVE_GEN_TIMEOUT_MS) {
          setLiveGenStatus({ phase: 'error', message: 'Generation timed out' })
          return
        }
        try {
          const s = await getSketchInpaintStatus(asset.id, layerId)
          if (gen !== liveGenerationRef.current) return
          if (s.status === 'done' && (s.results?.length || s.result?.file_path)) {
            const entries = (s.results?.length ? s.results : [{ ...s.result!, seed: s.seed_used }])
              .filter((e) => e.file_path)
            const loaded = await Promise.all(entries.map((e) => loadImageElement(e.file_path!)))
            if (gen !== liveGenerationRef.current) return
            const variants = loaded
              .map((img, i) => (img ? { img, seed: entries[i].seed } : null))
              .filter((v): v is { img: HTMLImageElement; seed?: number } => v !== null)
            if (!variants.length) {
              setLiveGenStatus({ phase: 'error', message: 'Could not load result image' })
              return
            }
            setLivePreviewIsScribble(false)
            setLiveVariants(variants.length > 1 ? variants : [])
            setLiveVariantIndex(0)
            setLivePreviewImage(variants[0].img)
            setLivePreviewRegion(null)
            setLiveGenStatus({
              phase: 'idle',
              latencyS: s.latency_s,
              seedUsed: variants[0].seed ?? s.seed_used,
            })
            return
          }
          if (s.status === 'error') {
            setLiveGenStatus({ phase: 'error', message: s.detail ?? 'Generation failed' })
            return
          }
          if (Date.now() - startedAt > 5000) {
            setLiveGenStatus({ phase: 'generating', message: 'GPU warming up…' })
          }
        } catch {
          // Transient poll failure — keep polling until timeout.
        }
        livePollTimerRef.current = window.setTimeout(() => void poll(), POLL_INTERVAL_MS)
      }
      void poll()
    } catch (error) {
      if (gen === liveGenerationRef.current) {
        setLiveGenStatus({
          phase: 'error',
          message: error instanceof Error ? error.message : 'Generation failed',
        })
      }
    }
  }

  async function runEraseGeneration(layerId: string) {
    const gen = ++liveGenerationRef.current
    setLiveGenStatus({ phase: 'saving' })
    try {
      const saved = await rasterizeAndSaveLayerMask(layerId)
      if (!saved || gen !== liveGenerationRef.current) {
        if (gen === liveGenerationRef.current) setLiveGenStatus({ phase: 'idle' })
        return
      }
      await triggerErase(asset.id, {
        layer_id: layerId,
        mask_shapes: getLayerMaskShapes(layerId),
      })
      if (gen !== liveGenerationRef.current) return
      setLiveGenStatus({ phase: 'generating' })
      const startedAt = Date.now()
      const poll = async () => {
        if (gen !== liveGenerationRef.current) return
        if (Date.now() - startedAt > LIVE_GEN_TIMEOUT_MS) {
          setLiveGenStatus({ phase: 'error', message: 'Generation timed out' })
          return
        }
        try {
          const s = await getEraseStatus(asset.id, layerId)
          if (gen !== liveGenerationRef.current) return
          if (s.status === 'done' && s.result?.file_path) {
            const img = new Image()
            img.onload = () => {
              if (gen === liveGenerationRef.current) {
                setLivePreviewIsScribble(false)
                setLivePreviewImage(img)
                setLivePreviewRegion(null)
                setLiveGenStatus({ phase: 'idle', latencyS: s.latency_s })
              }
            }
            img.onerror = () => {
              if (gen === liveGenerationRef.current)
                setLiveGenStatus({ phase: 'error', message: 'Could not load result image' })
            }
            img.src = s.result.file_path
            return
          }
          if (s.status === 'error') {
            setLiveGenStatus({ phase: 'error', message: s.detail ?? 'Generation failed' })
            return
          }
          if (Date.now() - startedAt > 5000) {
            setLiveGenStatus({ phase: 'generating', message: 'GPU warming up…' })
          }
        } catch {
          // Transient poll failure — keep polling until the timeout cap.
        }
        livePollTimerRef.current = window.setTimeout(() => void poll(), POLL_INTERVAL_MS)
      }
      void poll()
    } catch (error) {
      if (gen === liveGenerationRef.current) {
        setLiveGenStatus({
          phase: 'error',
          message: error instanceof Error ? error.message : 'Generation failed',
        })
      }
    }
  }

  async function handleSaveSnapshot() {
    setSaveState('saving')
    try {
      await saveDocState(doc.id, toBase64(Y.encodeStateAsUpdate(room.doc)))
      setSaveState('saved')
      window.setTimeout(() => setSaveState('idle'), 1500)
    } catch {
      setSaveState('idle')
    }
  }

  async function handlePublishVersion() {
    setSnapshotState('working')
    try {
      // Persist current state first so the published version reflects the live doc.
      await saveDocState(doc.id, toBase64(Y.encodeStateAsUpdate(room.doc)))
      const result = await snapshotAnnotationDoc(doc.id)
      setSnapshotState(`Published v${result.version_number}`)
      window.setTimeout(() => setSnapshotState('idle'), 2500)
    } catch {
      setSnapshotState('idle')
    }
  }

  return (
    <div className="annotator-page">
      <header className="annotator-page__header">
        <div className="annotator-page__title">
          <h1>{asset.name}</h1>
          <span>
            {is3DModel
              ? '3D model annotation'
              : isVideo
                ? `Video annotation · ${asset.width ?? '?'} × ${asset.height ?? '?'}${asset.fps ? ` · ${asset.fps.toFixed(2)} fps` : ''}`
                : `Image annotation · ${asset.width ?? '?'} × ${asset.height ?? '?'}`}
          </span>
        </div>
        <div className="annotator-page__participants">
          {participants.map((participant) => (
            <span
              key={participant.id}
              className="annotator-page__participant"
              style={{ '--participant-color': participant.color } as CSSProperties}
            >
              {participant.name}
            </span>
          ))}
        </div>
        <div className="annotator-page__actions">
          <button className="annotator-page__action" onClick={handleSaveSnapshot}>
            {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : 'Save'}
          </button>
          <button
            className="annotator-page__action annotator-page__action--primary"
            onClick={handlePublishVersion}
          >
            {snapshotState === 'working'
              ? 'Publishing…'
              : snapshotState === 'idle'
                ? 'Publish version'
                : snapshotState}
          </button>
          <button className="annotator-page__action" onClick={onBack}>
            ← Back
          </button>
        </div>
      </header>

      <div className="annotator-page__main">
        <AnnotationViewport
          title={is3DModel ? '3D model viewer' : isVideo ? 'Frame-accurate video' : '2D tiled viewer'}
          adapter={adapter}
          room={room}
          annotations={snapshot.annotations}
          participants={participants}
          activeTool={activeTool}
          selectedId={activeSelectionId}
          onSelect={setSelectedId}
          authorId={profile.id}
          authorName={profile.name}
          authorColor={profile.color}
          textValue={textValue}
          onToolChange={setActiveTool}
          freehandPipelineOptions={freehandPipelineOptions}
          onUndo={() => room.store.undo()}
          onRedo={() => room.store.redo()}
          canUndo={room.store.canUndo()}
          canRedo={room.store.canRedo()}
          onDeleteSelected={() => {
            if (activeSelectionId) {
              room.store.removeAnnotation(activeSelectionId)
            }
          }}
          annotatorMode={annotatorMode}
          onAnnotatorModeChange={handleAnnotatorModeChange}
          activeMaskLayerId={activeMaskLayerId ?? undefined}
          maskLayers={maskLayers}
          maskPreviewMode={previewMode}
          onMaskPreviewModeChange={setPreviewMode}
          imageDims={imageDims ?? undefined}
          liveGenEnabled={liveGenEnabled}
          onLiveGenEnabledChange={setLiveGenEnabled}
          livePreviewImage={livePreviewImage}
          livePreviewRegion={livePreviewRegion}
          livePreviewIsScribble={livePreviewIsScribble}
          layerRenders={layerRenderComposite}
          liveGenLatencyS={liveGenStatus.latencyS}
          liveGenBusy={liveGenStatus.phase === 'saving' || liveGenStatus.phase === 'generating'}
          onMaskStrokeStarted={invalidateLiveGeneration}
          onMaskStrokeCommitted={handleMaskStrokeCommitted}
          maskTrackKeyframes={mergedMaskKeyframes}
          maskTrackSegments={maskTrackSegments}
          assetId={asset.id}
          videoMaskTracks={videoMaskTracks}
          maskSpan={maskSpan}
          onSetSpanIn={(frame) => setMaskSpan((s) => ({ start: frame, end: Math.max(frame, s?.end ?? frame) }))}
          onSetSpanOut={(frame) => setMaskSpan((s) => ({ start: Math.min(frame, s?.start ?? frame), end: frame }))}
          onClearSpan={() => setMaskSpan(null)}
        />
        {annotatorMode === 'mask' && !is3DModel ? (
          <>
          <div
            className="annotator-page__mask-sidebar-resizer"
            title="Drag to resize"
            onPointerDown={startMaskSidebarResize}
          />
          <div className="annotator-page__mask-sidebar" style={{ width: maskSidebarWidth }}>
            <MaskLayersPanel
              layers={maskLayers}
              activeLayerId={activeMaskLayerId}
              maskGenerateState={maskGenerateState}
              isVideo={isVideo}
              onSelectLayer={handleSelectMaskLayer}
              onAddLayer={handleAddMaskLayer}
              onRemoveLayer={handleRemoveMaskLayer}
              onRenameLayer={handleRenameMaskLayer}
              onToggleVisibility={handleToggleLayerVisibility}
              onToggleRenderVisibility={handleToggleRenderVisibility}
              onMoveLayerUp={handleMoveMaskLayerUp}
              onMoveLayerDown={handleMoveMaskLayerDown}
              onGenerateMask={handleGenerateMaskForLayer}
              onPropagateMask={handlePropagateMaskTrack}
            />
            {activeMaskLayerId ? (
              <div className="annotator-page__sidebar-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={sidebarTab === 'params'}
                  className={
                    'annotator-page__sidebar-tab' +
                    (sidebarTab === 'params' ? ' annotator-page__sidebar-tab--active' : '')
                  }
                  onClick={() => setSidebarTab('params')}
                >
                  Parameters
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={sidebarTab === 'history'}
                  className={
                    'annotator-page__sidebar-tab' +
                    (sidebarTab === 'history' ? ' annotator-page__sidebar-tab--active' : '')
                  }
                  onClick={() => setSidebarTab('history')}
                >
                  History
                </button>
              </div>
            ) : null}
            {activeMaskLayerId && sidebarTab === 'params' ? (
              <MaskLayerDetailPanel
                layer={maskLayers.find((l) => l.id === activeMaskLayerId) ?? null}
                onUpdate={(fields) => handleUpdateMaskLayer(activeMaskLayerId, fields)}
                onRegenerate={() => handleRegenerateLayer(activeMaskLayerId)}
                busy={liveGenStatus.phase === 'saving' || liveGenStatus.phase === 'generating'}
                lastSeed={liveGenStatus.seedUsed}
                resyncKey={paramsAppliedKey}
              />
            ) : null}
            {activeMaskLayerId && sidebarTab === 'history' ? (
              <RenderHistoryPanel
                assetId={asset.id}
                layerId={activeMaskLayerId}
                refreshKey={renderHistoryKey}
                onSelectionChanged={handleRenderSelectionChanged}
                onApplyParams={(fields) => {
                  handleUpdateMaskLayer(activeMaskLayerId, fields)
                  setParamsAppliedKey((k) => k + 1)
                }}
                onRestoreMask={(shapes) => handleRestoreMaskShapes(activeMaskLayerId, shapes)}
              />
            ) : null}
            {liveVariants.length > 1 ? (
              <div
                className="annotator-page__variant-strip"
                style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}
              >
                {liveVariants.map((v, i) => (
                  <button
                    key={i}
                    type="button"
                    title={v.seed != null ? `Variant ${i + 1} — seed ${v.seed}` : `Variant ${i + 1}`}
                    onClick={() => {
                      setLiveVariantIndex(i)
                      setLivePreviewImage(v.img)
                      setLiveGenStatus((prev) => ({ ...prev, seedUsed: v.seed }))
                    }}
                    style={{
                      padding: 0,
                      borderRadius: 6,
                      overflow: 'hidden',
                      cursor: 'pointer',
                      background: 'none',
                      border:
                        i === liveVariantIndex
                          ? '2px solid #3b82f6'
                          : '1px solid rgba(148,163,184,0.25)',
                    }}
                  >
                    <img
                      src={v.img.src}
                      alt={`Variant ${i + 1}`}
                      style={{ width: 56, height: 56, objectFit: 'cover', display: 'block' }}
                    />
                  </button>
                ))}
              </div>
            ) : null}
            {liveGenStatus.phase !== 'idle' || liveGenStatus.message ? (
              <p
                className="annotator-page__live-gen-status"
                style={{
                  fontSize: 12,
                  margin: '4px 2px 0',
                  color: liveGenStatus.phase === 'error' ? '#fda4af' : 'rgba(226,232,240,0.7)',
                }}
              >
                {liveGenStatus.phase === 'saving'
                  ? 'Saving mask…'
                  : liveGenStatus.phase === 'generating'
                    ? (liveGenStatus.message ?? 'Generating preview…')
                    : liveGenStatus.message}
              </p>
            ) : null}
          </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
