import { framePointToWorld } from './core/annotations/geometry'
import type { AnnotationEntity, Vec2 } from './core/annotations/types'

/**
 * Rasterize the mask-region annotations into a binary mask PNG at the source
 * image's native pixel size. Frame-local coordinates map 1:1 to image pixels for
 * the image2d viewer (the adapter loads the original at native resolution), so
 * framePointToWorld yields pixel coordinates directly.
 *
 * Returns a PNG blob (white shapes on transparent), or null if there is nothing
 * to rasterize or the canvas could not be created.
 */
export async function rasterizeMask(
  annotations: AnnotationEntity[],
  width: number,
  height: number,
): Promise<Blob | null> {
  if (!annotations.length || width <= 0 || height <= 0) {
    return null
  }

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width)
  canvas.height = Math.round(height)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return null
  }

  ctx.fillStyle = '#ffffff'
  ctx.strokeStyle = '#ffffff'
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  for (const annotation of annotations) {
    const toPixel = (point: Vec2) => {
      const world = framePointToWorld(annotation.frame, point)
      return { x: world.x, y: world.y }
    }
    const geometry = annotation.geometry

    if (geometry.kind === 'polygon') {
      if (geometry.points.length < 3) {
        continue
      }
      ctx.beginPath()
      geometry.points.forEach((point, index) => {
        const p = toPixel(point)
        if (index === 0) {
          ctx.moveTo(p.x, p.y)
        } else {
          ctx.lineTo(p.x, p.y)
        }
      })
      ctx.closePath()
      ctx.fill()
    } else if (geometry.kind === 'brush') {
      const pixels = geometry.points.map(toPixel)
      const lineWidth = Math.max(1, geometry.radius * 2)
      if (pixels.length === 1) {
        ctx.beginPath()
        ctx.arc(pixels[0].x, pixels[0].y, lineWidth / 2, 0, Math.PI * 2)
        ctx.fill()
      } else if (pixels.length >= 2) {
        ctx.beginPath()
        pixels.forEach((p, index) => (index === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
        ctx.lineWidth = lineWidth
        ctx.stroke()
      }
    } else if (geometry.kind === 'rectangle') {
      const a = toPixel(geometry.start)
      const b = toPixel(geometry.end)
      ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y))
    } else if (geometry.kind === 'ellipse') {
      const a = toPixel(geometry.start)
      const b = toPixel(geometry.end)
      const cx = (a.x + b.x) / 2
      const cy = (a.y + b.y) / 2
      ctx.beginPath()
      ctx.ellipse(cx, cy, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2)
      ctx.fill()
    } else if (geometry.kind === 'freehand') {
      const pixels = geometry.points.map(toPixel)
      if (pixels.length >= 2) {
        ctx.beginPath()
        pixels.forEach((p, index) => (index === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
        ctx.lineWidth = Math.max(2, annotation.style.strokeWidth)
        ctx.stroke()
      }
    }
  }

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png')
  })
}

/** Predicate: shapes that contribute to a mask on the given sheet. */
export function isMaskShape(annotation: AnnotationEntity) {
  return annotation.maskRegion === true && annotation.frame.space === 'image2d'
}
