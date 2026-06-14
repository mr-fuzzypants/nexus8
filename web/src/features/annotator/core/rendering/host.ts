import type { AnnotationFrame, Vec2 } from '../annotations/types'

export interface ViewportSize {
  width: number
  height: number
}

export interface AnnotationProjectionHost {
  project: (frame: AnnotationFrame, localPoint: Vec2, viewport: ViewportSize) => Vec2 | null
  screenToFrameLocal: (screenPoint: Vec2, frame: AnnotationFrame, viewport: ViewportSize) => Vec2 | null
  getProjectionRevision?: () => string
}

interface CachedProjectionEntry {
  result: Vec2 | null
}

export interface CachedProjectionHostOptions {
  maxEntries?: number
}

const DEFAULT_PROJECTION_CACHE_LIMIT = 4096

function rememberProjection(cache: Map<string, CachedProjectionEntry>, key: string, value: CachedProjectionEntry, limit: number) {
  cache.set(key, value)
  if (cache.size <= limit) {
    return value.result
  }

  const firstKey = cache.keys().next().value
  if (firstKey) {
    cache.delete(firstKey)
  }
  return value.result
}

function appendVec2Parts(parts: string[], value: Vec2 | undefined) {
  parts.push(`${value?.x ?? 0}`)
  parts.push(`${value?.y ?? 0}`)
}

function appendFrameParts(parts: string[], frame: AnnotationFrame) {
  parts.push(frame.space)
  parts.push(frame.targetId ?? '')
  parts.push(`${frame.origin.x}`)
  parts.push(`${frame.origin.y}`)
  parts.push(`${frame.origin.z}`)
  parts.push(`${frame.xAxis.x}`)
  parts.push(`${frame.xAxis.y}`)
  parts.push(`${frame.xAxis.z}`)
  parts.push(`${frame.yAxis.x}`)
  parts.push(`${frame.yAxis.y}`)
  parts.push(`${frame.yAxis.z}`)

  if (frame.cameraView) {
    parts.push(`${frame.cameraView.position.x}`)
    parts.push(`${frame.cameraView.position.y}`)
    parts.push(`${frame.cameraView.position.z}`)
    parts.push(`${frame.cameraView.target.x}`)
    parts.push(`${frame.cameraView.target.y}`)
    parts.push(`${frame.cameraView.target.z}`)
    parts.push(`${frame.cameraView.radius}`)
    parts.push(`${frame.cameraView.theta}`)
    parts.push(`${frame.cameraView.phi}`)
  } else {
    parts.push('')
  }

  if (frame.mediaBinding) {
    parts.push(`${frame.mediaBinding.time}`)
    parts.push(`${frame.mediaBinding.frame}`)
    parts.push(frame.mediaBinding.clipId ?? '')
    parts.push(frame.mediaBinding.clipLabel ?? '')
    parts.push(`${frame.mediaBinding.globalTime ?? ''}`)
  } else {
    parts.push('')
  }
}

function createProjectionCacheKey(
  frame: AnnotationFrame,
  localPoint: Vec2,
  viewport: ViewportSize,
  projectionRevision: string,
) {
  const parts = [
    `${viewport.width}`,
    `${viewport.height}`,
    projectionRevision,
  ]
  appendFrameParts(parts, frame)
  appendVec2Parts(parts, localPoint)
  return parts.join('|')
}

export function createCachedProjectionHost(
  projectionHost: AnnotationProjectionHost,
  options: CachedProjectionHostOptions = {},
): AnnotationProjectionHost {
  const limit = options.maxEntries ?? DEFAULT_PROJECTION_CACHE_LIMIT
  const cache = new Map<string, CachedProjectionEntry>()

  return {
    project(frame, localPoint, viewport) {
      // Projection caches must invalidate on zoom, pan, and camera changes in addition
      // to frame and viewport changes. Hosts expose that moving projection state through
      // getProjectionRevision() so callers do not need to manually rebuild the cache.
      const key = createProjectionCacheKey(
        frame,
        localPoint,
        viewport,
        projectionHost.getProjectionRevision?.() ?? '',
      )
      const cached = cache.get(key)
      if (cached) {
        cache.delete(key)
        cache.set(key, cached)
        return cached.result
      }

      return rememberProjection(cache, key, {
        result: projectionHost.project(frame, localPoint, viewport),
      }, limit)
    },
    screenToFrameLocal(screenPoint, frame, viewport) {
      return projectionHost.screenToFrameLocal(screenPoint, frame, viewport)
    },
    getProjectionRevision() {
      return projectionHost.getProjectionRevision?.() ?? ''
    },
  }
}