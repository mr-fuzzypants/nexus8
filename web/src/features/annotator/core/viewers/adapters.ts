import type {
  AnnotationEntity,
  AnnotationFrame,
  Vec2,
  Vec3,
  ViewerSpace,
} from '../annotations/types'
import type { AnnotationProjectionHost, ViewportSize } from '../rendering/host'

export type { ViewportSize } from '../rendering/host'

export interface NavigationOptions {
  button: number
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}

export interface ViewerAction {
  id: string
  label: string
  onSelect: (viewport: ViewportSize) => void
  active?: boolean
}

export interface ViewerDiagnosticItem {
  label: string
  value: string
}

export type ViewerLoadStatus = 'pending' | 'loading' | 'ready' | 'error'

export interface ViewerLoadState {
  status: ViewerLoadStatus
  /** Download fraction in 0..1 when determinate, null when unknown/indeterminate. */
  progress: number | null
  /** Human-readable status for a loading overlay. */
  label: string
}

export interface ViewerSurfaceController {
  resize: (viewport: ViewportSize) => void
  dispose: () => void
}

export interface ViewerAdapter extends AnnotationProjectionHost {
  id: string
  name: string
  description: string
  space: ViewerSpace
  targetId?: string
  createFrame(origin: Vec3): AnnotationFrame
  worldToScreen(worldPoint: Vec3, viewport: ViewportSize): Vec2 | null
  screenToWorld(screenPoint: Vec2, viewport: ViewportSize): Vec3 | null
  renderBackdrop(context: CanvasRenderingContext2D, viewport: ViewportSize): void
  formatAnchor(frame: AnnotationFrame): string
  mountSurface?: (host: HTMLElement) => ViewerSurfaceController
  subscribe?: (listener: () => void) => () => void
  onSelectionChange?: (annotation?: AnnotationEntity) => void
  getStatusBadges?: (viewport: ViewportSize) => string[]
  /** Reports asset readiness so the viewport can defer annotations until the surface is drawable. */
  getLoadState?: () => ViewerLoadState
  getDiagnostics?: () => ViewerDiagnosticItem[]
  getActions?: () => ViewerAction[]
  selectSceneObjectAt?: (screenPoint: Vec2, viewport: ViewportSize) => boolean
  handleWheel?: (screenPoint: Vec2, deltaY: number, viewport: ViewportSize) => boolean
  beginNavigation?: (
    screenPoint: Vec2,
    options: NavigationOptions,
    viewport: ViewportSize,
  ) => boolean
  /**
   * Like beginNavigation, but for view-only surfaces where there is no drawing
   * tool competing for the primary drag. Each adapter starts its most natural
   * gesture on a plain primary drag (orbit for 3D, pan for 2D/video) and pans on
   * shift/secondary. Falls back to beginNavigation when unimplemented.
   */
  beginViewNavigation?: (
    screenPoint: Vec2,
    options: NavigationOptions,
    viewport: ViewportSize,
  ) => boolean
  updateNavigation?: (screenPoint: Vec2, delta: Vec2, viewport: ViewportSize) => void
  endNavigation?: () => void
}

export function frameMatchesViewer(frame: AnnotationFrame, adapter: ViewerAdapter) {
  if (frame.space !== adapter.space) {
    return false
  }

  if (!adapter.targetId) {
    return true
  }

  return frame.targetId === adapter.targetId
}

export function annotationMatchesViewer(annotation: AnnotationEntity, adapter: ViewerAdapter) {
  return frameMatchesViewer(annotation.frame, adapter)
}

function frameToWorld(frame: AnnotationFrame, localPoint: Vec2): Vec3 {
  return {
    x: frame.origin.x + frame.xAxis.x * localPoint.x + frame.yAxis.x * localPoint.y,
    y: frame.origin.y + frame.xAxis.y * localPoint.x + frame.yAxis.y * localPoint.y,
    z: frame.origin.z + frame.xAxis.z * localPoint.x + frame.yAxis.z * localPoint.y,
  }
}

function worldToFrame(frame: AnnotationFrame, worldPoint: Vec3): Vec2 {
  const dx = worldPoint.x - frame.origin.x
  const dy = worldPoint.y - frame.origin.y
  const dz = worldPoint.z - frame.origin.z
  return {
    x:
      dx * frame.xAxis.x + dy * frame.xAxis.y + dz * frame.xAxis.z,
    y:
      dx * frame.yAxis.x + dy * frame.yAxis.y + dz * frame.yAxis.z,
  }
}

const ISO_SCALE_X = 18
const ISO_SCALE_Y = 9
const ISO_SCALE_Z = 22

function worldViewportCenter(viewport: ViewportSize) {
  return {
    centerX: viewport.width / 2,
    centerY: viewport.height * 0.64,
  }
}

