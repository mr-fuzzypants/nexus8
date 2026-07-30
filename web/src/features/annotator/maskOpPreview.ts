import type { AnnotationLayer } from './core/annotations/types'
import type { MaskBounds } from './maskBounds'

export interface ScreenRect {
  x: number
  y: number
  w: number
  h: number
}

export interface MaskOpPreviewOptions {
  layer: AnnotationLayer
  bounds: MaskBounds
  imageDims: { width: number; height: number }
  referenceImage: HTMLImageElement | null
  /** Projects a rect in world (image-pixel) coordinates to screen space. */
  projectRect: (x: number, y: number, w: number, h: number) => ScreenRect | null
}

let checkerboardPattern: CanvasPattern | null = null

/** Photoshop-style transparency checkerboard, cached across renders. */
function getCheckerboardPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (checkerboardPattern) {
    return checkerboardPattern
  }
  const tile = document.createElement('canvas')
  tile.width = 20
  tile.height = 20
  const tileCtx = tile.getContext('2d')
  if (!tileCtx) {
    return null
  }
  tileCtx.fillStyle = '#9ca3af'
  tileCtx.fillRect(0, 0, 20, 20)
  tileCtx.fillStyle = '#e5e7eb'
  tileCtx.fillRect(0, 0, 10, 10)
  tileCtx.fillRect(10, 10, 10, 10)
  checkerboardPattern = ctx.createPattern(tile, 'repeat')
  return checkerboardPattern
}

function rectPath(ctx: CanvasRenderingContext2D, rect: ScreenRect) {
  ctx.rect(rect.x, rect.y, rect.w, rect.h)
}

/** Clip to `outer` minus `inner` without compositing ops that would erase prior strokes. */
function clipEvenOdd(ctx: CanvasRenderingContext2D, outer: ScreenRect, inner: ScreenRect) {
  ctx.beginPath()
  rectPath(ctx, outer)
  rectPath(ctx, inner)
  ctx.clip('evenodd')
}

/**
 * Operation-specific visual guide composited over the annotation overlay.
 * Bounding-box approximation (SRED H1): treatments use the mask's axis-aligned
 * bounds rather than pixel-accurate stroke shapes, keeping the pass within the
 * frame budget on large images (SRED H2).
 */
export function renderMaskOpPreview(ctx: CanvasRenderingContext2D, opts: MaskOpPreviewOptions): void {
  const { layer, bounds, imageDims, referenceImage, projectRect } = opts
  if (!layer.mask_op) {
    return
  }
  const bbox = projectRect(bounds.x, bounds.y, bounds.w, bounds.h)
  const imageRect = projectRect(0, 0, imageDims.width, imageDims.height)
  if (!bbox || !imageRect || bbox.w <= 0 || bbox.h <= 0) {
    return
  }

  const accent = layer.color ?? '#f97316'

  ctx.save()
  switch (layer.mask_op) {
    case 'inpaint': {
      ctx.beginPath()
      rectPath(ctx, bbox)
      ctx.clip()
      if (referenceImage) {
        ctx.globalAlpha = 0.8
        ctx.drawImage(referenceImage, bbox.x, bbox.y, bbox.w, bbox.h)
      } else {
        ctx.globalAlpha = 0.25
        ctx.fillStyle = accent
        ctx.fillRect(bbox.x, bbox.y, bbox.w, bbox.h)
        ctx.globalAlpha = 0.9
        ctx.fillStyle = '#f8fafc'
        ctx.font = '12px system-ui, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('no reference', bbox.x + bbox.w / 2, bbox.y + bbox.h / 2)
      }
      break
    }
    case 'background_replace': {
      // Reference replaces everything OUTSIDE the mask region.
      clipEvenOdd(ctx, imageRect, bbox)
      if (referenceImage) {
        ctx.globalAlpha = 0.8
        ctx.drawImage(referenceImage, imageRect.x, imageRect.y, imageRect.w, imageRect.h)
      } else {
        ctx.globalAlpha = 0.25
        ctx.fillStyle = accent
        ctx.fillRect(imageRect.x, imageRect.y, imageRect.w, imageRect.h)
      }
      break
    }
    case 'remove': {
      const pattern = getCheckerboardPattern(ctx)
      ctx.beginPath()
      rectPath(ctx, bbox)
      ctx.clip()
      ctx.globalAlpha = 0.7
      ctx.fillStyle = pattern ?? '#9ca3af'
      ctx.fillRect(bbox.x, bbox.y, bbox.w, bbox.h)
      break
    }
    case 'outpaint': {
      const inflateX = imageRect.w * 0.25
      const inflateY = imageRect.h * 0.25
      const expanded: ScreenRect = {
        x: imageRect.x - inflateX,
        y: imageRect.y - inflateY,
        w: imageRect.w + inflateX * 2,
        h: imageRect.h + inflateY * 2,
      }
      clipEvenOdd(ctx, expanded, imageRect)
      if (referenceImage) {
        ctx.globalAlpha = 0.5
        ctx.drawImage(referenceImage, expanded.x, expanded.y, expanded.w, expanded.h)
      } else {
        ctx.globalAlpha = 0.6
        ctx.fillStyle = '#808080'
        ctx.fillRect(expanded.x, expanded.y, expanded.w, expanded.h)
      }
      break
    }
    case 'segment': {
      // Selection metaphor: outline the region, dim everything outside.
      ctx.save()
      clipEvenOdd(ctx, imageRect, bbox)
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)'
      ctx.fillRect(imageRect.x, imageRect.y, imageRect.w, imageRect.h)
      ctx.restore()
      ctx.strokeStyle = accent
      ctx.lineWidth = 2
      ctx.strokeRect(bbox.x, bbox.y, bbox.w, bbox.h)
      break
    }
    case 'scribble': {
      // Edge-map hint: subtle tint over the full image with a center label.
      ctx.beginPath()
      rectPath(ctx, imageRect)
      ctx.clip()
      ctx.globalAlpha = 0.12
      ctx.fillStyle = accent
      ctx.fillRect(imageRect.x, imageRect.y, imageRect.w, imageRect.h)
      ctx.globalAlpha = 0.7
      ctx.fillStyle = '#f8fafc'
      ctx.font = '12px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(
        'scribble → image',
        imageRect.x + imageRect.w / 2,
        imageRect.y + imageRect.h / 2,
      )
      break
    }
    case 'sketch_inpaint': {
      // Inpaint-style bbox preview with a violet accent to distinguish from plain inpaint.
      ctx.beginPath()
      rectPath(ctx, bbox)
      ctx.clip()
      ctx.globalAlpha = 0.22
      ctx.fillStyle = '#a78bfa'
      ctx.fillRect(bbox.x, bbox.y, bbox.w, bbox.h)
      ctx.globalAlpha = 0.85
      ctx.fillStyle = '#f8fafc'
      ctx.font = '12px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('sketch → inpaint', bbox.x + bbox.w / 2, bbox.y + bbox.h / 2)
      break
    }
  }
  ctx.restore()
}

