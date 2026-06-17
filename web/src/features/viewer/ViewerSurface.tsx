import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { AnnotationEntity, Vec2 } from '../annotator/core/annotations/types'
import type { ViewerAdapter, ViewportSize } from '../annotator/core/viewers/adapters'
import type { VideoViewerAdapter } from '../annotator/core/viewers/videoAdapter'
import { createCachedProjectionHost } from '../annotator/core/rendering/host'
import { buildAnnotationSceneRenderPlan } from '../annotator/core/rendering/renderService'
import { renderPrimitiveBatchesToCanvas } from '../annotator/core/rendering/canvasRenderer'
import { isAnnotationVisibleAtPlaybackTime } from '../annotator/core/annotations/timeline'
import { useElementSize } from '../annotator/hooks/useElementSize'
import { VideoTransport } from '../annotator/components/VideoTransport'
import '../annotator/annotator.css'
import './viewer.css'

/**
 * Size a canvas to the viewport, but only reallocate its backing store when the
 * pixel dimensions actually change. Reallocating every frame (the video adapter
 * emits per presented frame) thrashes the GPU and janks playback. Returns true
 * when the backing store was resized (and therefore cleared by the browser).
 */
function sizeCanvas(canvas: HTMLCanvasElement, viewport: ViewportSize, pixelRatio: number): boolean {
  const width = Math.floor(viewport.width * pixelRatio)
  const height = Math.floor(viewport.height * pixelRatio)
  if (canvas.width === width && canvas.height === height) {
    return false
  }
  canvas.width = width
  canvas.height = height
  canvas.style.width = `${viewport.width}px`
  canvas.style.height = `${viewport.height}px`
  return true
}

interface ViewerSurfaceProps {
  adapter: ViewerAdapter
  /** Existing annotations to overlay, read-only. */
  annotations?: AnnotationEntity[]
  /** Toggle the read-only annotation overlay. */
  showAnnotations?: boolean
}

/**
 * A read-only, reusable viewer surface. It mounts any ViewerAdapter (2D / video /
 * 3D), supports navigation (orbit/pan/zoom) and video transport, and can overlay
 * existing annotations without any editing tools, selection, or collaboration.
 *
 * This is the view-only counterpart to AnnotationViewport — it shares the same
 * adapters, projection host, and render pipeline, but owns none of the authoring
 * surface (drafts, hit-testing, inline editors, undo/redo).
 */