export const worldViewerAdapter: ViewerAdapter = {
  id: 'world-viewer',
  name: '3D anchor plane',
  description: 'World-space coordinates projected onto an isometric guide plane.',
  space: 'world3d',
  createFrame(origin) {
    return {
      space: 'world3d',
      origin,
      xAxis: { x: 1, y: 0, z: 0 },
      yAxis: { x: 0, y: 1, z: 0 },
      targetId: 'world-plane',
    }
  },
  worldToScreen(worldPoint, viewport) {
    const scale = Math.min(viewport.width / 28, viewport.height / 18)
    const { centerX, centerY } = worldViewportCenter(viewport)
    return {
      x: centerX + (worldPoint.x - worldPoint.y) * scale * (ISO_SCALE_X / 20),
      y:
        centerY +
        (worldPoint.x + worldPoint.y) * scale * (ISO_SCALE_Y / 20) -
        worldPoint.z * scale * (ISO_SCALE_Z / 20),
    }
  },
  screenToWorld(screenPoint, viewport) {
    const scale = Math.min(viewport.width / 28, viewport.height / 18)
    const { centerX, centerY } = worldViewportCenter(viewport)
    const a = (screenPoint.x - centerX) / (scale * (ISO_SCALE_X / 20))
    const b = (screenPoint.y - centerY) / (scale * (ISO_SCALE_Y / 20))
    const x = (a + b) / 2
    const y = (b - a) / 2
    if (x < -8 || x > 8 || y < -8 || y > 8) {
      return null
    }
    return { x, y, z: 0 }
  },
  project(frame, localPoint, viewport) {
    return worldViewerAdapter.worldToScreen(frameToWorld(frame, localPoint), viewport)
  },
  screenToFrameLocal(screenPoint, frame, viewport) {
    const worldPoint = worldViewerAdapter.screenToWorld(screenPoint, viewport)
    return worldPoint ? worldToFrame(frame, worldPoint) : null
  },
  renderBackdrop(context, viewport) {
    context.clearRect(0, 0, viewport.width, viewport.height)
    const gradient = context.createLinearGradient(0, 0, 0, viewport.height)
    gradient.addColorStop(0, '#05060b')
    gradient.addColorStop(1, '#161b2c')
    context.fillStyle = gradient
    context.fillRect(0, 0, viewport.width, viewport.height)

    context.strokeStyle = 'rgba(94, 234, 212, 0.18)'
    context.lineWidth = 1
    for (let line = -8; line <= 8; line += 1) {
      const startA = worldViewerAdapter.worldToScreen({ x: -8, y: line, z: 0 }, viewport)
      const endA = worldViewerAdapter.worldToScreen({ x: 8, y: line, z: 0 }, viewport)
      const startB = worldViewerAdapter.worldToScreen({ x: line, y: -8, z: 0 }, viewport)
      const endB = worldViewerAdapter.worldToScreen({ x: line, y: 8, z: 0 }, viewport)
      if (startA && endA) {
        context.beginPath()
        context.moveTo(startA.x, startA.y)
        context.lineTo(endA.x, endA.y)
        context.stroke()
      }
      if (startB && endB) {
        context.beginPath()
        context.moveTo(startB.x, startB.y)
        context.lineTo(endB.x, endB.y)
        context.stroke()
      }
    }

    const box = [
      { x: -3, y: -2, z: 0 },
      { x: -1, y: -2, z: 0 },
      { x: -1, y: 1, z: 0 },
      { x: -3, y: 1, z: 0 },
      { x: -3, y: -2, z: 2.6 },
      { x: -1, y: -2, z: 2.6 },
      { x: -1, y: 1, z: 2.6 },
      { x: -3, y: 1, z: 2.6 },
    ]
    const projected = box.map((point) => worldViewerAdapter.worldToScreen(point, viewport))
    context.strokeStyle = 'rgba(255, 255, 255, 0.28)'
    context.lineWidth = 2
    const edges = [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7],
    ]
    edges.forEach(([start, end]) => {
      const from = projected[start]
      const to = projected[end]
      if (!from || !to) {
        return
      }
      context.beginPath()
      context.moveTo(from.x, from.y)
      context.lineTo(to.x, to.y)
      context.stroke()
    })

    context.fillStyle = '#f8fafc'
    context.font = '700 30px Inter, system-ui, sans-serif'
    context.fillText('World anchor plane', 28, 46)
    context.font = '500 16px Inter, system-ui, sans-serif'
    context.fillStyle = 'rgba(248, 250, 252, 0.76)'
    context.fillText('Stage 1 uses the same annotation document with world-space anchors.', 28, 74)
  },
  formatAnchor(frame) {
    return `world(${frame.origin.x.toFixed(2)}, ${frame.origin.y.toFixed(2)}, ${frame.origin.z.toFixed(2)})`
  },
}
