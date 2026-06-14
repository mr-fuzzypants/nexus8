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
import {
  normalizeBounds,
  vec2Distance,
} from '../core/annotations/geometry'
import {
  FreehandStrokePipeline,
  type FreehandPipelineOptions,
} from '../core/annotations/freehandPipeline'
import type {
  AnnotationEntity,
  AnnotationGeometry,
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
}: ViewportProps) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const surfaceHostRef = useRef<HTMLDivElement>(null)
  const backgroundCanvasRef = useRef<HTMLCanvasElement>(null)
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null)
  const surfaceControllerRef = useRef<ViewerSurfaceController | null>(null)
  const navigationRef = useRef<{ pointerId: number; lastPoint: Vec2 } | null>(null)
  const cardDragRef = useRef<CardDragState | null>(null)
  const freehandPipelineRef = useRef<FreehandStrokePipeline | null>(null)
  const draftRef = useRef<AnnotationEntity | null>(null)
  // Committed vertices of an in-progress polygon (click-to-add); null when idle.
  const polygonPointsRef = useRef<Vec2[] | null>(null)
  const BRUSH_DEFAULT_RADIUS = 18
  const [draft, setDraft] = useState<AnnotationEntity | null>(null)
  const [dragPreview, setDragPreview] = useState<AnnotationEntity | null>(null)
  const [inlineEditorId, setInlineEditorId] = useState<string | null>(null)
  const [parametersPanelAnnotationId, setParametersPanelAnnotationId] = useState<string | null>(null)
  const [adapterVersion, setAdapterVersion] = useState(0)
  const [isSurfaceFocused, setIsSurfaceFocused] = useState(false)
  const [isCardMoveGripHovered, setIsCardMoveGripHovered] = useState(false)
  const size = useElementSize(surfaceRef)

  const viewport = useMemo<ViewportSize>(
    () => ({ width: size.width, height: size.height }),
    [size.height, size.width],
  )
  // The cached host now invalidates against adapter-supplied projection revisions,
  // so zoom and camera changes stay in sync without rebuilding the wrapper per update.
  const projectionHost = useMemo(() => createCachedProjectionHost(adapter), [adapter])

  const visibleAnnotations = useMemo(
    () => annotations.filter((annotation) => annotationMatchesViewer(annotation, adapter)),
    [adapter, annotations],
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
  const diagnostics = adapter.getDiagnostics?.() ?? []
  const selectedAnnotationIsVisible = Boolean(selectedAnnotation && annotationMatchesViewer(selectedAnnotation, adapter))
  const viewerToolbarGroups = useMemo<ViewerToolbarGroup[]>(() => {
    const toolIds: ViewerToolbarToolId[] = adapter.space === 'image2d'
      ? ['select', 'freehand', 'brush', 'polygon', 'rectangle', 'ellipse', 'text', 'card']
      : ['select', 'freehand', 'rectangle', 'ellipse']

    const toolLabels: Record<ViewerToolbarToolId, string> = {
      select: 'Select',
      freehand: 'Freehand',
      brush: 'Brush (mask)',
      polygon: 'Polygon (mask)',
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

    return [
      toolGroup,
      historyGroup,
      { id: 'viewer', items: contextItems },
    ]
  }, [
    activeTool,
    adapter,
    canRedo,
    canUndo,
    isParametersPanelOpen,
    onDeleteSelected,
    onRedo,
    onToolChange,
    onUndo,
    selectedAnnotationIsVisible,
    selectedImageAnnotation,
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

    const handleNativeWheel = (event: WheelEvent) => {
      if (!isSurfaceFocused) {
        return
      }

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
  }, [adapter, isSurfaceFocused, viewport])

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
  }, [adapter, adapterVersion, dragPreview, draft, inlineEditorId, isInlineEditorOpen, participants, projectionHost, selectedId, viewport, visibleAnnotations])

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
    if (tool === 'freehand') {
      const pipeline = new FreehandStrokePipeline(freehandPipelineOptions)
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
      const pipeline = new FreehandStrokePipeline(freehandPipelineOptions)
      freehandPipelineRef.current = pipeline
      const initialPoints = pipeline.addPoint({ x: 0, y: 0, timestamp })
      return {
        id: crypto.randomUUID(),
        layerId: DEFAULT_LAYER_ID,
        frame,
        geometry: {
          kind: 'brush',
          points: initialPoints.length > 0 ? initialPoints : [{ x: 0, y: 0 }],
          radius: BRUSH_DEFAULT_RADIUS,
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
      if (Math.abs(bounds.maxX - bounds.minX) < 0.4 || Math.abs(bounds.maxY - bounds.minY) < 0.4) {
        return
      }
    }

    room.store.upsertAnnotation(annotation)
    onSelect(annotation.id)
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
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    const screenPoint = pointerToLocal(event)
    if (!screenPoint) {
      return
    }

    setIsSurfaceFocused(true)
    surfaceRef.current?.focus()

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
          layerId: DEFAULT_LAYER_ID,
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
          onContextMenu={(event) => event.preventDefault()}
          onDoubleClick={handleDoubleClick}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerLeave={handlePointerLeave}
        />
      </div>
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
