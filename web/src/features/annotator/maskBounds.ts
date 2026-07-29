import { framePointToWorld } from './core/annotations/geometry'
import type { AnnotationEntity, AnnotationFrame } from './core/annotations/types'

export interface MaskBounds {
  /** Bounding box in world (image-pixel) coordinates. */
  x: number
  y: number
  w: number
  h: number
  /** Frame of the first shape; world coords convert to this frame's local space for projection. */
  frame: AnnotationFrame
}

/** Axis-aligned bounding box of a set of mask shapes in world (image-pixel) space. */
export function computeMaskBounds(shapes: AnnotationEntity[]): MaskBounds | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const shape of shapes) {
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
    } else if (
      geom.kind === 'rectangle' ||
      geom.kind === 'ellipse' ||
      geom.kind === 'card' ||
      geom.kind === 'grid' ||
      geom.kind === 'list'
    ) {
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
  if (!Number.isFinite(minX) || shapes.length === 0) {
    return null
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY, frame: shapes[0].frame }
}
