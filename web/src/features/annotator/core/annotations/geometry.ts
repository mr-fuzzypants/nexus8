import type {
  AnnotationEntity,
  AnnotationFrame,
  AnnotationGeometry,
  Vec2,
  Vec3,
} from './types'

export interface ScreenProjector {
  (frame: AnnotationFrame, localPoint: Vec2): Vec2 | null
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function vec2Distance(a: Vec2, b: Vec2) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function framePointToWorld(frame: AnnotationFrame, point: Vec2): Vec3 {
  return {
    x: frame.origin.x + frame.xAxis.x * point.x + frame.yAxis.x * point.y,
    y: frame.origin.y + frame.xAxis.y * point.x + frame.yAxis.y * point.y,
    z: frame.origin.z + frame.xAxis.z * point.x + frame.yAxis.z * point.y,
  }
}

export function worldToFrameLocal(frame: AnnotationFrame, worldPoint: Vec3): Vec2 {
  const dx = worldPoint.x - frame.origin.x
  const dy = worldPoint.y - frame.origin.y
  const dz = worldPoint.z - frame.origin.z
  const xDenominator =
    frame.xAxis.x * frame.xAxis.x +
    frame.xAxis.y * frame.xAxis.y +
    frame.xAxis.z * frame.xAxis.z ||
    1
  const yDenominator =
    frame.yAxis.x * frame.yAxis.x +
    frame.yAxis.y * frame.yAxis.y +
    frame.yAxis.z * frame.yAxis.z ||
    1

  return {
    x: (dx * frame.xAxis.x + dy * frame.xAxis.y + dz * frame.xAxis.z) / xDenominator,
    y: (dx * frame.yAxis.x + dy * frame.yAxis.y + dz * frame.yAxis.z) / yDenominator,
  }
}

export function normalizeBounds(start: Vec2, end: Vec2) {
  return {
    minX: Math.min(start.x, end.x),
    minY: Math.min(start.y, end.y),
    maxX: Math.max(start.x, end.x),
    maxY: Math.max(start.y, end.y),
  }
}

function distanceToSegment(point: Vec2, start: Vec2, end: Vec2) {
  const lengthSquared = (end.x - start.x) ** 2 + (end.y - start.y) ** 2
  if (lengthSquared === 0) {
    return vec2Distance(point, start)
  }

  const t = clamp(
    ((point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y)) /
      lengthSquared,
    0,
    1,
  )
  const projection = {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
  }
  return vec2Distance(point, projection)
}

/** Ray-casting point-in-polygon test over a list of screen-space vertices. */
export function pointInPolygon(point: Vec2, vertices: Vec2[]) {
  let inside = false
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i, i += 1) {
    const xi = vertices[i].x
    const yi = vertices[i].y
    const xj = vertices[j].x
    const yj = vertices[j].y
    const intersects =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi || Number.EPSILON) + xi
    if (intersects) {
      inside = !inside
    }
  }
  return inside
}

export function getRectangleCorners(geometry: Extract<AnnotationGeometry, { start: Vec2; end: Vec2 }>) {
  const bounds = normalizeBounds(geometry.start, geometry.end)
  return [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
  ]
}

export function hitTestAnnotationMarker(
  annotation: AnnotationEntity,
  screenPoint: Vec2,
  project: ScreenProjector,
  radius = 12,
) {
  const anchor = project(annotation.frame, { x: 0, y: 0 })
  if (!anchor) {
    return null
  }

  const distance = vec2Distance(screenPoint, anchor)
  return distance <= radius ? distance : null
}

