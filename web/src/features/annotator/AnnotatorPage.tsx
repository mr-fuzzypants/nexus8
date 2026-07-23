import { useEffect, useState, type CSSProperties } from 'react'
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
import type {
  AnnotationDocumentSnapshot,
  AnnotationTool,
  CollaborationProfile,
  ParticipantState,
} from './core/annotations/types'
import { BroadcastCollaborationRoom } from './core/collaboration/broadcast'
import type { ViewerAdapter } from './core/viewers/adapters'
import {
  getAsset,
  getOrCreateAnnotationDoc,
  saveDocState,
  saveMask,
  snapshotAnnotationDoc,
  type AnnotationDoc,
} from './annotatorApi'
import { getVersionHistory } from '../../api/versions'
import { isMaskShape, rasterizeMask } from './rasterizeMask'
import { framePointToWorld } from './core/annotations/geometry'
import { MaskLayersPanel } from './components/MaskLayersPanel'
import { MaskLayerDetailPanel } from './components/MaskLayerDetailPanel'
import { DEFAULT_LAYER_ID } from './core/annotations/types'
import type { AnnotationLayer, MaskOp } from './core/annotations/types'
import './annotator.css'

const PROFILE_COLORS = ['#5eead4', '#f97316', '#60a5fa', '#f472b6', '#a78bfa', '#facc15']
const MASK_LAYER_COLORS = ['#f97316', '#a78bfa', '#34d399', '#f472b6', '#60a5fa', '#facc15', '#fb923c', '#e879f9']
const PROFILE_STORAGE_KEY = 'nexus8-annotator-profile'
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

  const selectedAnnotation = snapshot.annotations.find((annotation) => annotation.id === selectedId)
  const activeSelectionId = selectedAnnotation ? selectedAnnotation.id : undefined

  function handleSelectMaskLayer(id: string) {
    setActiveMaskLayerId(id)
    // Hide all other mask layers so the canvas is uncluttered; the user can
    // re-show individual layers via the eye icon for reference.
    maskLayers.forEach((layer) => {
      if (layer.id !== id && layer.visible) {
        room.store.upsertLayer({ ...layer, visible: false })
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

  function handleUpdateMaskLayer(id: string, fields: Partial<Pick<AnnotationLayer, 'mask_op' | 'prompt' | 'reference'>>) {
    const layer = maskLayers.find((l) => l.id === id)
    if (layer) {
      room.store.upsertLayer({ ...layer, ...fields })
    }
  }

  async function handleGenerateMaskForLayer(layerId: string) {
    const layerShapes = snapshot.annotations.filter(
      (a) => isMaskShape(a) && a.layerId === layerId,
    )
    if (layerShapes.length === 0) {
      setMaskGenerateState((s) => ({ ...s, [layerId]: 'Draw strokes on this layer first' }))
      window.setTimeout(() => setMaskGenerateState((s) => ({ ...s, [layerId]: 'idle' })), 2500)
      return
    }
    setMaskGenerateState((s) => ({ ...s, [layerId]: 'working' }))
    const fileDims = asset.file_path ? await loadImageSize(asset.file_path) : null
    const width = fileDims?.width ?? asset.width ?? 0
    const height = fileDims?.height ?? asset.height ?? 0
    if (!width || !height) {
      setMaskGenerateState((s) => ({ ...s, [layerId]: 'Dimensions unknown' }))
      window.setTimeout(() => setMaskGenerateState((s) => ({ ...s, [layerId]: 'idle' })), 2500)
      return
    }
    try {
      const blob = await rasterizeMask(layerShapes, width, height)
      if (!blob) {
        setMaskGenerateState((s) => ({ ...s, [layerId]: 'idle' }))
        return
      }
      const layer = maskLayers.find((l) => l.id === layerId)

      // Compute the bounding box of all mask shapes in pixel coordinates.
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const shape of layerShapes) {
        const pts: Array<{ x: number; y: number }> = []
        const geom = shape.geometry
        if (geom.kind === 'brush') {
          const r = geom.radius
          for (const p of geom.points) {
            const w = framePointToWorld(shape.frame, p)
            pts.push({ x: w.x - r, y: w.y - r })
            pts.push({ x: w.x + r, y: w.y + r })
          }
        } else if (geom.kind === 'freehand' || geom.kind === 'polygon') {
          for (const p of geom.points) {
            const w = framePointToWorld(shape.frame, p)
            pts.push({ x: w.x, y: w.y })
          }
        } else if (geom.kind === 'rectangle' || geom.kind === 'ellipse' || geom.kind === 'card' || geom.kind === 'grid' || geom.kind === 'list') {
          const a = framePointToWorld(shape.frame, geom.start)
          const b = framePointToWorld(shape.frame, geom.end)
          pts.push({ x: a.x, y: a.y }, { x: b.x, y: b.y })
        }
        for (const p of pts) {
          if (p.x < minX) minX = p.x
          if (p.y < minY) minY = p.y
          if (p.x > maxX) maxX = p.x
          if (p.y > maxY) maxY = p.y
        }
      }
      const maskDims = Number.isFinite(minX)
        ? {
            x: Math.max(0, Math.round(minX)),
            y: Math.max(0, Math.round(minY)),
            w: Math.round(Math.min(maxX, width) - Math.max(0, minX)),
            h: Math.round(Math.min(maxY, height) - Math.max(0, minY)),
          }
        : undefined

      const mask = await saveMask(asset.id, blob, {
        annotationId: doc.id,
        name: `${asset.name}-${layer?.name ?? 'mask'}`,
        versionNumber,
        layerId,
        maskOp: layer?.mask_op,
        prompt: layer?.prompt,
        reference: layer?.reference,
        maskDims,
      })
      setMaskGenerateState((s) => ({ ...s, [layerId]: `Saved ${mask.code}` }))
      window.setTimeout(() => setMaskGenerateState((s) => ({ ...s, [layerId]: 'idle' })), 2500)
    } catch {
      setMaskGenerateState((s) => ({ ...s, [layerId]: 'idle' }))
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
        />
        {annotatorMode === 'mask' && !isVideo && !is3DModel ? (
          <div className="annotator-page__mask-sidebar">
            <MaskLayersPanel
              layers={maskLayers}
              activeLayerId={activeMaskLayerId}
              maskGenerateState={maskGenerateState}
              onSelectLayer={handleSelectMaskLayer}
              onAddLayer={handleAddMaskLayer}
              onRemoveLayer={handleRemoveMaskLayer}
              onRenameLayer={handleRenameMaskLayer}
              onToggleVisibility={handleToggleLayerVisibility}
              onMoveLayerUp={handleMoveMaskLayerUp}
              onMoveLayerDown={handleMoveMaskLayerDown}
              onGenerateMask={handleGenerateMaskForLayer}
            />
            {activeMaskLayerId ? (
              <MaskLayerDetailPanel
                layer={maskLayers.find((l) => l.id === activeMaskLayerId) ?? null}
                onUpdate={(fields) => handleUpdateMaskLayer(activeMaskLayerId, fields)}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
