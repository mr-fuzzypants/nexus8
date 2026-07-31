import {
  Suspense,
  useEffect,
  lazy,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { Eye, Layers, Sparkles } from 'lucide-react'
import {
  normalizeBounds,
  vec2Distance,
  worldToFrameLocal,
} from '../core/annotations/geometry'
import { computeMaskBounds } from '../maskBounds'
import { renderLivePreviewOverlay, renderMaskOpPreview, renderScribblePreviewOverlay, type ScreenRect } from '../maskOpPreview'
import { resolveNexus8Uri } from '../annotatorApi'
import {
  FreehandStrokePipeline,
  type FreehandPipelineOptions,
} from '../core/annotations/freehandPipeline'
import type {
  AnnotationEntity,
  AnnotationFrame,
  AnnotationGeometry,
  AnnotationLayer,
  AnnotationTool,
  ParticipantState,
  StructuredObjectTool,
  Vec2,
} from '../core/annotations/types'
import { DEFAULT_LAYER_ID, isStructuredObjectTool } from '../core/annotations/types'
import { BroadcastCollaborationRoom } from '../core/collaboration/broadcast'
import { defaultAnnotationRenderPluginManager } from '../core/rendering/annotationPlugins'
import { createCachedProjectionHost } from '../core/rendering/host'
import { annotationMatchesViewer } from '../core/viewers/adapters'
import type { ViewerAdapter, ViewerSurfaceController, ViewportSize } from '../core/viewers/adapters'
import type { VideoViewerAdapter } from '../core/viewers/videoAdapter'
import { isAnnotationVisibleAtPlaybackTime } from '../core/annotations/timeline'
import { VideoTransport } from './VideoTransport'
import { renderPrimitiveBatchesToCanvas } from '../core/rendering/canvasRenderer'
import { buildAnnotationSceneRenderPlan } from '../core/rendering/renderService'
import { buildAnnotationSpatialIndex } from '../core/rendering/spatialIndex'
import { useElementSize } from '../hooks/useElementSize'
import {
  DETAIL_CARD_BASE_HEIGHT,
  DETAIL_CARD_BASE_WIDTH,
  getAnnotationScreenBounds,
  getCardMoveHandleTargets,
  getDetailCardMetrics,
} from './annotationOverlayDrawing'
import {
  ViewerToolbar,
  type ViewerToolbarGroup,
} from './ViewerToolbar'
import {
  getViewerToolbarActionIcon,
  VIEWER_TOOL_ICONS,
  type ViewerToolbarToolId,
} from './viewerToolbarConfig'

const LazyAnnotationMantineEditor = lazy(() => import('./AnnotationMantineEditor'))

type InlineEditableKind = 'text' | 'card' | 'list'
type TextAnnotation = AnnotationEntity & { geometry: Extract<AnnotationGeometry, { kind: 'text' }> }
type CardAnnotation = AnnotationEntity & { geometry: Extract<AnnotationGeometry, { kind: 'card' }> }
type ListAnnotation = AnnotationEntity & { geometry: Extract<AnnotationGeometry, { kind: 'list' }> }

interface CardDragState {
  pointerId: number
  annotation: CardAnnotation
  startLocal: Vec2
  moved: boolean
}

interface ViewportProps {
  title: string
  adapter: ViewerAdapter
  room: BroadcastCollaborationRoom
  annotations: AnnotationEntity[]
  participants: ParticipantState[]
  activeTool: AnnotationTool
  selectedId?: string
  onSelect: (id?: string) => void
  authorId: string
  authorName: string
  authorColor: string
  textValue: string
  onToolChange: (tool: AnnotationTool) => void
  freehandPipelineOptions: FreehandPipelineOptions
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
  onDeleteSelected: () => void
  annotatorMode: 'annotate' | 'mask'
  onAnnotatorModeChange: (mode: 'annotate' | 'mask') => void
  activeMaskLayerId?: string
  maskLayers?: AnnotationLayer[]
  maskPreviewMode?: boolean
  onMaskPreviewModeChange?: (value: boolean) => void
  imageDims?: { width: number; height: number }
  liveGenEnabled?: boolean
  onLiveGenEnabledChange?: (value: boolean) => void
  livePreviewImage?: HTMLImageElement | null
  /** When previewing a stored render from History: that run's own mask_dims
   *  (image-pixel coords). The overlay border/clip uses this instead of the
   *  layer's current strokes, which may have changed since the run. */
  livePreviewRegion?: { x: number; y: number; w: number; h: number } | null
  livePreviewIsScribble?: boolean
  /** Selected-render composite: each entry drawn full-frame, clipped to its
   *  region (null = full frame), in array order (first = bottom). */
  layerRenders?: Array<{
    layerId: string
    img: HTMLImageElement
    region: { x: number; y: number; w: number; h: number } | null
  }>
  liveGenLatencyS?: number
  liveGenBusy?: boolean
  onMaskStrokeStarted?: () => void
  onMaskStrokeCommitted?: (layerId: string) => void
}

function hasBoundsGeometry(geometry: AnnotationGeometry): geometry is Extract<AnnotationGeometry, { start: Vec2; end: Vec2 }> {
  return 'start' in geometry && 'end' in geometry
}

function isInlineEditableGeometry(geometry: AnnotationGeometry): geometry is Extract<AnnotationGeometry, { kind: InlineEditableKind }> {
  return geometry.kind === 'text' || geometry.kind === 'card' || geometry.kind === 'list'
}

function createStructuredGeometry(tool: StructuredObjectTool, seed: string) {
  const lines = seed
    .split(/\n|\|/)
    .map((line) => line.trim())
    .filter(Boolean)

  switch (tool) {
    case 'card':
      return {
        kind: 'card' as const,
        start: { x: 0, y: 0 },
        end: { x: DETAIL_CARD_BASE_WIDTH, y: DETAIL_CARD_BASE_HEIGHT },
        body: lines.length > 0 ? lines.slice(0, 5) : ['Collaborative object', 'Shared through Yjs'],
      }
    case 'grid':
      return {
        kind: 'grid' as const,
        start: { x: 0, y: 0 },
        end: { x: 320, y: 220 },
        title: lines[0] ?? 'Review grid',
        rows: 4,
        columns: 4,
      }
    case 'list':
      return {
        kind: 'list' as const,
        start: { x: 0, y: 0 },
        end: { x: 280, y: 190 },
        title: lines[0] ?? 'Shared list',
        items: lines.slice(1, 7).length > 0 ? lines.slice(1, 7) : ['First item', 'Second item', 'Third item'],
      }
  }
}

export function AnnotationViewport({
  title,
  adapter,
  room,
  annotations,
  participants,
  activeTool,
  selectedId,
  onSelect,
  authorId,
  authorName,
  authorColor,
  textValue,
  onToolChange,
  freehandPipelineOptions,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onDeleteSelected,
  annotatorMode,
  onAnnotatorModeChange,
  activeMaskLayerId,
  maskLayers,
  maskPreviewMode = false,
  onMaskPreviewModeChange,
  imageDims,
  liveGenEnabled = false,
  onLiveGenEnabledChange,
  livePreviewImage,
  livePreviewRegion = null,
  livePreviewIsScribble = false,
  layerRenders = [],
  liveGenLatencyS,
  liveGenBusy = false,
  onMaskStrokeStarted,
  onMaskStrokeCommitted,
}: ViewportProps) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const surfaceHostRef = useRef<HTMLDivElement>(null)
  const backgroundCanvasRef = useRef<HTMLCanvasElement>(null)
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null)
  // Dedicated layer for the generation-in-progress marching-ants border: the
  // main overlay only redraws on state changes, so the animation gets its own
  // canvas + rAF loop instead of forcing full scene redraws every frame.
  const genBusyCanvasRef = useRef<HTMLCanvasElement>(null)
  const genBusyRectRef = useRef<ScreenRect | null>(null)
  const surfaceControllerRef = useRef<ViewerSurfaceController | null>(null)
  const navigationRef = useRef<{ pointerId: number; lastPoint: Vec2 } | null>(null)
  const cardDragRef = useRef<CardDragState | null>(null)
  const freehandPipelineRef = useRef<FreehandStrokePipeline | null>(null)
  const draftRef = useRef<AnnotationEntity | null>(null)
  // Committed vertices of an in-progress polygon (click-to-add); null when idle.
  const polygonPointsRef = useRef<Vec2[] | null>(null)
  // brushScreenRadiusPx is the brush radius in screen pixels (see useState below).
  // Divided by getFrameScale at stroke start so the brush appears the same size
  // on screen regardless of zoom — matches Photoshop's behavior.

  function getFrameScale(frame: AnnotationFrame): number {
    const origin = projectionHost.project(frame, { x: 0, y: 0 }, viewport)
    const unit = projectionHost.project(frame, { x: 1, y: 0 }, viewport)
    if (!origin || !unit) return 1
    const scale = Math.hypot(unit.x - origin.x, unit.y - origin.y)
    return scale > 1e-6 ? scale : 1
  }
  const [draft, setDraft] = useState<AnnotationEntity | null>(null)
  const [dragPreview, setDragPreview] = useState<AnnotationEntity | null>(null)
  const [inlineEditorId, setInlineEditorId] = useState<string | null>(null)
  const [parametersPanelAnnotationId, setParametersPanelAnnotationId] = useState<string | null>(null)
  const [showAnnotationsInMaskMode, setShowAnnotationsInMaskMode] = useState(false)
  const [adapterVersion, setAdapterVersion] = useState(0)
  const [isSurfaceFocused, setIsSurfaceFocused] = useState(false)
  const [isCardMoveGripHovered, setIsCardMoveGripHovered] = useState(false)
  const [brushScreenRadiusPx, setBrushScreenRadiusPx] = useState(18)
  const [brushPointerPos, setBrushPointerPos] = useState<{ x: number; y: number } | null>(null)
  const size = useElementSize(surfaceRef)

  const viewport = useMemo<ViewportSize>(
    () => ({ width: size.width, height: size.height }),
    [size.height, size.width],
  )
  // The cached host now invalidates against adapter-supplied projection revisions,
  // so zoom and camera changes stay in sync without rebuilding the wrapper per update.
  const projectionHost = useMemo(() => createCachedProjectionHost(adapter), [adapter])

  // A video adapter exposes playback controls; detected structurally so this generic
  // viewport stays decoupled from the concrete factory.
  const videoAdapter = useMemo(
    () => ('getMediaState' in adapter ? (adapter as VideoViewerAdapter) : null),
    [adapter],
  )

  const activeMaskLayer = useMemo(
    () => (activeMaskLayerId ? maskLayers?.find((layer) => layer.id === activeMaskLayerId) : undefined),
    [activeMaskLayerId, maskLayers],
  )

  // Decoded reference images keyed by nexus8:// URI. Resolved lazily when the
  // active layer's reference changes; the tick re-runs the overlay effect once
  // a decode lands so the preview appears without a user interaction.
  const refImageCacheRef = useRef(new Map<string, HTMLImageElement | 'loading' | 'error'>())
  const [refImageTick, setRefImageTick] = useState(0)
  const activeReference = activeMaskLayer?.reference
  useEffect(() => {
    if (!activeReference || refImageCacheRef.current.has(activeReference)) {
      return
    }
    const cache = refImageCacheRef.current
    cache.set(activeReference, 'loading')
    let cancelled = false
    resolveNexus8Uri(activeReference).then((url) => {
      if (cancelled || !url) {
        if (!url) cache.set(activeReference, 'error')
        return
      }
      const image = new Image()
      image.onload = () => {
        if (!cancelled) {
          cache.set(activeReference, image)
          setRefImageTick((tick) => tick + 1)
        }
      }
      image.onerror = () => cache.set(activeReference, 'error')
      image.src = url
    })
    return () => {
      cancelled = true
    }
  }, [activeReference])

  const visibleAnnotations = useMemo(
    () => {
      // adapterVersion ticks on every frame callback, so video visibility recomputes
      // as the playhead moves.
      void adapterVersion
      const matched = annotations.filter((annotation) => annotationMatchesViewer(annotation, adapter))
      let filtered = matched
      if (videoAdapter) {
        const media = videoAdapter.getMediaState()
        filtered = filtered.filter((annotation) =>
          isAnnotationVisibleAtPlaybackTime(annotation, {
            currentTime: media.currentTime,
            playlistCurrentTime: media.playlistCurrentTime,
            playlistDuration: media.playlistDuration,
            frameRate: media.frameRate,
            currentFrame: media.currentFrame,
            activeClipId: media.activeClipId,
            sourceLabel: media.sourceLabel,
          }),
        )
      }
      // In annotate mode mask strokes are irrelevant — hide them entirely.
      if (annotatorMode === 'annotate') {
        filtered = filtered.filter((annotation) => !annotation.maskRegion)
      }
      // In mask mode: active layer's mask strokes always show; other mask layers
      // show only when their visible flag is true (reference toggled via the panel eye icon).
      // Non-mask annotations are hidden by default and shown only when the
      // "Show annotations" toolbar toggle is on.
      if (annotatorMode === 'mask') {
        if (!showAnnotationsInMaskMode) {
          filtered = filtered.filter((annotation) => annotation.maskRegion)
        }
        if (activeMaskLayerId) {
          const visibleMaskLayerIds = new Set(
            (maskLayers ?? [])
              .filter((l) => l.visible)
              .map((l) => l.id),
          )
          filtered = filtered.filter(
            (annotation) => !annotation.maskRegion || visibleMaskLayerIds.has(annotation.layerId),
          )
        }
      }
      return filtered
    },
    [activeMaskLayerId, adapter, adapterVersion, annotatorMode, annotations, maskLayers, showAnnotationsInMaskMode, videoAdapter],
  )
  const selectedAnnotation = useMemo(
    () => (selectedId ? annotations.find((annotation) => annotation.id === selectedId) : undefined),
    [annotations, selectedId],
  )
  const visibleAnnotationEntries = useMemo(
    () => visibleAnnotations.map((annotation) => ({
      annotation,
      selected: annotation.id === selectedId,
      collapseUnselectedWorldMarker: true,
    })),
    [selectedId, visibleAnnotations],
  )
  const annotationHitIndex = useMemo(() => {
    void adapterVersion
    return buildAnnotationSpatialIndex({
      entries: visibleAnnotationEntries,
      context: { projectionHost, viewport },
    })
  }, [adapterVersion, projectionHost, viewport, visibleAnnotationEntries])
  const selectedImageAnnotation = useMemo(() => {
    if (
      !selectedAnnotation
      || selectedAnnotation.frame.space !== 'image2d'
      || !annotationMatchesViewer(selectedAnnotation, adapter)
    ) {
      return undefined
    }

    return selectedAnnotation
  }, [adapter, selectedAnnotation])
  const orderedImageAnnotations = useMemo(() => {
    if (!selectedImageAnnotation) {
      return []
    }

    return visibleAnnotations.filter((annotation) => (
      annotation.frame.space === selectedImageAnnotation.frame.space
      && annotation.frame.targetId === selectedImageAnnotation.frame.targetId
    ))
  }, [selectedImageAnnotation, visibleAnnotations])
  const selectedImageAnnotationIndex = useMemo(() => (
    selectedImageAnnotation
      ? orderedImageAnnotations.findIndex((annotation) => annotation.id === selectedImageAnnotation.id)
      : -1
  ), [orderedImageAnnotations, selectedImageAnnotation])
  const selectedBounds = useMemo(
    () => {
      void adapterVersion
      return selectedImageAnnotation ? getAnnotationScreenBounds(selectedImageAnnotation, adapter, viewport) : null
    },
    [adapter, adapterVersion, selectedImageAnnotation, viewport],
  )
  const inlineEditableSelection = useMemo(() => {
    if (!selectedImageAnnotation || !isInlineEditableGeometry(selectedImageAnnotation.geometry)) {
      return undefined
    }

    return selectedImageAnnotation
  }, [selectedImageAnnotation])
  const inlineTextSelection = inlineEditableSelection?.geometry.kind === 'text'
    ? (inlineEditableSelection as TextAnnotation)
    : null
  const inlineCardSelection = inlineEditableSelection?.geometry.kind === 'card'
    ? (inlineEditableSelection as CardAnnotation)
    : null
  const inlineListSelection = inlineEditableSelection?.geometry.kind === 'list'
    ? (inlineEditableSelection as ListAnnotation)
    : null
  const inlineEditorLayout = useMemo(() => {
    if (!selectedBounds) {
      return null
    }

    if (inlineCardSelection) {
      return {
        left: selectedBounds.left,
        top: selectedBounds.top,
        width: Math.max(1, selectedBounds.width),
        height: Math.max(1, selectedBounds.height),
      }
    }

    const maxWidth = Math.max(32, viewport.width - 16)
    const desiredWidth = Math.min(Math.max(selectedBounds.width, 220), maxWidth)
    const width = Math.min(desiredWidth, maxWidth)

    const height = undefined

    const left = Math.min(Math.max(selectedBounds.left, 8), Math.max(8, viewport.width - width - 8))
    const top = height !== undefined
      ? Math.min(Math.max(selectedBounds.top, 8), Math.max(8, viewport.height - height - 8))
      : Math.max(8, selectedBounds.top)

    return {
      left,
      top,
      width,
      height,
    }
  }, [inlineCardSelection, selectedBounds, viewport.height, viewport.width])
  const inlineCardMetrics = useMemo(() => {
    if (!inlineCardSelection || !inlineEditorLayout?.height) {
      return null
    }

    return getDetailCardMetrics(inlineEditorLayout.width, inlineEditorLayout.height)
  }, [inlineCardSelection, inlineEditorLayout])
  const isInlineEditorOpen = inlineEditableSelection
    ? inlineEditorId === inlineEditableSelection.id
    : false
  const isParametersPanelOpen = Boolean(
    selectedImageAnnotation && parametersPanelAnnotationId === selectedImageAnnotation.id,
  )

  const viewerActions = useMemo(() => {
    void adapterVersion
    return adapter.getActions?.() ?? []
  }, [adapter, adapterVersion])
  const statusBadges = adapter.getStatusBadges?.(viewport) ?? []
  // adapterVersion ticks on every adapter emit (load progress, ready, camera),
  // so the loading overlay and the ready gate stay live.
  const loadState = useMemo(() => {
    void adapterVersion
    return adapter.getLoadState?.() ?? null
  }, [adapter, adapterVersion])
  // Adapters without a load state (image/video) are always drawable; a 3D model
  // is only drawable once its surface and framing camera are settled.
  const isViewerReady = !loadState || loadState.status === 'ready'
  const diagnostics = adapter.getDiagnostics?.() ?? []
  const selectedAnnotationIsVisible = Boolean(selectedAnnotation && annotationMatchesViewer(selectedAnnotation, adapter))
  const viewerToolbarGroups = useMemo<ViewerToolbarGroup[]>(() => {
    // Mask mode (brush/polygon) only applies to still images; video and 3D use annotate-only.
    const isMaskCapable = adapter.space === 'image2d' && !videoAdapter

    const modeGroup: ViewerToolbarGroup = {
      id: 'mode',
      items: isMaskCapable ? [
        {
          id: 'mode-annotate',
          label: 'Annotate',
          icon: VIEWER_TOOL_ICONS.annotateMode,
          active: annotatorMode === 'annotate',
          onSelect: () => {
            onAnnotatorModeChange('annotate')
            if (activeTool === 'brush' || activeTool === 'polygon') {
              onToolChange('select')
            }
          },
        },
        {
          id: 'mode-mask',
          label: 'Mask',
          icon: VIEWER_TOOL_ICONS.maskMode,
          active: annotatorMode === 'mask',
          onSelect: () => {
            onAnnotatorModeChange('mask')
            if (activeTool !== 'select' && activeTool !== 'brush' && activeTool !== 'polygon') {
              onToolChange('brush')
            }
          },
        },
      ] : [],
    }

    let toolIds: ViewerToolbarToolId[]
    if (adapter.space !== 'image2d') {
      toolIds = ['select', 'freehand', 'rectangle', 'ellipse']
    } else if (videoAdapter) {
      toolIds = ['select', 'freehand', 'rectangle', 'ellipse', 'text', 'card']
    } else if (annotatorMode === 'mask') {
      toolIds = ['select', 'brush', 'polygon']
    } else {
      toolIds = ['select', 'freehand', 'rectangle', 'ellipse', 'text', 'card']
    }

    const toolLabels: Record<ViewerToolbarToolId, string> = {
      select: 'Select',
      freehand: 'Freehand',
      brush: 'Brush',
      polygon: 'Polygon',
      rectangle: 'Rectangle',
      ellipse: 'Ellipse',
      text: 'Text',
      card: 'Card',
    }

    const toolGroup: ViewerToolbarGroup = {
      id: 'tools',
      items: toolIds.map((toolId) => ({
        id: toolId,
        label: toolLabels[toolId],
        icon: VIEWER_TOOL_ICONS[toolId],
        active: activeTool === toolId,
        onSelect: () => onToolChange(toolId),
      })),
    }

    const historyGroup: ViewerToolbarGroup = {
      id: 'history',
      items: [
        {
          id: 'delete-selected',
          label: 'Delete selected',
          icon: VIEWER_TOOL_ICONS.deleteSelected,
          tone: 'danger',
          disabled: !selectedAnnotationIsVisible,
          onSelect: onDeleteSelected,
        },
        {
          id: 'undo',
          label: 'Undo',
          icon: VIEWER_TOOL_ICONS.undo,
          disabled: !canUndo,
          onSelect: onUndo,
        },
        {
          id: 'redo',
          label: 'Redo',
          icon: VIEWER_TOOL_ICONS.redo,
          disabled: !canRedo,
          onSelect: onRedo,
        },
      ],
    }

    const contextItems = viewerActions.map((action) => ({
      id: action.id,
      label: action.label,
      icon: getViewerToolbarActionIcon(action.id),
      active: action.active,
      onSelect: () => action.onSelect(viewport),
    }))

    if (adapter.space === 'image2d' && selectedImageAnnotation) {
      contextItems.unshift({
        id: 'parameters',
        label: isParametersPanelOpen ? 'Close parameters' : 'Open parameters',
        icon: VIEWER_TOOL_ICONS.parameters,
        active: isParametersPanelOpen,
        onSelect: () => setParametersPanelAnnotationId((current) =>
          current === selectedImageAnnotation.id ? null : selectedImageAnnotation.id),
      })
    }

    const maskDisplayGroup: ViewerToolbarGroup = {
      id: 'mask-display',
      items: annotatorMode === 'mask' ? [
        {
          id: 'show-annotations',
          label: showAnnotationsInMaskMode ? 'Hide annotations' : 'Show annotations',
          icon: Layers,
          active: showAnnotationsInMaskMode,
          onSelect: () => setShowAnnotationsInMaskMode((v) => !v),
        },
        {
          id: 'mask-preview',
          label: 'Op preview',
          icon: Eye,
          active: maskPreviewMode,
          disabled: !activeMaskLayer?.mask_op,
          onSelect: () => onMaskPreviewModeChange?.(!maskPreviewMode),
        },
        {
          id: 'live-inpaint',
          label: liveGenBusy ? 'Live gen (generating…)' : 'Live gen',
          icon: Sparkles,
          active: liveGenEnabled,
          disabled: !(
            activeMaskLayer?.mask_op === 'remove' ||
            ((activeMaskLayer?.mask_op === 'inpaint' ||
              activeMaskLayer?.mask_op === 'scribble' ||
              activeMaskLayer?.mask_op === 'sketch_inpaint') &&
              activeMaskLayer?.prompt?.trim())
          ),
          onSelect: () => onLiveGenEnabledChange?.(!liveGenEnabled),
        },
      ] : [],
    }

    return [
      modeGroup,
      toolGroup,
      maskDisplayGroup,
      historyGroup,
      { id: 'viewer', items: contextItems },
    ]
  }, [
    activeMaskLayer,
    activeTool,
    adapter,
    annotatorMode,
    canRedo,
    canUndo,
    isParametersPanelOpen,
    liveGenBusy,
    liveGenEnabled,
    maskPreviewMode,
    onAnnotatorModeChange,
    onDeleteSelected,
    onLiveGenEnabledChange,
    onMaskPreviewModeChange,
    onRedo,
    onToolChange,
    onUndo,
    selectedAnnotationIsVisible,
    selectedImageAnnotation,
    showAnnotationsInMaskMode,
    videoAdapter,
    viewerActions,
    viewport,
  ])

  function updateSelectedImageAnnotation(update: (annotation: AnnotationEntity) => AnnotationEntity) {
    if (!selectedImageAnnotation) {
      return
    }

    room.store.upsertAnnotation(update(selectedImageAnnotation))
  }

  useEffect(() => {
    draftRef.current = draft
  }, [draft])

  function isPointInsideCircle(point: Vec2, circle: { x: number; y: number; radius: number }) {
    return Math.hypot(point.x - circle.x, point.y - circle.y) <= circle.radius * 1.5
  }

  function getCardGripBounds(annotation: CardAnnotation) {
    const bounds = getAnnotationScreenBounds(annotation, adapter, viewport)
    if (!bounds) {
      return null
    }

    return getCardMoveHandleTargets(bounds)
  }

  function findHitAnnotation(screenPoint: Vec2) {
    return annotationHitIndex
      .queryPoint(screenPoint)
      .map((entry) => ({
        annotation: entry.annotation,
        score: defaultAnnotationRenderPluginManager.hitTest(entry, screenPoint, { projectionHost, viewport }),
      }))
      .find((result) => result.score !== null)
  }

  useEffect(() => {
    if (!adapter.subscribe) {
      return
    }

    return adapter.subscribe(() => {
      setAdapterVersion((current) => current + 1)
    })
  }, [adapter])

  useEffect(() => {
    if (!adapter.mountSurface || !surfaceHostRef.current) {
      return
    }

    const controller = adapter.mountSurface(surfaceHostRef.current)
    surfaceControllerRef.current = controller

    return () => {
      if (surfaceControllerRef.current === controller) {
        surfaceControllerRef.current = null
      }
      controller.dispose()
    }
  }, [adapter])

  useEffect(() => {
    surfaceControllerRef.current?.resize(viewport)
  }, [viewport])

  useEffect(() => {
    if (!adapter.onSelectionChange) {
      return
    }

    if (!selectedAnnotation || !annotationMatchesViewer(selectedAnnotation, adapter)) {
      adapter.onSelectionChange(undefined)
      return
    }

    adapter.onSelectionChange(selectedAnnotation)
  }, [adapter, selectedAnnotation])

  useEffect(() => {
    if (!isSurfaceFocused) {
      return
    }

    const handlePointerDownOutside = (event: PointerEvent) => {
      if (!surfaceRef.current?.contains(event.target as Node)) {
        setIsSurfaceFocused(false)
      }
    }

    window.addEventListener('pointerdown', handlePointerDownOutside)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDownOutside)
    }
  }, [isSurfaceFocused])

  useEffect(() => {
    const surface = surfaceRef.current
    const handleAdapterWheel = adapter.handleWheel
    if (!surface || !handleAdapterWheel) {
      return
    }

    // No focus gate: zoom (wheel / trackpad pinch) engages the moment the
    // cursor is over the surface, like the first brush press — requiring a
    // priming click here made pinch feel dead after picking a tool.
    const handleNativeWheel = (event: WheelEvent) => {
      const bounds = surface.getBoundingClientRect()
      const screenPoint = {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      }

      if (
        screenPoint.x < 0 ||
        screenPoint.y < 0 ||
        screenPoint.x > bounds.width ||
        screenPoint.y > bounds.height
      ) {
        return
      }

      if (handleAdapterWheel(screenPoint, event.deltaY, viewport)) {
        event.preventDefault()
      }
    }

    surface.addEventListener('wheel', handleNativeWheel, { passive: false })
    return () => {
      surface.removeEventListener('wheel', handleNativeWheel)
    }
  }, [adapter, viewport])

  useEffect(() => {
    const canvas = backgroundCanvasRef.current
    if (adapter.mountSurface || !canvas || viewport.width === 0 || viewport.height === 0) {
      return
    }

    const context = canvas.getContext('2d')
    if (!context) {
      return
    }

    const pixelRatio = window.devicePixelRatio || 1
    canvas.width = Math.floor(viewport.width * pixelRatio)
    canvas.height = Math.floor(viewport.height * pixelRatio)
    canvas.style.width = `${viewport.width}px`
    canvas.style.height = `${viewport.height}px`
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    adapter.renderBackdrop(context, viewport)
  }, [adapter, adapterVersion, viewport])

  useEffect(() => {
    const canvas = overlayCanvasRef.current
    if (!canvas || viewport.width === 0 || viewport.height === 0) {
      return
    }

    const context = canvas.getContext('2d')
    if (!context) {
      return
    }

    const pixelRatio = window.devicePixelRatio || 1
    canvas.width = Math.floor(viewport.width * pixelRatio)
    canvas.height = Math.floor(viewport.height * pixelRatio)
    canvas.style.width = `${viewport.width}px`
    canvas.style.height = `${viewport.height}px`
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    context.clearRect(0, 0, viewport.width, viewport.height)
    // Recomputed below when a generation is in flight; nulled first so stale
    // rects never survive a mode/layer switch.
    genBusyRectRef.current = null
    // Hold markers off until the surface is drawable — before a 3D model loads
    // and frames the camera, anchors would project against an unsettled view.
    if (!isViewerReady) {
      return
    }
    // Selected-render composite: every render-visible layer's pinned render,
    // stacked bottom-to-top in panel order. Drawn under stroke primitives so
    // guide strokes (their own visibility toggle) stay legible on top; the
    // active layer's op preview and live-gen overlay composite above both.
    if (annotatorMode === 'mask' && imageDims && layerRenders.length > 0) {
      const toScreen = (x: number, y: number) => adapter.worldToScreen({ x, y, z: 0 }, viewport)
      const screenRect = (x: number, y: number, w: number, h: number): ScreenRect | null => {
        const tl = toScreen(x, y)
        const br = toScreen(x + w, y + h)
        if (!tl || !br) {
          return null
        }
        return {
          x: Math.min(tl.x, br.x),
          y: Math.min(tl.y, br.y),
          w: Math.abs(br.x - tl.x),
          h: Math.abs(br.y - tl.y),
        }
      }
      const imageRect = screenRect(0, 0, imageDims.width, imageDims.height)
      if (imageRect) {
        for (const entry of layerRenders) {
          const clipRect = entry.region
            ? screenRect(entry.region.x, entry.region.y, entry.region.w, entry.region.h)
            : null
          if (entry.region && !clipRect) {
            continue
          }
          context.save()
          if (clipRect) {
            context.beginPath()
            context.rect(clipRect.x, clipRect.y, clipRect.w, clipRect.h)
            context.clip()
          }
          // Renders are full-frame images; mapping to the image rect keeps
          // them pixel-aligned with the base regardless of clip region.
          context.drawImage(entry.img, imageRect.x, imageRect.y, imageRect.w, imageRect.h)
          context.restore()
        }
      }
    }

    const plan = buildAnnotationSceneRenderPlan({
      projectionHost,
      viewport,
      annotations: [
        ...visibleAnnotations
          .filter((annotation) => !((isInlineEditorOpen && annotation.id === inlineEditorId) || annotation.id === dragPreview?.id))
          .map((annotation) => ({
            annotation,
            selected: annotation.id === selectedId,
          })),
        ...(dragPreview ? [{ annotation: dragPreview, selected: dragPreview.id === selectedId }] : []),
        ...(draft ? [{ annotation: draft, selected: false, alphaMultiplier: 0.7, collapseUnselectedWorldMarker: false }] : []),
      ],
      participants: participants.filter((participant) => participant.viewerId === adapter.id && participant.cursor),
    })

    renderPrimitiveBatchesToCanvas(context, plan.batches)

    // Second pass: operation preview + live AI overlay for the active mask layer.
    // Composited above stroke primitives; never touches the annotation list.
    if (annotatorMode === 'mask' && activeMaskLayer && imageDims) {
      const maskShapes = visibleAnnotations.filter(
        (annotation) => annotation.maskRegion && annotation.layerId === activeMaskLayer.id,
      )
      const bounds = computeMaskBounds(maskShapes)
      if (bounds) {
        const projectRect = (x: number, y: number, w: number, h: number): ScreenRect | null => {
          const z = bounds.frame.origin.z
          const tl = projectionHost.project(bounds.frame, worldToFrameLocal(bounds.frame, { x, y, z }), viewport)
          const br = projectionHost.project(
            bounds.frame,
            worldToFrameLocal(bounds.frame, { x: x + w, y: y + h, z }),
            viewport,
          )
          if (!tl || !br) {
            return null
          }
          return {
            x: Math.min(tl.x, br.x),
            y: Math.min(tl.y, br.y),
            w: Math.abs(br.x - tl.x),
            h: Math.abs(br.y - tl.y),
          }
        }
        if (liveGenBusy) {
          // Scribble regenerates the full frame; every other op is bounded by
          // the mask strokes. The rAF loop reads this rect each frame.
          const busyRegion =
            activeMaskLayer.mask_op === 'scribble'
              ? { x: 0, y: 0, w: imageDims.width, h: imageDims.height }
              : bounds
          genBusyRectRef.current = projectRect(busyRegion.x, busyRegion.y, busyRegion.w, busyRegion.h)
        }
        if (maskPreviewMode && activeMaskLayer.mask_op) {
          void refImageTick
          const cached = activeMaskLayer.reference
            ? refImageCacheRef.current.get(activeMaskLayer.reference)
            : undefined
          renderMaskOpPreview(context, {
            layer: activeMaskLayer,
            bounds,
            imageDims,
            referenceImage: cached instanceof HTMLImageElement ? cached : null,
            projectRect,
          })
        }
        if (livePreviewImage) {
          const imageRect = projectRect(0, 0, imageDims.width, imageDims.height)
          if (imageRect) {
            if (livePreviewIsScribble) {
              renderScribblePreviewOverlay(
                context,
                livePreviewImage,
                imageRect,
                liveGenLatencyS != null ? `${liveGenLatencyS.toFixed(1)}s` : '',
                !liveGenBusy,
              )
            } else {
              // History previews carry the run's own region; live results
              // fall back to the current strokes' bounds.
              const region = livePreviewRegion ?? bounds
              const bbox = projectRect(region.x, region.y, region.w, region.h)
              if (bbox) {
                renderLivePreviewOverlay(
                  context,
                  livePreviewImage,
                  imageRect,
                  bbox,
                  liveGenLatencyS != null ? `${liveGenLatencyS.toFixed(1)}s` : '',
                  !liveGenBusy,
                )
              }
            }
          }
        }
      }
    }

    // Brush cursor ring — drawn last so it always appears on top.
    if (activeTool === 'brush' && brushPointerPos && !draft) {
      context.save()
      context.beginPath()
      context.arc(brushPointerPos.x, brushPointerPos.y, brushScreenRadiusPx, 0, Math.PI * 2)
      context.strokeStyle = 'rgba(255,255,255,0.9)'
      context.lineWidth = 1.5
      context.stroke()
      context.beginPath()
      context.arc(brushPointerPos.x, brushPointerPos.y, brushScreenRadiusPx, 0, Math.PI * 2)
      context.strokeStyle = 'rgba(0,0,0,0.5)'
      context.lineWidth = 0.75
      context.stroke()
      context.restore()
    }
  }, [activeMaskLayer, activeTool, adapter, adapterVersion, annotatorMode, brushPointerPos, brushScreenRadiusPx, dragPreview, draft, imageDims, inlineEditorId, isInlineEditorOpen, isViewerReady, layerRenders, liveGenBusy, liveGenLatencyS, livePreviewImage, livePreviewIsScribble, livePreviewRegion, maskPreviewMode, participants, projectionHost, refImageTick, selectedId, viewport, visibleAnnotations])

  // Marching-ants border while a generation is in flight. Runs on its own
  // canvas so the 60fps dash animation never triggers React re-renders or full
  // scene redraws; the main draw effect keeps genBusyRectRef current across
  // pan/zoom and the loop just reads it each frame.
  useEffect(() => {
    const canvas = genBusyCanvasRef.current
    if (!canvas || viewport.width === 0 || viewport.height === 0) {
      return
    }
    const context = canvas.getContext('2d')
    if (!context) {
      return
    }
    const pixelRatio = window.devicePixelRatio || 1
    canvas.width = Math.floor(viewport.width * pixelRatio)
    canvas.height = Math.floor(viewport.height * pixelRatio)
    canvas.style.width = `${viewport.width}px`
    canvas.style.height = `${viewport.height}px`
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    if (!liveGenBusy) {
      return
    }
    let raf = 0
    const draw = (time: number) => {
      context.clearRect(0, 0, viewport.width, viewport.height)
      const rect = genBusyRectRef.current
      if (rect && rect.w > 0 && rect.h > 0) {
        context.save()
        context.setLineDash([6, 4])
        context.lineDashOffset = -((time / 40) % 10)
        context.strokeStyle = 'rgba(94, 234, 212, 0.95)'
        context.lineWidth = 1.5
        context.strokeRect(rect.x, rect.y, rect.w, rect.h)
        context.restore()
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      context.clearRect(0, 0, viewport.width, viewport.height)
    }
  }, [liveGenBusy, viewport])

  function pointerToLocal(event: { clientX: number; clientY: number }) {
    const canvas = overlayCanvasRef.current
    if (!canvas) {
      return null
    }
    const bounds = canvas.getBoundingClientRect()
    return {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    }
  }

  // Screen pixels covered by one frame-local unit, used to keep the freehand
  // stabilizer/simplifier scale-invariant. Image frames are pixel-space already
  // (return 1, preserving existing behaviour); world-anchored 3D frames use tiny
  // world units, so we normalize to pixel-equivalent space for the pipeline.
  function freehandCoordinateScale(frame: AnnotationFrame): number {
    if (frame.space !== 'world3d') {
      return 1
    }
    const origin = projectionHost.project(frame, { x: 0, y: 0 }, viewport)
    const unit = projectionHost.project(frame, { x: 1, y: 0 }, viewport)
    if (!origin || !unit) {
      return 1
    }
    const pixels = Math.hypot(unit.x - origin.x, unit.y - origin.y)
    return pixels > 1e-6 ? pixels : 1
  }

  function beginDraft(tool: Exclude<AnnotationTool, 'select' | 'text'>, screenPoint: Vec2, timestamp: number) {
    const worldPoint = adapter.screenToWorld(screenPoint, viewport)
    if (!worldPoint) {
      return null
    }
    const frame = adapter.createFrame(worldPoint)
    const now = Date.now()
    // Polygon is placed vertex-by-vertex in handlePointerDown, not as a drag draft.
    if (tool === 'polygon') {
      return null
    }
    const coordinateScale = freehandCoordinateScale(frame)
    if (tool === 'freehand') {
      const pipeline = new FreehandStrokePipeline(freehandPipelineOptions, coordinateScale)
      freehandPipelineRef.current = pipeline
      const initialPoints = pipeline.addPoint({ x: 0, y: 0, timestamp })
      return {
        id: crypto.randomUUID(),
        layerId: DEFAULT_LAYER_ID,
        frame,
        geometry: { kind: 'freehand', points: initialPoints.length > 0 ? initialPoints : [{ x: 0, y: 0 }] },
        style: {
          stroke: authorColor,
          fill: `${authorColor}22`,
          strokeWidth: 2,
          opacity: 1,
          fontSize: 15,
        },
        authorId,
        authorName,
        createdAt: now,
        updatedAt: now,
        version: 0,
      } satisfies AnnotationEntity
    }

    if (tool === 'brush') {
      const pipeline = new FreehandStrokePipeline(freehandPipelineOptions, coordinateScale)
      freehandPipelineRef.current = pipeline
      const initialPoints = pipeline.addPoint({ x: 0, y: 0, timestamp })
      return {
        id: crypto.randomUUID(),
        layerId: activeMaskLayerId ?? DEFAULT_LAYER_ID,
        frame,
        geometry: {
          kind: 'brush',
          points: initialPoints.length > 0 ? initialPoints : [{ x: 0, y: 0 }],
          radius: brushScreenRadiusPx / getFrameScale(frame),
        },
        style: {
          stroke: authorColor,
          fill: `${authorColor}55`,
          strokeWidth: 2,
          opacity: 0.85,
          fontSize: 15,
        },
        maskRegion: true,
        authorId,
        authorName,
        createdAt: now,
        updatedAt: now,
        version: 0,
      } satisfies AnnotationEntity
    }

    if (isStructuredObjectTool(tool)) {
      const isCardTool = tool === 'card'
      return {
        id: crypto.randomUUID(),
        layerId: DEFAULT_LAYER_ID,
        frame,
        geometry: createStructuredGeometry(tool, textValue.trim()),
        style: {
          stroke: isCardTool ? 'rgba(16, 36, 58, 0.14)' : authorColor,
          fill: isCardTool ? '#91c9ff' : `${authorColor}20`,
          strokeWidth: 2,
          opacity: 1,
          fontSize: 15,
        },
        authorId,
        authorName,
        createdAt: now,
        updatedAt: now,
        version: 0,
      } satisfies AnnotationEntity
    }

    return {
      id: crypto.randomUUID(),
      layerId: DEFAULT_LAYER_ID,
      frame,
      geometry: { kind: tool, start: { x: 0, y: 0 }, end: { x: 0, y: 0 } },
      style: {
        stroke: authorColor,
        fill: `${authorColor}22`,
        strokeWidth: 2,
        opacity: 1,
        fontSize: 15,
      },
      authorId,
      authorName,
      createdAt: now,
      updatedAt: now,
      version: 0,
    } satisfies AnnotationEntity
  }

  function commitDraft(annotation: AnnotationEntity | null) {
    freehandPipelineRef.current = null
    if (!annotation) {
      return
    }

    if (annotation.geometry.kind === 'freehand' && annotation.geometry.points.length < 2) {
      return
    }

    if (hasBoundsGeometry(annotation.geometry)) {
      const bounds = normalizeBounds(annotation.geometry.start, annotation.geometry.end)
      // The degenerate-shape threshold is in screen pixels. Bounds are in
      // frame-local units (image pixels for 2D, but world units for 3D, where a
      // visibly-large shape spans only a fraction of a unit). Scale local size
      // up to screen pixels so the guard means the same thing in both spaces;
      // freehandCoordinateScale() returns 1 for 2D, preserving prior behaviour.
      const scale = freehandCoordinateScale(annotation.frame)
      if (
        Math.abs(bounds.maxX - bounds.minX) * scale < 0.4
        || Math.abs(bounds.maxY - bounds.minY) * scale < 0.4
      ) {
        return
      }
    }

    room.store.upsertAnnotation(annotation)
    onSelect(annotation.id)
    // Single hook for the live-generation loop: covers brush pointer-up and
    // polygon double-click/Enter commits alike.
    if (annotation.maskRegion) {
      onMaskStrokeCommitted?.(annotation.layerId)
    }
  }

  function dedupePolygonPoints(points: Vec2[]) {
    const result: Vec2[] = []
    for (const point of points) {
      const last = result[result.length - 1]
      if (!last || vec2Distance(last, point) > 0.5) {
        result.push(point)
      }
    }
    return result
  }

  function finishPolygon() {
    const committed = polygonPointsRef.current
    const current = draftRef.current
    polygonPointsRef.current = null
    setDraft(null)
    if (!committed || !current || current.geometry.kind !== 'polygon') {
      return
    }
    const points = dedupePolygonPoints(committed)
    if (points.length < 3) {
      return
    }
    commitDraft({ ...current, geometry: { kind: 'polygon', points }, maskRegion: true })
  }

  function cancelPolygon() {
    if (polygonPointsRef.current) {
      polygonPointsRef.current = null
      setDraft(null)
    }
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (activeTool === 'polygon' && polygonPointsRef.current) {
      if (event.key === 'Enter') {
        event.preventDefault()
        finishPolygon()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        cancelPolygon()
      }
    }
    if (activeTool === 'brush' && annotatorMode === 'mask') {
      if (event.key === '[') {
        event.preventDefault()
        setBrushScreenRadiusPx((r) => Math.max(1, r - 4))
      } else if (event.key === ']') {
        event.preventDefault()
        setBrushScreenRadiusPx((r) => Math.min(100, r + 4))
      }
    }
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    const screenPoint = pointerToLocal(event)
    if (!screenPoint) {
      return
    }

    // Ignore input until the viewer surface is drawable (e.g. 3D model still loading).
    if (!isViewerReady) {
      return
    }

    setIsSurfaceFocused(true)
    // preventScroll: a plain focus() scrolls the surface into view, shifting
    // the page under the cursor mid-press — the stroke then lands offset and
    // the first click reads as "focus only". Drawing must start exactly where
    // the artist pressed.
    surfaceRef.current?.focus({ preventScroll: true })

    event.currentTarget.setPointerCapture(event.pointerId)

    if (
      adapter.beginNavigation?.(
        screenPoint,
        {
          button: event.button,
          altKey: event.altKey,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
        },
        viewport,
      )
    ) {
      navigationRef.current = { pointerId: event.pointerId, lastPoint: screenPoint }
      return
    }

    room.setLocalCursor(adapter.id, screenPoint, activeTool)

    // Editing has resumed — invalidate any stale live-inpaint overlay immediately.
    if (annotatorMode === 'mask' && (activeTool === 'brush' || activeTool === 'polygon')) {
      onMaskStrokeStarted?.()
    }

    if (activeTool === 'select') {
      const hit = findHitAnnotation(screenPoint)
      if (hit?.annotation.id) {
        if (inlineEditorId && inlineEditorId !== hit.annotation.id) {
          setInlineEditorId(null)
        }
        if (
          hit.annotation.frame.space === 'image2d'
          && hit.annotation.geometry.kind === 'card'
        ) {
          onSelect(hit.annotation.id)
          if (event.detail > 1) {
            setInlineEditorId(hit.annotation.id)
            return
          }
          const gripBounds = getCardGripBounds(hit.annotation as CardAnnotation)
          if (gripBounds?.some((handle) => isPointInsideCircle(screenPoint, handle))) {
            const localPoint = adapter.screenToFrameLocal(screenPoint, hit.annotation.frame, viewport)
            if (!localPoint) {
              return
            }
            cardDragRef.current = {
              pointerId: event.pointerId,
              annotation: hit.annotation as CardAnnotation,
              startLocal: localPoint,
              moved: false,
            }
          }
          return
        }
        if (
          event.detail > 1
          && hit.annotation.id === selectedId
          && hit.annotation.frame.space === 'image2d'
          && isInlineEditableGeometry(hit.annotation.geometry)
        ) {
          setInlineEditorId(hit.annotation.id)
          return
        }
        onSelect(hit.annotation.id)
        return
      }

      const selectedSceneObject = adapter.selectSceneObjectAt?.(screenPoint, viewport) ?? false
      setInlineEditorId(null)
      onSelect(undefined)
      if (selectedSceneObject) {
        return
      }
      return
    }

    if (activeTool === 'text') {
      const worldPoint = adapter.screenToWorld(screenPoint, viewport)
      if (!worldPoint) {
        return
      }
      const now = Date.now()
      const annotation: AnnotationEntity = {
        id: crypto.randomUUID(),
        layerId: DEFAULT_LAYER_ID,
        frame: adapter.createFrame(worldPoint),
        geometry: {
          kind: 'text',
          position: { x: 0, y: 0 },
          text: textValue.trim() || 'Anchored note',
        },
        style: {
          stroke: authorColor,
          fill: 'rgba(2, 6, 23, 0.78)',
          strokeWidth: 2,
          opacity: 1,
          fontSize: 15,
        },
        authorId,
        authorName,
        createdAt: now,
        updatedAt: now,
        version: 0,
      }
      room.store.upsertAnnotation(annotation)
      onSelect(annotation.id)
      return
    }

    if (activeTool === 'polygon') {
      const inProgress = polygonPointsRef.current && draftRef.current?.geometry.kind === 'polygon'
      if (!inProgress) {
        const worldPoint = adapter.screenToWorld(screenPoint, viewport)
        if (!worldPoint) {
          return
        }
        const frame = adapter.createFrame(worldPoint)
        const now = Date.now()
        polygonPointsRef.current = [{ x: 0, y: 0 }]
        setDraft({
          id: crypto.randomUUID(),
          layerId: activeMaskLayerId ?? DEFAULT_LAYER_ID,
          frame,
          geometry: { kind: 'polygon', points: [{ x: 0, y: 0 }, { x: 0, y: 0 }] },
          style: {
            stroke: authorColor,
            fill: `${authorColor}33`,
            strokeWidth: 2,
            opacity: 1,
            fontSize: 15,
          },
          maskRegion: true,
          authorId,
          authorName,
          createdAt: now,
          updatedAt: now,
          version: 0,
        })
      } else {
        const local = adapter.screenToFrameLocal(screenPoint, draftRef.current!.frame, viewport)
        if (!local) {
          return
        }
        const committed = [...(polygonPointsRef.current ?? []), local]
        polygonPointsRef.current = committed
        setDraft((prev) =>
          prev && prev.geometry.kind === 'polygon'
            ? { ...prev, geometry: { kind: 'polygon', points: [...committed, local] } }
            : prev,
        )
      }
      return
    }

    const nextDraft = beginDraft(activeTool, screenPoint, event.nativeEvent.timeStamp)
    if (nextDraft) {
      setBrushPointerPos(null)
      setDraft(nextDraft)
    }
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const screenPoint = pointerToLocal(event)
    if (!screenPoint) {
      return
    }

    if (activeTool === 'select' && selectedImageAnnotation?.geometry.kind === 'card' && !isInlineEditorOpen) {
      const gripBounds = getCardGripBounds(selectedImageAnnotation as CardAnnotation)
      setIsCardMoveGripHovered(Boolean(gripBounds?.some((handle) => isPointInsideCircle(screenPoint, handle))))
    } else if (isCardMoveGripHovered) {
      setIsCardMoveGripHovered(false)
    }

    if (navigationRef.current?.pointerId === event.pointerId) {
      const delta = {
        x: screenPoint.x - navigationRef.current.lastPoint.x,
        y: screenPoint.y - navigationRef.current.lastPoint.y,
      }
      navigationRef.current = { pointerId: event.pointerId, lastPoint: screenPoint }
      adapter.updateNavigation?.(screenPoint, delta, viewport)
      return
    }

    if (cardDragRef.current?.pointerId === event.pointerId) {
      const localPoint = adapter.screenToFrameLocal(screenPoint, cardDragRef.current.annotation.frame, viewport)
      if (!localPoint) {
        return
      }

      const deltaX = localPoint.x - cardDragRef.current.startLocal.x
      const deltaY = localPoint.y - cardDragRef.current.startLocal.y
      if (!cardDragRef.current.moved && Math.hypot(deltaX, deltaY) < 1.2) {
        return
      }

      cardDragRef.current.moved = true
      setInlineEditorId(null)
      setDragPreview({
        ...cardDragRef.current.annotation,
        geometry: {
          ...cardDragRef.current.annotation.geometry,
          start: {
            x: cardDragRef.current.annotation.geometry.start.x + deltaX,
            y: cardDragRef.current.annotation.geometry.start.y + deltaY,
          },
          end: {
            x: cardDragRef.current.annotation.geometry.end.x + deltaX,
            y: cardDragRef.current.annotation.geometry.end.y + deltaY,
          },
        },
      })
      return
    }

    room.setLocalCursor(adapter.id, screenPoint, activeTool)

    if (activeTool === 'brush' && !draft) {
      setBrushPointerPos(screenPoint)
    }

    if (!draft) {
      return
    }

    if (draft.geometry.kind === 'polygon') {
      const local = adapter.screenToFrameLocal(screenPoint, draft.frame, viewport)
      if (!local || !polygonPointsRef.current) {
        return
      }
      const committed = polygonPointsRef.current
      setDraft((current) =>
        current && current.geometry.kind === 'polygon'
          ? { ...current, geometry: { kind: 'polygon', points: [...committed, local] } }
          : current,
      )
      return
    }

    if (draft.geometry.kind === 'freehand' || draft.geometry.kind === 'brush') {
      const coalescedEvents = event.nativeEvent.getCoalescedEvents?.() ?? [event.nativeEvent]
      for (const pointerEvent of coalescedEvents) {
        const nextScreenPoint = pointerToLocal(pointerEvent)
        if (!nextScreenPoint) {
          continue
        }

        const local = adapter.screenToFrameLocal(nextScreenPoint, draft.frame, viewport)
        if (!local) {
          continue
        }

        freehandPipelineRef.current?.addPoint({
          x: local.x,
          y: local.y,
          pressure: pointerEvent.pressure,
          timestamp: pointerEvent.timeStamp,
        })
      }

      const previewPoints = freehandPipelineRef.current?.getPreviewPoints() ?? draft.geometry.points
      setDraft((current) => {
        if (!current || (current.geometry.kind !== 'freehand' && current.geometry.kind !== 'brush')) {
          return current
        }

        const lastPoint = current.geometry.points[current.geometry.points.length - 1]
        const nextLastPoint = previewPoints[previewPoints.length - 1]
        if (
          previewPoints.length === current.geometry.points.length
          && lastPoint
          && nextLastPoint
          && vec2Distance(lastPoint, nextLastPoint) < 0.001
        ) {
          return current
        }

        return {
          ...current,
          geometry:
            current.geometry.kind === 'brush'
              ? { kind: 'brush', points: previewPoints, radius: current.geometry.radius }
              : { kind: 'freehand', points: previewPoints },
        }
      })
      return
    }

    const local = adapter.screenToFrameLocal(screenPoint, draft.frame, viewport)
    if (!local) {
      return
    }

    setDraft((current) => {
      if (!current) {
        return null
      }

      if (current.geometry.kind === 'freehand') {
        const lastPoint = current.geometry.points[current.geometry.points.length - 1]
        if (lastPoint && vec2Distance(lastPoint, local) < 0.2) {
          return current
        }
        return {
          ...current,
          geometry: {
            kind: 'freehand',
            points: [...current.geometry.points, local],
          },
        }
      }

      if (hasBoundsGeometry(current.geometry)) {
        return {
          ...current,
          geometry: {
            ...current.geometry,
            end: local,
          },
        }
      }

      return current
    })
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    if (navigationRef.current?.pointerId === event.pointerId) {
      navigationRef.current = null
      adapter.endNavigation?.()
      return
    }

    if (cardDragRef.current?.pointerId === event.pointerId) {
      const currentDrag = cardDragRef.current
      cardDragRef.current = null
      if (currentDrag.moved && dragPreview?.id === currentDrag.annotation.id) {
        room.store.upsertAnnotation(dragPreview)
        onSelect(dragPreview.id)
      } else {
        onSelect(currentDrag.annotation.id)
      }
      setDragPreview(null)
      return
    }

    // Polygon commits on double-click / Enter, not on pointer up.
    if (draftRef.current?.geometry.kind === 'polygon') {
      return
    }

    if (
      freehandPipelineRef.current &&
      (draftRef.current?.geometry.kind === 'freehand' || draftRef.current?.geometry.kind === 'brush')
    ) {
      const finalizedPoints = freehandPipelineRef.current.finish()
      const geometry = draftRef.current.geometry
      commitDraft({
        ...draftRef.current,
        geometry:
          geometry.kind === 'brush'
            ? { kind: 'brush', points: finalizedPoints, radius: geometry.radius }
            : { kind: 'freehand', points: finalizedPoints },
      })
      setDraft(null)
      return
    }

    commitDraft(draftRef.current)
    setDraft(null)
  }

  function handlePointerLeave() {
    if (isCardMoveGripHovered) {
      setIsCardMoveGripHovered(false)
    }
    if (brushPointerPos) {
      setBrushPointerPos(null)
    }
    room.clearLocalCursor()
  }

  function handleDoubleClick(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (activeTool === 'polygon' && polygonPointsRef.current) {
      finishPolygon()
      return
    }

    const screenPoint = pointerToLocal(event)
    if (!screenPoint || activeTool !== 'select') {
      return
    }

    const hit = findHitAnnotation(screenPoint)

    if (hit?.annotation.frame.space === 'image2d' && hit.annotation.geometry.kind === 'card') {
      onSelect(hit.annotation.id)
      setInlineEditorId(hit.annotation.id)
    }
  }

  return (
    <article className="viewer-card">
      <header className="viewer-card__header">
        <div>
          <h3>{title}</h3>
          <p>{adapter.description}</p>
        </div>
        <div className="viewer-card__meta">
          <span className="viewer-badge">{visibleAnnotations.length} visible</span>
        </div>
      </header>
      <ViewerToolbar groups={viewerToolbarGroups} />
      {annotatorMode === 'mask' && activeTool === 'brush' && (
        <div className="viewer-brush-options">
          <label className="viewer-brush-options__label">
            Size
            <span className="viewer-brush-options__value">{brushScreenRadiusPx * 2}</span>
          </label>
          <input
            type="range"
            min={1}
            max={100}
            step={2}
            value={brushScreenRadiusPx}
            onChange={(e) => setBrushScreenRadiusPx(parseInt(e.target.value, 10))}
            className="viewer-brush-options__slider"
          />
          <span className="viewer-brush-options__hint">[ / ] keys to adjust</span>
        </div>
      )}
      <div
        className={isSurfaceFocused ? 'viewer-surface viewer-surface--focused' : 'viewer-surface'}
        ref={surfaceRef}
        tabIndex={0}
        onFocus={() => setIsSurfaceFocused(true)}
        onBlur={() => setIsSurfaceFocused(false)}
        onKeyDown={handleKeyDown}
      >
        {adapter.mountSurface ? (
          <div ref={surfaceHostRef} className="viewer-surface__host" />
        ) : (
          <canvas ref={backgroundCanvasRef} className="viewer-canvas viewer-canvas--background" />
        )}
        {loadState && loadState.status !== 'ready' ? (
          <div
            className={`viewer-loading-overlay viewer-loading-overlay--${loadState.status}`}
            role="status"
            aria-live="polite"
          >
            <div className="viewer-loading-overlay__inner">
              {loadState.status === 'error' ? (
                <span className="viewer-loading-overlay__icon" aria-hidden>!</span>
              ) : (
                <span className="viewer-loading-spinner" aria-hidden />
              )}
              <span className="viewer-loading-overlay__label">{loadState.label}</span>
              {loadState.status === 'loading' && loadState.progress !== null ? (
                <div className="viewer-loading-progress">
                  <div
                    className="viewer-loading-progress__bar"
                    style={{ width: `${Math.round(loadState.progress * 100)}%` }}
                  />
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
        {inlineEditableSelection && inlineEditorLayout && inlineEditorId === inlineEditableSelection.id ? (
          <div
            className={
              inlineCardSelection
                ? 'viewer-inline-editor viewer-inline-editor--card'
                : inlineListSelection
                  ? 'viewer-inline-editor viewer-inline-editor--list'
                  : inlineTextSelection
                    ? 'viewer-inline-editor viewer-inline-editor--text'
                    : 'viewer-inline-editor'
            }
            style={{
              left: `${inlineEditorLayout.left}px`,
              top: `${inlineEditorLayout.top}px`,
              width: `${inlineEditorLayout.width}px`,
              height: inlineCardSelection && inlineEditorLayout.height !== undefined ? `${inlineEditorLayout.height}px` : undefined,
              backgroundColor: selectedImageAnnotation?.style.fill,
              borderColor: selectedImageAnnotation?.style.stroke,
              ['--inline-stroke' as const]: selectedImageAnnotation?.style.stroke,
              ['--inline-fill' as const]: selectedImageAnnotation?.style.fill,
              ['--inline-card-radius' as const]: inlineCardMetrics ? `${inlineCardMetrics.radius}px` : undefined,
              ['--inline-card-padding' as const]: inlineCardMetrics ? `${inlineCardMetrics.paddingX}px` : undefined,
              ['--inline-card-font-size' as const]: inlineCardMetrics ? `${inlineCardMetrics.bodySize}px` : undefined,
              ['--inline-card-line-height' as const]: inlineCardMetrics ? `${inlineCardMetrics.lineHeight}px` : undefined,
            } as CSSProperties}
          >
            {inlineTextSelection ? (
              <textarea
                autoFocus
                value={inlineTextSelection.geometry.text}
                onChange={(event) => updateSelectedImageAnnotation(() => ({
                  ...inlineTextSelection,
                  geometry: {
                    ...inlineTextSelection.geometry,
                    text: event.currentTarget.value,
                  },
                }))}
              />
            ) : null}
            {inlineCardSelection ? (
              <>
                <textarea
                  autoFocus
                  value={inlineCardSelection.geometry.body.join('\n')}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      setInlineEditorId(null)
                      return
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      setInlineEditorId(null)
                      onToolChange('select')
                    }
                  }}
                  onChange={(event) => updateSelectedImageAnnotation(() => ({
                    ...inlineCardSelection,
                    geometry: {
                      ...inlineCardSelection.geometry,
                      body: event.currentTarget.value.split('\n'),
                    },
                  }))}
                />
              </>
            ) : null}
            {inlineListSelection ? (
              <>
                <input
                  autoFocus
                  value={inlineListSelection.geometry.title}
                  onChange={(event) => updateSelectedImageAnnotation(() => ({
                    ...inlineListSelection,
                    geometry: {
                      ...inlineListSelection.geometry,
                      title: event.currentTarget.value,
                    },
                  }))}
                />
                <textarea
                  value={inlineListSelection.geometry.items.join('\n')}
                  onChange={(event) => updateSelectedImageAnnotation(() => ({
                    ...inlineListSelection,
                    geometry: {
                      ...inlineListSelection.geometry,
                      items: event.currentTarget.value.split('\n'),
                    },
                  }))}
                />
              </>
            ) : null}
          </div>
        ) : null}
        {inlineEditableSelection && selectedBounds && inlineEditableSelection.geometry.kind !== 'card' && !isInlineEditorOpen ? (
          <button
            type="button"
            className="viewer-inline-launch"
            style={{
              left: `${Math.max(8, selectedBounds.left)}px`,
              top: `${Math.max(8, selectedBounds.top - 36)}px`,
            }}
            onClick={() => setInlineEditorId(inlineEditableSelection.id)}
          >
            Inline edit
          </button>
        ) : null}
        {adapter.space === 'image2d' && selectedImageAnnotation && isParametersPanelOpen ? (
          <Suspense fallback={null}>
            <LazyAnnotationMantineEditor
              annotation={selectedImageAnnotation}
              viewport={viewport}
              onClose={() => setParametersPanelAnnotationId(null)}
              onUpdate={(annotation) => updateSelectedImageAnnotation(() => annotation)}
              onMoveBackward={() => room.store.moveAnnotationBackward(selectedImageAnnotation.id)}
              onMoveForward={() => room.store.moveAnnotationForward(selectedImageAnnotation.id)}
              canMoveBackward={selectedImageAnnotationIndex > 0}
              canMoveForward={selectedImageAnnotationIndex > -1 && selectedImageAnnotationIndex < orderedImageAnnotations.length - 1}
              inlineAvailable={Boolean(inlineEditableSelection)}
              onOpenInline={() => {
                if (inlineEditableSelection) {
                  setInlineEditorId(inlineEditableSelection.id)
                }
              }}
            />
          </Suspense>
        ) : null}
        <canvas
          ref={overlayCanvasRef}
          className={isCardMoveGripHovered
            ? 'viewer-canvas viewer-canvas--overlay viewer-canvas--overlay-card-move'
            : 'viewer-canvas viewer-canvas--overlay'}
          style={activeTool === 'brush' && annotatorMode === 'mask' ? { cursor: 'none' } : undefined}
          onContextMenu={(event) => event.preventDefault()}
          onDoubleClick={handleDoubleClick}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerLeave={handlePointerLeave}
        />
        <canvas ref={genBusyCanvasRef} className="viewer-canvas viewer-canvas--gen-busy" />
      </div>
      {videoAdapter ? <VideoTransport adapter={videoAdapter} /> : null}
      <footer className="viewer-card__footer">
        <span>{adapter.space === 'image2d' ? 'Image-space anchors' : 'World-space anchors'}</span>
        {statusBadges.map((badge) => (
          <span key={badge} className="viewer-footer-badge">
            {badge}
          </span>
        ))}
        <span>{selectedId ? `Selected: ${selectedId.slice(0, 8)}` : 'No active selection'}</span>
      </footer>
      {diagnostics.length > 0 ? (
        <dl className="viewer-diagnostics">
          {diagnostics.map((item) => (
            <div key={item.label} className="viewer-diagnostics__item">
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </article>
  )
}