export function hitTestAnnotation(
  annotation: AnnotationEntity,
  screenPoint: Vec2,
  project: ScreenProjector,
) {
  switch (annotation.geometry.kind) {
    case 'freehand': {
      const projected = annotation.geometry.points
        .map((point) => project(annotation.frame, point))
        .filter((point): point is Vec2 => point !== null)
      if (projected.length < 2) {
        return null
      }

      let best = Number.POSITIVE_INFINITY
      for (let index = 1; index < projected.length; index += 1) {
        best = Math.min(best, distanceToSegment(screenPoint, projected[index - 1], projected[index]))
      }
      return best <= 10 ? best : null
    }
    case 'brush': {
      const projected = annotation.geometry.points
        .map((point) => project(annotation.frame, point))
        .filter((point): point is Vec2 => point !== null)
      if (projected.length === 0) {
        return null
      }
      if (projected.length === 1) {
        const distance = vec2Distance(screenPoint, projected[0])
        return distance <= 14 ? distance : null
      }
      let best = Number.POSITIVE_INFINITY
      for (let index = 1; index < projected.length; index += 1) {
        best = Math.min(best, distanceToSegment(screenPoint, projected[index - 1], projected[index]))
      }
      return best <= 14 ? best : null
    }
    case 'polygon': {
      const projected = annotation.geometry.points
        .map((point) => project(annotation.frame, point))
        .filter((point): point is Vec2 => point !== null)
      if (projected.length < 2) {
        return null
      }
      if (pointInPolygon(screenPoint, projected)) {
        return 0
      }
      let best = Number.POSITIVE_INFINITY
      for (let index = 0; index < projected.length; index += 1) {
        const next = projected[(index + 1) % projected.length]
        best = Math.min(best, distanceToSegment(screenPoint, projected[index], next))
      }
      return best <= 8 ? best : null
    }
    case 'rectangle':
    case 'card':
    case 'grid':
    case 'list': {
      const projected = getRectangleCorners(annotation.geometry)
        .map((point) => project(annotation.frame, point))
        .filter((point): point is Vec2 => point !== null)
      if (projected.length !== 4) {
        return null
      }

      const xs = projected.map((point) => point.x)
      const ys = projected.map((point) => point.y)
      const inset = 8
      if (
        screenPoint.x >= Math.min(...xs) - inset &&
        screenPoint.x <= Math.max(...xs) + inset &&
        screenPoint.y >= Math.min(...ys) - inset &&
        screenPoint.y <= Math.max(...ys) + inset
      ) {
        return 0
      }
      return null
    }
    case 'ellipse': {
      const projected = getRectangleCorners(annotation.geometry)
        .map((point) => project(annotation.frame, point))
        .filter((point): point is Vec2 => point !== null)
      if (projected.length !== 4) {
        return null
      }

      const xs = projected.map((point) => point.x)
      const ys = projected.map((point) => point.y)
      const center = {
        x: (Math.min(...xs) + Math.max(...xs)) / 2,
        y: (Math.min(...ys) + Math.max(...ys)) / 2,
      }
      const radiusX = Math.max((Math.max(...xs) - Math.min(...xs)) / 2, 1)
      const radiusY = Math.max((Math.max(...ys) - Math.min(...ys)) / 2, 1)
      const normalizedDistance =
        ((screenPoint.x - center.x) / radiusX) ** 2 + ((screenPoint.y - center.y) / radiusY) ** 2
      return normalizedDistance <= 1.15 ? Math.abs(1 - normalizedDistance) : null
    }
    case 'text': {
      const position = project(annotation.frame, annotation.geometry.position)
      if (!position) {
        return null
      }
      const width = Math.max(annotation.geometry.text.length * annotation.style.fontSize * 0.56, 42)
      const height = annotation.style.fontSize * 1.6
      if (
        screenPoint.x >= position.x - 10 &&
        screenPoint.x <= position.x + width + 10 &&
        screenPoint.y >= position.y - height &&
        screenPoint.y <= position.y + 10
      ) {
        return 0
      }
      return null
    }
  }
}

export function isAnnotationVisible(annotation: AnnotationEntity, visibleLayerIds: Set<string>) {
  return visibleLayerIds.has(annotation.layerId)
}