export function ViewerSurface({ adapter, annotations = [], showAnnotations = true }: ViewerSurfaceProps) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const surfaceHostRef = useRef<HTMLDivElement>(null)
  const backgroundCanvasRef = useRef<HTMLCanvasElement>(null)
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null)
  const navigationRef = useRef<{ pointerId: number; lastPoint: Vec2 } | null>(null)
  const surfaceControllerRef = useRef<{ resize: (viewport: ViewportSize) => void } | null>(null)
  const [adapterVersion, setAdapterVersion] = useState(0)
  const size = useElementSize(surfaceRef)

  const viewport = useMemo<ViewportSize>(
    () => ({ width: size.width, height: size.height }),
    [size.height, size.width],
  )
  const projectionHost = useMemo(() => createCachedProjectionHost(adapter), [adapter])
  const videoAdapter = useMemo(
    () => ('getMediaState' in adapter ? (adapter as VideoViewerAdapter) : null),
    [adapter],
  )

  const loadState = useMemo(() => {
    void adapterVersion
    return adapter.getLoadState?.() ?? null
  }, [adapter, adapterVersion])
  const isViewerReady = !loadState || loadState.status === 'ready'

  const visibleAnnotations = useMemo(
    () => {
      // adapterVersion ticks as the playhead moves so video visibility recomputes.
      void adapterVersion
      const matched = annotations.filter((annotation) => annotation.frame.space === adapter.space
        && (!adapter.targetId || annotation.frame.targetId === adapter.targetId))
      if (!videoAdapter) {
        return matched
      }
      const media = videoAdapter.getMediaState()
      return matched.filter((annotation) =>
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
    },
    [adapter.space, adapter.targetId, adapterVersion, annotations, videoAdapter],
  )

  // Re-render on every adapter emit (camera/zoom/playhead/load progress).
  useEffect(() => adapter.subscribe?.(() => setAdapterVersion((v) => v + 1)), [adapter])

  // Mount the adapter's own surface (canvas/video element) when it provides one.
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

  // Keep the live adapter sized to the surface.
  useEffect(() => {
    surfaceControllerRef.current?.resize(viewport)
  }, [viewport])

  // 2D tiled (and other backdrop) adapters draw onto a background canvas.
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
    sizeCanvas(canvas, viewport, pixelRatio)
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    adapter.renderBackdrop(context, viewport)
  }, [adapter, adapterVersion, viewport])

  // Read-only annotation overlay. The adapter emits per video frame, so this
  // effect runs every frame — but it only repaints when the projection or the
  // visible set actually changes (a re-key), keeping native playback smooth.
  const overlayKeyRef = useRef<string>('')
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
    const resized = sizeCanvas(canvas, viewport, pixelRatio)
    const projectionRevision = adapter.getProjectionRevision?.() ?? String(adapterVersion)
    const key = [
      viewport.width,
      viewport.height,
      pixelRatio,
      showAnnotations && isViewerReady ? 1 : 0,
      projectionRevision,
      visibleAnnotations.map((annotation) => annotation.id).join(','),
    ].join('|')
    // Nothing visible changed and the canvas wasn't cleared by a resize: skip.
    if (!resized && key === overlayKeyRef.current) {
      return
    }
    overlayKeyRef.current = key
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    context.clearRect(0, 0, viewport.width, viewport.height)
    if (!showAnnotations || !isViewerReady) {
      return
    }
    const plan = buildAnnotationSceneRenderPlan({
      projectionHost,
      viewport,
      annotations: visibleAnnotations.map((annotation) => ({ annotation, selected: false })),
    })
    renderPrimitiveBatchesToCanvas(context, plan.batches)
  }, [adapter, adapterVersion, isViewerReady, projectionHost, showAnnotations, viewport, visibleAnnotations])

  // Wheel zoom — only preventDefault when the adapter actually consumes it.
  useEffect(() => {
    const surface = surfaceRef.current
    const handleAdapterWheel = adapter.handleWheel
    if (!surface || !handleAdapterWheel) {
      return
    }
    const handleNativeWheel = (event: WheelEvent) => {
      const bounds = surface.getBoundingClientRect()
      const screenPoint = { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
      if (handleAdapterWheel(screenPoint, event.deltaY, viewport)) {
        event.preventDefault()
      }
    }
    surface.addEventListener('wheel', handleNativeWheel, { passive: false })
    return () => surface.removeEventListener('wheel', handleNativeWheel)
  }, [adapter, viewport])

  function pointerToLocal(event: { clientX: number; clientY: number }): Vec2 | null {
    const canvas = overlayCanvasRef.current
    if (!canvas) {
      return null
    }
    const bounds = canvas.getBoundingClientRect()
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    const screenPoint = pointerToLocal(event)
    if (!screenPoint || !isViewerReady) {
      return
    }
    const options = {
      button: event.button,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
    }
    const begin = adapter.beginViewNavigation ?? adapter.beginNavigation
    if (begin?.(screenPoint, options, viewport)) {
      event.currentTarget.setPointerCapture(event.pointerId)
      navigationRef.current = { pointerId: event.pointerId, lastPoint: screenPoint }
    }
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (navigationRef.current?.pointerId !== event.pointerId) {
      return
    }
    const screenPoint = pointerToLocal(event)
    if (!screenPoint) {
      return
    }
    const delta = {
      x: screenPoint.x - navigationRef.current.lastPoint.x,
      y: screenPoint.y - navigationRef.current.lastPoint.y,
    }
    navigationRef.current = { pointerId: event.pointerId, lastPoint: screenPoint }
    adapter.updateNavigation?.(screenPoint, delta, viewport)
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (navigationRef.current?.pointerId === event.pointerId) {
      navigationRef.current = null
      adapter.endNavigation?.()
    }
  }

  return (
    <div className="viewer-only">
      <div className="viewer-surface viewer-only__surface" ref={surfaceRef}>
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
        <canvas
          ref={overlayCanvasRef}
          className="viewer-canvas viewer-canvas--overlay viewer-only__overlay"
          onContextMenu={(event) => event.preventDefault()}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />
      </div>
      {videoAdapter ? <VideoTransport adapter={videoAdapter} /> : null}
    </div>
  )
}
