import type { AnnotationColor } from '../annotations/schema'
import type {
  RenderLabelPrimitive,
  RenderPrimitive,
  RenderStrokeStyle,
  RenderTextStyle,
} from './primitives'
import type {
  PackedPrimitiveBatch,
  RenderPrimitiveBatch,
} from './renderService'
import {
  createCanvasFont,
  getLabelMeasurement,
  getWrappedTextBlockRows,
} from './textLayout'

function toCanvasColor(color: AnnotationColor, opacity = 1) {
  const alpha = Math.min(1, Math.max(0, color.a * opacity))
  return `rgba(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}, ${alpha})`
}

function applyStroke(context: CanvasRenderingContext2D, stroke: RenderStrokeStyle | undefined, opacity: number) {
  if (!stroke) {
    return false
  }

  context.strokeStyle = toCanvasColor(stroke.color, opacity)
  context.lineWidth = stroke.width
  context.lineCap = stroke.lineCap ?? 'round'
  context.lineJoin = stroke.lineJoin ?? 'round'
  context.setLineDash(stroke.dash ?? [])
  return true
}

function applyFill(context: CanvasRenderingContext2D, fill: AnnotationColor | undefined, opacity: number) {
  if (!fill) {
    return false
  }

  context.fillStyle = toCanvasColor(fill, opacity)
  return true
}

function applyText(context: CanvasRenderingContext2D, style: RenderTextStyle, opacity: number) {
  context.fillStyle = toCanvasColor(style.color, opacity)
  context.font = createCanvasFont(style)
}

function roundRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath()
  context.moveTo(x + radius, y)
  context.lineTo(x + width - radius, y)
  context.quadraticCurveTo(x + width, y, x + width, y + radius)
  context.lineTo(x + width, y + height - radius)
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height)
  context.lineTo(x + radius, y + height)
  context.quadraticCurveTo(x, y + height, x, y + height - radius)
  context.lineTo(x, y + radius)
  context.quadraticCurveTo(x, y, x + radius, y)
  context.closePath()
}

function drawWrappedTextBlock(
  context: CanvasRenderingContext2D,
  primitive: Extract<RenderPrimitive, { kind: 'textBlock' }>,
  opacity: number,
) {
  applyText(context, primitive.style, opacity)
  getWrappedTextBlockRows(primitive).forEach((line, row) => {
    if (row < primitive.maxLines) {
      context.fillText(line, primitive.position.x, primitive.position.y + primitive.lineHeight * row)
    }
  })
}

function drawLabel(context: CanvasRenderingContext2D, primitive: RenderLabelPrimitive, opacity: number) {
  context.save()
  applyText(context, primitive.style, opacity)
  const measurement = getLabelMeasurement(primitive)
  const width = measurement.width
  const height = measurement.height
  roundRectPath(context, primitive.position.x, primitive.position.y, width, height, primitive.radius)
  const hasFill = applyFill(context, primitive.background, opacity)
  const hasStroke = applyStroke(context, primitive.stroke, opacity)
  if (hasFill) {
    context.fill()
  }
  if (hasStroke) {
    context.stroke()
  }

  applyText(context, primitive.style, opacity)
  context.fillText(
    primitive.text,
    primitive.position.x + primitive.paddingX,
    primitive.position.y + measurement.baselineOffset,
  )
  context.restore()
}