/**
 * Ephemeral AI-generated result overlay. The result is a full-frame inpainted
 * image, so it maps to the image rect but clips to the mask bbox — keeping it
 * pixel-aligned with the base while only revealing the generated region.
 */
export function renderLivePreviewOverlay(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  imageScreenRect: ScreenRect,
  bboxScreenRect: ScreenRect,
  latencyLabel: string,
  drawBorder = true,
): void {
  ctx.save()
  ctx.beginPath()
  rectPath(ctx, bboxScreenRect)
  ctx.clip()
  // Full opacity: blending with the original underneath hides subtle results
  // (a regenerated-but-similar region reads as "nothing changed").
  ctx.drawImage(img, imageScreenRect.x, imageScreenRect.y, imageScreenRect.w, imageScreenRect.h)
  ctx.restore()
  // While a new generation is in flight the animated busy border owns this
  // rect, so the caller suppresses the solid one.
  if (drawBorder) {
    ctx.save()
    ctx.strokeStyle = 'rgba(94, 234, 212, 0.9)'
    ctx.lineWidth = 1
    ctx.strokeRect(bboxScreenRect.x, bboxScreenRect.y, bboxScreenRect.w, bboxScreenRect.h)
    ctx.restore()
  }

  const label = latencyLabel ? `AI preview · ${latencyLabel}` : 'AI preview'
  ctx.save()
  ctx.font = '11px system-ui, sans-serif'
  const metrics = ctx.measureText(label)
  const padX = 6
  const badgeW = metrics.width + padX * 2
  const badgeH = 18
  const bx = bboxScreenRect.x
  const by = Math.max(0, bboxScreenRect.y - badgeH - 4)
  ctx.fillStyle = 'rgba(2, 6, 23, 0.85)'
  ctx.beginPath()
  ctx.roundRect(bx, by, badgeW, badgeH, 9)
  ctx.fill()
  ctx.fillStyle = '#5eead4'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, bx + padX, by + badgeH / 2 + 0.5)
  ctx.restore()
}

/**
 * Full-frame AI result overlay for scribble-to-image. Unlike the inpaint overlay
 * (which clips to the mask bbox), the scribble result replaces the entire frame.
 */
export function renderScribblePreviewOverlay(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  imageScreenRect: ScreenRect,
  latencyLabel: string,
  drawBorder = true,
): void {
  ctx.save()
  ctx.beginPath()
  rectPath(ctx, imageScreenRect)
  ctx.clip()
  ctx.drawImage(img, imageScreenRect.x, imageScreenRect.y, imageScreenRect.w, imageScreenRect.h)
  ctx.restore()
  if (drawBorder) {
    ctx.save()
    ctx.strokeStyle = 'rgba(94, 234, 212, 0.9)'
    ctx.lineWidth = 1
    ctx.strokeRect(imageScreenRect.x, imageScreenRect.y, imageScreenRect.w, imageScreenRect.h)
    ctx.restore()
  }

  const label = latencyLabel ? `Scribble preview · ${latencyLabel}` : 'Scribble preview'
  ctx.save()
  ctx.font = '11px system-ui, sans-serif'
  const metrics = ctx.measureText(label)
  const padX = 6
  const badgeW = metrics.width + padX * 2
  const badgeH = 18
  const bx = imageScreenRect.x
  const by = Math.max(0, imageScreenRect.y - badgeH - 4)
  ctx.fillStyle = 'rgba(2, 6, 23, 0.85)'
  ctx.beginPath()
  ctx.roundRect(bx, by, badgeW, badgeH, 9)
  ctx.fill()
  ctx.fillStyle = '#5eead4'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, bx + padX, by + badgeH / 2 + 0.5)
  ctx.restore()
}
