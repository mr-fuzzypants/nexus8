import { framePointToWorld } from './core/annotations/geometry'
import type { AnnotationEntity, Vec2 } from './core/annotations/types'

/** Draw annotation shapes to a pre-configured canvas context.
 *  The caller sets fillStyle/strokeStyle before calling; this function
 *  renders all geometry using whatever color the context already has.
 *
 *  strokeOnlyShapes — when true, shape-tool geometry (ellipse, rectangle, polygon)
 *  is rendered as outlines (strokes) rather than filled solids. Brush and freehand
 *  are always rendered as strokes. Use this for ControlNet edge-map conditioning:
 *  the scribble ControlNet is trained on line drawings, not solid fills, so a filled
 *  ellipse would be out-of-distribution and cause colour smearing artefacts. */
function _drawAnnotationsToCanvas(
  ctx: CanvasRenderingContext2D,
  annotations: AnnotationEntity[],
  strokeOnlyShapes = false,
): void {
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
      if (strokeOnlyShapes) {
        ctx.lineWidth = 4
        ctx.stroke()
      } else {
        ctx.fill()
      }
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
      if (strokeOnlyShapes) {
        ctx.lineWidth = 4
        ctx.beginPath()
        ctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y))
        ctx.stroke()
      } else {
        ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y))
      }
    } else if (geometry.kind === 'ellipse') {
      const a = toPixel(geometry.start)
      const b = toPixel(geometry.end)
      const cx = (a.x + b.x) / 2
      const cy = (a.y + b.y) / 2
      ctx.beginPath()
      ctx.ellipse(cx, cy, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2)
      if (strokeOnlyShapes) {
        ctx.lineWidth = 4
        ctx.stroke()
      } else {
        ctx.fill()
      }
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
}

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
  _drawAnnotationsToCanvas(ctx, annotations)

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png')
  })
}

/**
 * Rasterize scribble-layer strokes as a black-on-white edge map for ControlNet.
 * The xinsir ControlNet expects dark edges on a light background, so this is the
 * inverse of rasterizeMask (which renders white strokes on transparent).
 *
 * Returns a PNG blob (black strokes on white), or null if nothing to rasterize.
 */
export async function rasterizeScribble(
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

  // White background so transparent areas become white in the edge map.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  // Black strokes — dark edges on white background (xinsir ControlNet format).
  ctx.fillStyle = '#000000'
  ctx.strokeStyle = '#000000'
  _drawAnnotationsToCanvas(ctx, annotations)

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png')
  })
}

/**
 * Rasterize sketch-inpaint strokes as a ControlNet edge-map conditioning image.
 * All geometry — including shape tools (ellipse, rectangle, polygon) — is rendered
 * as outlines only (strokeOnlyShapes=true). This is the correct format for the
 * xinsir scribble ControlNet, which is trained on line drawings: a filled solid
 * shape would be out-of-distribution and cause colour smearing artefacts.
 *
 * The backend flood-fills these outlines to derive the precise inpaint mask
 * (enclosed circle → circular mask, etc.), so outline-only rendering serves
 * double duty: correct ControlNet input AND flood-fillable boundary for masking.
 */
export async function rasterizeSketchInpaintGuide(
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
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  ctx.fillStyle = '#000000'
  ctx.strokeStyle = '#000000'
  _drawAnnotationsToCanvas(ctx, annotations, true)

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png')
  })
}

/** Predicate: shapes that contribute to a mask on the given sheet. */
export function isMaskShape(annotation: AnnotationEntity) {
  return annotation.maskRegion === true && annotation.frame.space === 'image2d'
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

/**
 * Rasterize a SAM 2 mask prompt: positive strokes filled white, then negative
 * strokes erased (destination-out), yielding the object region the artist drew
 * minus any ⌥/Alt "not this" strokes. Returns raw base64 PNG (white=object on
 * transparent) at native pixel size, or null if there is no positive region.
 */
export async function rasterizeMaskPromptB64(
  positives: AnnotationEntity[],
  negatives: AnnotationEntity[],
  width: number,
  height: number,
): Promise<string | null> {
  if (!positives.length || width <= 0 || height <= 0) {
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
  _drawAnnotationsToCanvas(ctx, positives)
  if (negatives.length) {
    // Carve the negative strokes back out of the painted region.
    ctx.globalCompositeOperation = 'destination-out'
    ctx.fillStyle = '#000000'
    ctx.strokeStyle = '#000000'
    _drawAnnotationsToCanvas(ctx, negatives)
    ctx.globalCompositeOperation = 'source-over'
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  return blob ? blobToBase64(blob) : null
}