function renderPackedBatchToCanvas(
  context: CanvasRenderingContext2D,
  packed: PackedPrimitiveBatch,
  exemplar: RenderPrimitive,
) {
  const opacity = exemplar.opacity ?? 1

  switch (packed.kind) {
    case 'polyline': {
      let pointOffset = 0
      packed.pointCounts.forEach((count) => {
        if (count < ((exemplar.kind === 'polyline' && exemplar.closed) ? 3 : 2)) {
          pointOffset += count * 2
          return
        }
        context.save()
        context.beginPath()
        context.moveTo(packed.points[pointOffset], packed.points[pointOffset + 1])
        for (let index = 1; index < count; index += 1) {
          const offset = pointOffset + index * 2
          context.lineTo(packed.points[offset], packed.points[offset + 1])
        }
        if (exemplar.kind === 'polyline' && exemplar.closed) {
          context.closePath()
        }
        const hasFill = exemplar.kind === 'polyline' ? applyFill(context, exemplar.fill, opacity) : false
        const hasStroke = exemplar.kind === 'polyline' ? applyStroke(context, exemplar.stroke, opacity) : false
        if (hasFill) {
          context.fill()
        }
        if (hasStroke) {
          context.stroke()
        }
        context.restore()
        pointOffset += count * 2
      })
      return
    }
    case 'line': {
      if (exemplar.kind !== 'line') {
        return
      }
      for (let offset = 0; offset < packed.segments.length; offset += 4) {
        context.save()
        context.beginPath()
        context.moveTo(packed.segments[offset], packed.segments[offset + 1])
        context.lineTo(packed.segments[offset + 2], packed.segments[offset + 3])
        applyStroke(context, exemplar.stroke, opacity)
        context.stroke()
        context.restore()
      }
      return
    }
    case 'circle': {
      if (exemplar.kind !== 'circle') {
        return
      }
      for (let offset = 0; offset < packed.circles.length; offset += 3) {
        context.save()
        context.beginPath()
        context.arc(packed.circles[offset], packed.circles[offset + 1], packed.circles[offset + 2], 0, Math.PI * 2)
        const hasFill = applyFill(context, exemplar.fill, opacity)
        const hasStroke = applyStroke(context, exemplar.stroke, opacity)
        if (hasFill) {
          context.fill()
        }
        if (hasStroke) {
          context.stroke()
        }
        context.restore()
      }
      return
    }
    case 'roundedRect': {
      if (exemplar.kind !== 'roundedRect') {
        return
      }
      for (let offset = 0; offset < packed.rects.length; offset += 5) {
        context.save()
        roundRectPath(
          context,
          packed.rects[offset],
          packed.rects[offset + 1],
          packed.rects[offset + 2],
          packed.rects[offset + 3],
          packed.rects[offset + 4],
        )
        const hasFill = applyFill(context, exemplar.fill, opacity)
        const hasStroke = applyStroke(context, exemplar.stroke, opacity)
        if (hasFill) {
          context.fill()
        }
        if (hasStroke) {
          context.stroke()
        }
        context.restore()
      }
      return
    }
    case 'ellipse': {
      if (exemplar.kind !== 'ellipse') {
        return
      }
      for (let offset = 0; offset < packed.ellipses.length; offset += 4) {
        context.save()
        context.beginPath()
        context.ellipse(
          packed.ellipses[offset],
          packed.ellipses[offset + 1],
          packed.ellipses[offset + 2],
          packed.ellipses[offset + 3],
          0,
          0,
          Math.PI * 2,
        )
        const hasFill = applyFill(context, exemplar.fill, opacity)
        const hasStroke = applyStroke(context, exemplar.stroke, opacity)
        if (hasFill) {
          context.fill()
        }
        if (hasStroke) {
          context.stroke()
        }
        context.restore()
      }
    }
  }
}

export function renderPrimitivesToCanvas(context: CanvasRenderingContext2D, primitives: RenderPrimitive[]) {
  primitives.forEach((primitive) => {
    const opacity = primitive.opacity ?? 1
    context.save()

    switch (primitive.kind) {
      case 'polyline': {
        if (primitive.points.length < (primitive.closed ? 3 : 2)) {
          context.restore()
          return
        }
        context.beginPath()
        context.moveTo(primitive.points[0].x, primitive.points[0].y)
        primitive.points.slice(1).forEach((point) => context.lineTo(point.x, point.y))
        if (primitive.closed) {
          context.closePath()
        }
        const hasFill = applyFill(context, primitive.fill, opacity)
        const hasStroke = applyStroke(context, primitive.stroke, opacity)
        if (hasFill) {
          context.fill()
        }
        if (hasStroke) {
          context.stroke()
        }
        break
      }
      case 'ellipse': {
        context.beginPath()
        context.ellipse(
          primitive.center.x,
          primitive.center.y,
          primitive.radiusX,
          primitive.radiusY,
          0,
          0,
          Math.PI * 2,
        )
        const hasFill = applyFill(context, primitive.fill, opacity)
        const hasStroke = applyStroke(context, primitive.stroke, opacity)
        if (hasFill) {
          context.fill()
        }
        if (hasStroke) {
          context.stroke()
        }
        break
      }
      case 'roundedRect': {
        roundRectPath(context, primitive.x, primitive.y, primitive.width, primitive.height, primitive.radius)
        const hasFill = applyFill(context, primitive.fill, opacity)
        const hasStroke = applyStroke(context, primitive.stroke, opacity)
        if (hasFill) {
          context.fill()
        }
        if (hasStroke) {
          context.stroke()
        }
        break
      }
      case 'circle': {
        context.beginPath()
        context.arc(primitive.center.x, primitive.center.y, primitive.radius, 0, Math.PI * 2)
        const hasFill = applyFill(context, primitive.fill, opacity)
        const hasStroke = applyStroke(context, primitive.stroke, opacity)
        if (hasFill) {
          context.fill()
        }
        if (hasStroke) {
          context.stroke()
        }
        break
      }
      case 'line': {
        context.beginPath()
        context.moveTo(primitive.start.x, primitive.start.y)
        context.lineTo(primitive.end.x, primitive.end.y)
        applyStroke(context, primitive.stroke, opacity)
        context.stroke()
        break
      }
      case 'text': {
        applyText(context, primitive.style, opacity)
        context.fillText(primitive.text, primitive.position.x, primitive.position.y)
        break
      }
      case 'textBlock': {
        drawWrappedTextBlock(context, primitive, opacity)
        break
      }
      case 'label': {
        context.restore()
        drawLabel(context, primitive, opacity)
        return
      }
    }

    context.restore()
  })
}

export function renderPrimitiveBatchesToCanvas(context: CanvasRenderingContext2D, batches: RenderPrimitiveBatch[]) {
  batches.forEach((batch) => {
    if (batch.packed && batch.primitives[0]) {
      renderPackedBatchToCanvas(context, batch.packed, batch.primitives[0])
      return
    }

    renderPrimitivesToCanvas(context, batch.primitives)
  })
}