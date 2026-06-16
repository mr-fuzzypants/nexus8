import { useEffect, useState, type CSSProperties } from 'react'
import { useLocation } from 'wouter'
import { useQuery } from '@tanstack/react-query'
import * as Y from 'yjs'
import type { AssetSummary } from '../../api/library'
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
import { createTiledImageViewerAdapter } from './core/viewers/tiledImageAdapter'
import { createVideoViewerAdapter } from './core/viewers/videoAdapter'
import {
  getAsset,
  getOrCreateAnnotationDoc,
  saveDocState,
  saveMask,
  snapshotAnnotationDoc,
  type AnnotationDoc,
} from './annotatorApi'
import { isMaskShape, rasterizeMask } from './rasterizeMask'
import './annotator.css'

const PROFILE_COLORS = ['#5eead4', '#f97316', '#60a5fa', '#f472b6', '#a78bfa', '#facc15']
const PROFILE_STORAGE_KEY = 'nexus8-annotator-profile'
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.webm', '.mkv', '.avi', '.m4v']

function assetIsVideo(asset: AssetSummary) {
  if (asset.media_type === 'video') {
    return true
  }
  const path = (asset.file_path || '').toLowerCase()
  return VIDEO_EXTENSIONS.some((extension) => path.endsWith(extension))
}

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
  const [, navigate] = useLocation()
  const back = () => navigate(`/p/${params.code}`)

  const assetQuery = useQuery({
    queryKey: ['annotator', 'asset', assetId],
    queryFn: () => getAsset(assetId),
    enabled: Number.isFinite(assetId),
  })
  const docQuery = useQuery({
    queryKey: ['annotator', 'doc', assetId],
    queryFn: () => getOrCreateAnnotationDoc(assetId),
    enabled: Number.isFinite(assetId),
  })

  if (assetQuery.isLoading || docQuery.isLoading) {
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

  return <AnnotatorWorkspace asset={assetQuery.data} doc={docQuery.data} onBack={back} />
}

function AnnotatorWorkspace({
  asset,
  doc,
  onBack,
}: {
  asset: AssetSummary
  doc: AnnotationDoc
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
  const [maskState, setMaskState] = useState<'idle' | 'working' | string>('idle')

  // Create the viewer adapter + collaboration room inside the effect so it is
  // StrictMode-safe (created and destroyed together, recreated on remount).
  const isVideo = assetIsVideo(asset)

  useEffect(() => {
    // Video and image annotations share the same per-asset targetId so a single
    // annotation doc round-trips regardless of which viewer opened it.
    const targetId = `asset-${asset.id}`
    const adapter = isVideo
      ? createVideoViewerAdapter(
          [{ id: targetId, src: asset.file_path, label: asset.name }],
          { targetId, frameRate: asset.fps ?? undefined },
        )
      : createTiledImageViewerAdapter({
          imageUrl: asset.file_path,
          targetId,
          width: asset.width ?? undefined,
          height: asset.height ?? undefined,
        })
    const room = new BroadcastCollaborationRoom(doc.room_id, profile)
    if (doc.doc_state) {
      try {
        Y.applyUpdate(room.doc, fromBase64(doc.doc_state), 'server-hydrate')
      } catch {
        // ignore malformed persisted state
      }
    }
    room.setLocalProfile(profile)
    setEngine({ room, adapter })
    setSnapshot(room.store.getSnapshot())
    setParticipants(room.getParticipants())
    const unsubStore = room.store.subscribe(() => setSnapshot(room.store.getSnapshot()))
    const unsubParticipants = room.subscribeParticipants(() => setParticipants(room.getParticipants()))
    return () => {
      unsubStore()
      unsubParticipants()
      room.destroy()
      setEngine(null)
      setSnapshot(null)
    }
  }, [asset.id, asset.file_path, asset.name, asset.width, asset.height, asset.fps, isVideo, doc.room_id, doc.doc_state, profile])

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
  const selectedAnnotation = snapshot.annotations.find((annotation) => annotation.id === selectedId)
  const activeSelectionId = selectedAnnotation ? selectedAnnotation.id : undefined

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

  async function handleGenerateMask() {
    if (!snapshot) {
      return
    }
    const maskShapes = snapshot.annotations.filter(isMaskShape)
    if (maskShapes.length === 0) {
      setMaskState('Draw a brush or polygon first')
      window.setTimeout(() => setMaskState('idle'), 2500)
      return
    }
    setMaskState('working')
    let width = asset.width ?? 0
    let height = asset.height ?? 0
    if (!width || !height) {
      const dims = await loadImageSize(asset.file_path)
      if (dims) {
        width = dims.width
        height = dims.height
      }
    }
    if (!width || !height) {
      setMaskState('Source dimensions unknown')
      window.setTimeout(() => setMaskState('idle'), 2500)
      return
    }
    try {
      const blob = await rasterizeMask(maskShapes, width, height)
      if (!blob) {
        setMaskState('idle')
        return
      }
      const mask = await saveMask(asset.id, blob, {
        annotationId: doc.id,
        name: `${asset.name}-mask`,
      })
      setMaskState(`Saved mask ${mask.code}`)
      window.setTimeout(() => setMaskState('idle'), 2500)
    } catch {
      setMaskState('idle')
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
            {isVideo ? 'Video annotation' : 'Image annotation'} · {asset.width ?? '?'} × {asset.height ?? '?'}
            {isVideo && asset.fps ? ` · ${asset.fps.toFixed(2)} fps` : ''}
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
          {/* Mask rasterization is a still-image operation; it ignores frame binding. */}
          {!isVideo ? (
            <button className="annotator-page__action" onClick={handleGenerateMask}>
              {maskState === 'working' ? 'Rendering…' : maskState === 'idle' ? 'Generate mask' : maskState}
            </button>
          ) : null}
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

      <AnnotationViewport
        title={isVideo ? 'Frame-accurate video' : '2D tiled viewer'}
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
      />
    </div>
  )
}
