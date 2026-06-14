import { getRectangleCorners, normalizeBounds, pointInPolygon, vec2Distance } from '../annotations/geometry'
import { parseAnnotationColor } from '../annotations/schema'
import type { AnnotationEntity, AnnotationGeometryKind, ParticipantState, Vec2 } from '../annotations/types'
import {
  getAnnotationScreenBounds,
  getCardMoveHandleTargets,
  getDetailCardMetrics,
  type AnnotationScreenBounds,
} from './annotationLayout'
import type { AnnotationProjectionHost, ViewportSize } from './host'
import type { RenderPrimitive, RenderStrokeStyle, RenderTextStyle } from './primitives'
import { getLabelBounds } from './textLayout'

type FreehandAnnotation = AnnotationEntity & { geometry: Extract<AnnotationEntity['geometry'], { kind: 'freehand' }> }
type BrushAnnotation = AnnotationEntity & { geometry: Extract<AnnotationEntity['geometry'], { kind: 'brush' }> }
type PolygonAnnotation = AnnotationEntity & { geometry: Extract<AnnotationEntity['geometry'], { kind: 'polygon' }> }
type BoundsAnnotation = AnnotationEntity & { geometry: Extract<AnnotationEntity['geometry'], { start: Vec2; end: Vec2 }> }
type TextAnnotation = AnnotationEntity & { geometry: Extract<AnnotationEntity['geometry'], { kind: 'text' }> }
type CardAnnotation = AnnotationEntity & { geometry: Extract<AnnotationEntity['geometry'], { kind: 'card' }> }
type ListAnnotation = AnnotationEntity & { geometry: Extract<AnnotationEntity['geometry'], { kind: 'list' }> }
type GridAnnotation = AnnotationEntity & { geometry: Extract<AnnotationEntity['geometry'], { kind: 'grid' }> }

export interface AnnotationRenderEntry {
  annotation: AnnotationEntity
  selected: boolean
  alphaMultiplier?: number
  collapseUnselectedWorldMarker?: boolean
}

export interface AnnotationRenderContext {
  projectionHost: AnnotationProjectionHost
  viewport: ViewportSize
}

export interface AnnotationRenderPlugin {
  id: string
  kinds: AnnotationGeometryKind[]
  renderBatch: (entries: AnnotationRenderEntry[], context: AnnotationRenderContext) => RenderPrimitive[]
  hitTest: (entry: AnnotationRenderEntry, screenPoint: Vec2, context: AnnotationRenderContext) => number | null
  getScreenBounds: (entry: AnnotationRenderEntry, context: AnnotationRenderContext) => AnnotationScreenBounds | null
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function distanceToSegment(point: Vec2, start: Vec2, end: Vec2) {
  const lengthSquared = (end.x - start.x) ** 2 + (end.y - start.y) ** 2
  if (lengthSquared === 0) {
    return vec2Distance(point, start)
  }

  const t = clamp(
    ((point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y)) / lengthSquared,
    0,
    1,
  )
  const projection = {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
  }
  return vec2Distance(point, projection)
}

function createStroke(annotation: AnnotationEntity, selected: boolean, dash?: number[]): RenderStrokeStyle {
  return {
    color: parseAnnotationColor(annotation.style.stroke),
    width: selected ? annotation.style.strokeWidth + 1 : annotation.style.strokeWidth,
    dash,
    lineCap: 'round',
    lineJoin: 'round',
  }
}

function createTextStyle(fontSize: number, color: string, fontWeight = 500): RenderTextStyle {
  return {
    fontSize,
    fontWeight,
    fontFamily: 'Inter, system-ui, sans-serif',
    color: parseAnnotationColor(color),
  }
}

function buildCardMoveAffordance(bounds: AnnotationScreenBounds): RenderPrimitive[] {
  return getCardMoveHandleTargets(bounds).map((handle) => ({
    kind: 'circle',
    center: { x: handle.x, y: handle.y },
    radius: handle.radius,
    fill: parseAnnotationColor('#f8fafc'),
    stroke: {
      color: parseAnnotationColor('rgba(15, 23, 42, 0.34)'),
      width: 1.5,
    },
  }))
}

function buildSelectionAnchor(annotation: AnnotationEntity, context: AnnotationRenderContext): RenderPrimitive[] {
  const anchor = context.projectionHost.project(annotation.frame, { x: 0, y: 0 }, context.viewport)
  if (!anchor) {
    return []
  }

  return [{
    kind: 'circle',
    center: anchor,
    radius: 6,
    stroke: {
      color: parseAnnotationColor('#f8fafc'),
      width: 1.5,
      dash: [6, 4],
    },
    opacity: 1,
  }]
}

function appendSelectionPrimitives(
  primitives: RenderPrimitive[],
  annotation: AnnotationEntity,
  selected: boolean,
  context: AnnotationRenderContext,
) {
  if (selected) {
    primitives.push(...buildSelectionAnchor(annotation, context))
  }
}

function buildWorldMarker(entry: AnnotationRenderEntry, context: AnnotationRenderContext): RenderPrimitive[] | null {
  const { annotation, selected, alphaMultiplier = 1, collapseUnselectedWorldMarker = true } = entry
  if (!(annotation.frame.space === 'world3d' && !selected && collapseUnselectedWorldMarker)) {
    return null
  }

  const anchor = context.projectionHost.project(annotation.frame, { x: 0, y: 0 }, context.viewport)
  if (!anchor) {
    return []
  }

  const opacity = Math.max(0.86 * alphaMultiplier, 0.48)
  return [
    {
      kind: 'circle',
      center: anchor,
      radius: 6.5,
      fill: parseAnnotationColor('#020617'),
      opacity,
    },
    {
      kind: 'circle',
      center: anchor,
      radius: 4,
      fill: parseAnnotationColor(annotation.style.stroke),
      opacity,
    },
    {
      kind: 'circle',
      center: anchor,
      radius: 8.5,
      stroke: {
        color: parseAnnotationColor('rgba(248, 250, 252, 0.9)'),
        width: 1.5,
      },
      opacity,
    },
  ]
}

function expandBounds(bounds: AnnotationScreenBounds, padding: number): AnnotationScreenBounds {
  return {
    left: bounds.left - padding,
    top: bounds.top - padding,
    width: bounds.width + padding * 2,
    height: bounds.height + padding * 2,
    centerX: bounds.centerX,
    centerY: bounds.centerY,
  }
}

function getWorldMarkerBounds(entry: AnnotationRenderEntry, context: AnnotationRenderContext) {
  const { annotation, selected, collapseUnselectedWorldMarker = true } = entry
  if (!(annotation.frame.space === 'world3d' && !selected && collapseUnselectedWorldMarker)) {
    return null
  }

  const anchor = context.projectionHost.project(annotation.frame, { x: 0, y: 0 }, context.viewport)
  if (!anchor) {
    return null
  }

  return {
    left: anchor.x - 12,
    top: anchor.y - 12,
    width: 24,
    height: 24,
    centerX: anchor.x,
    centerY: anchor.y,
  } satisfies AnnotationScreenBounds
}

function getTextScreenBounds(entry: AnnotationRenderEntry, context: AnnotationRenderContext) {
  const worldMarkerBounds = getWorldMarkerBounds(entry, context)
  if (worldMarkerBounds) {
    return worldMarkerBounds
  }

  const annotation = entry.annotation as TextAnnotation
  const anchor = context.projectionHost.project(annotation.frame, annotation.geometry.position, context.viewport)
  if (!anchor) {
    return null
  }

  const bounds = getLabelBounds({
    text: annotation.geometry.text,
    position: { x: anchor.x, y: anchor.y - (annotation.style.fontSize + 14) },
    paddingX: 10,
    paddingY: 7,
    style: createTextStyle(annotation.style.fontSize, '#f8fafc', 600),
  })
  return {
    left: bounds.left,
    top: bounds.top,
    width: bounds.width,
    height: bounds.height,
    centerX: bounds.left + bounds.width / 2,
    centerY: bounds.top + bounds.height / 2,
  } satisfies AnnotationScreenBounds
}

function getAnnotationHitBounds(entry: AnnotationRenderEntry, context: AnnotationRenderContext, padding: number) {
  const worldMarkerBounds = getWorldMarkerBounds(entry, context)
  if (worldMarkerBounds) {
    return worldMarkerBounds
  }

  const bounds = getAnnotationScreenBounds(entry.annotation, context.projectionHost, context.viewport)
  return bounds ? expandBounds(bounds, padding) : null
}

function hitTestWorldMarker(entry: AnnotationRenderEntry, screenPoint: Vec2, context: AnnotationRenderContext) {
  const { annotation, selected, collapseUnselectedWorldMarker = true } = entry
  if (!(annotation.frame.space === 'world3d' && !selected && collapseUnselectedWorldMarker)) {
    return null
  }

  const anchor = context.projectionHost.project(annotation.frame, { x: 0, y: 0 }, context.viewport)
  if (!anchor) {
    return null
  }

  const distance = vec2Distance(screenPoint, anchor)
  return distance <= 12 ? distance : null
}

function buildFreehand(entry: AnnotationRenderEntry, context: AnnotationRenderContext): RenderPrimitive[] {
  const worldMarker = buildWorldMarker(entry, context)
  if (worldMarker) {
    return worldMarker
  }
  const annotation = entry.annotation as FreehandAnnotation
  const { selected, alphaMultiplier = 1 } = entry
  const points = annotation.geometry.points
    .map((point) => context.projectionHost.project(annotation.frame, point, context.viewport))
    .filter((point): point is Vec2 => point !== null)
  if (points.length < 2) {
    return []
  }
  const primitives: RenderPrimitive[] = [{
    kind: 'polyline',
    points,
    stroke: createStroke(annotation, selected),
    opacity: annotation.style.opacity * alphaMultiplier,
  }]
  appendSelectionPrimitives(primitives, annotation, selected, context)
  return primitives
}

function hitTestFreehand(entry: AnnotationRenderEntry, screenPoint: Vec2, context: AnnotationRenderContext) {
  const markerDistance = hitTestWorldMarker(entry, screenPoint, context)
  if (markerDistance !== null) {
    return markerDistance
  }

  const annotation = entry.annotation as FreehandAnnotation
  const projected = annotation.geometry.points
    .map((point) => context.projectionHost.project(annotation.frame, point, context.viewport))
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

/** Screen pixels per one frame-local (image-pixel) unit, for scaling brush width with zoom. */
function getFrameScreenScale(annotation: AnnotationEntity, context: AnnotationRenderContext) {
  const origin = context.projectionHost.project(annotation.frame, { x: 0, y: 0 }, context.viewport)
  const unit = context.projectionHost.project(annotation.frame, { x: 1, y: 0 }, context.viewport)
  if (!origin || !unit) {
    return 1
  }
  return Math.max(vec2Distance(origin, unit), 1e-3)
}

function buildBrush(entry: AnnotationRenderEntry, context: AnnotationRenderContext): RenderPrimitive[] {
  const worldMarker = buildWorldMarker(entry, context)
  if (worldMarker) {
    return worldMarker
  }
  const annotation = entry.annotation as BrushAnnotation
  const { selected, alphaMultiplier = 1 } = entry
  const points = annotation.geometry.points
    .map((point) => context.projectionHost.project(annotation.frame, point, context.viewport))
    .filter((point): point is Vec2 => point !== null)
  if (points.length === 0) {
    return []
  }
  const scale = getFrameScreenScale(annotation, context)
  const width = Math.max(1, annotation.geometry.radius * 2 * scale)
  const opacity = annotation.style.opacity * alphaMultiplier
  if (points.length === 1) {
    return [{
      kind: 'circle',
      center: points[0],
      radius: width / 2,
      fill: parseAnnotationColor(annotation.style.stroke),
      opacity,
    }]
  }
  const primitives: RenderPrimitive[] = [{
    kind: 'polyline',
    points,
    stroke: {
      color: parseAnnotationColor(annotation.style.stroke),
      width: selected ? width + 2 : width,
      lineCap: 'round',
      lineJoin: 'round',
    },
    opacity,
  }]
  appendSelectionPrimitives(primitives, annotation, selected, context)
  return primitives
}

function hitTestBrush(entry: AnnotationRenderEntry, screenPoint: Vec2, context: AnnotationRenderContext) {
  const markerDistance = hitTestWorldMarker(entry, screenPoint, context)
  if (markerDistance !== null) {
    return markerDistance
  }
  const annotation = entry.annotation as BrushAnnotation
  const projected = annotation.geometry.points
    .map((point) => context.projectionHost.project(annotation.frame, point, context.viewport))
    .filter((point): point is Vec2 => point !== null)
  if (projected.length === 0) {
    return null
  }
  const threshold = Math.max(annotation.geometry.radius * getFrameScreenScale(annotation, context), 6)
  if (projected.length === 1) {
    const distance = vec2Distance(screenPoint, projected[0])
    return distance <= threshold ? distance : null
  }
  let best = Number.POSITIVE_INFINITY
  for (let index = 1; index < projected.length; index += 1) {
    best = Math.min(best, distanceToSegment(screenPoint, projected[index - 1], projected[index]))
  }
  return best <= threshold ? best : null
}

function buildPolygon(entry: AnnotationRenderEntry, context: AnnotationRenderContext): RenderPrimitive[] {
  const worldMarker = buildWorldMarker(entry, context)
  if (worldMarker) {
    return worldMarker
  }
  const annotation = entry.annotation as PolygonAnnotation
  const { selected, alphaMultiplier = 1 } = entry
  const points = annotation.geometry.points
    .map((point) => context.projectionHost.project(annotation.frame, point, context.viewport))
    .filter((point): point is Vec2 => point !== null)
  if (points.length < 2) {
    return []
  }
  const primitives: RenderPrimitive[] = [{
    kind: 'polyline',
    points,
    closed: points.length >= 3,
    fill: points.length >= 3 ? parseAnnotationColor(annotation.style.fill) : undefined,
    stroke: createStroke(annotation, selected),
    opacity: annotation.style.opacity * alphaMultiplier,
  }]
  appendSelectionPrimitives(primitives, annotation, selected, context)
  return primitives
}

function hitTestPolygon(entry: AnnotationRenderEntry, screenPoint: Vec2, context: AnnotationRenderContext) {
  const markerDistance = hitTestWorldMarker(entry, screenPoint, context)
  if (markerDistance !== null) {
    return markerDistance
  }
  const annotation = entry.annotation as PolygonAnnotation
  const projected = annotation.geometry.points
    .map((point) => context.projectionHost.project(annotation.frame, point, context.viewport))
    .filter((point): point is Vec2 => point !== null)
  if (projected.length < 2) {
    return null
  }
  if (projected.length >= 3 && pointInPolygon(screenPoint, projected)) {
    return 0
  }
  let best = Number.POSITIVE_INFINITY
  for (let index = 0; index < projected.length; index += 1) {
    const next = projected[(index + 1) % projected.length]
    best = Math.min(best, distanceToSegment(screenPoint, projected[index], next))
  }
  return best <= 8 ? best : null
}

function buildRectangle(entry: AnnotationRenderEntry, context: AnnotationRenderContext): RenderPrimitive[] {
  const worldMarker = buildWorldMarker(entry, context)
  if (worldMarker) {
    return worldMarker
  }
  const annotation = entry.annotation as BoundsAnnotation
  const { selected, alphaMultiplier = 1 } = entry
  const corners = getRectangleCorners(annotation.geometry)
    .map((point) => context.projectionHost.project(annotation.frame, point, context.viewport))
    .filter((point): point is Vec2 => point !== null)
  if (corners.length !== 4) {
    return []
  }
  const primitives: RenderPrimitive[] = [{
    kind: 'polyline',
    points: corners,
    closed: true,
    fill: parseAnnotationColor(annotation.style.fill),
    stroke: createStroke(annotation, selected),
    opacity: annotation.style.opacity * alphaMultiplier,
  }]
  appendSelectionPrimitives(primitives, annotation, selected, context)
  return primitives
}

function hitTestBoundsRect(entry: AnnotationRenderEntry, screenPoint: Vec2, context: AnnotationRenderContext) {
  const markerDistance = hitTestWorldMarker(entry, screenPoint, context)
  if (markerDistance !== null) {
    return markerDistance
  }

  const annotation = entry.annotation as BoundsAnnotation
  const projected = getRectangleCorners(annotation.geometry)
    .map((point) => context.projectionHost.project(annotation.frame, point, context.viewport))
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

function buildEllipse(entry: AnnotationRenderEntry, context: AnnotationRenderContext): RenderPrimitive[] {
  const worldMarker = buildWorldMarker(entry, context)
  if (worldMarker) {
    return worldMarker
  }
  const annotation = entry.annotation as BoundsAnnotation
  const { selected, alphaMultiplier = 1 } = entry
  const bounds = normalizeBounds(annotation.geometry.start, annotation.geometry.end)
  const segments = Array.from({ length: 40 }, (_, index) => {
    const angle = (Math.PI * 2 * index) / 40
    return {
      x: (bounds.minX + bounds.maxX) / 2 + Math.cos(angle) * (bounds.maxX - bounds.minX) / 2,
      y: (bounds.minY + bounds.maxY) / 2 + Math.sin(angle) * (bounds.maxY - bounds.minY) / 2,
    }
  })
    .map((point) => context.projectionHost.project(annotation.frame, point, context.viewport))
    .filter((point): point is Vec2 => point !== null)
  if (segments.length < 3) {
    return []
  }
  const primitives: RenderPrimitive[] = [{
    kind: 'polyline',
    points: segments,
    closed: true,
    fill: parseAnnotationColor(annotation.style.fill),
    stroke: createStroke(annotation, selected),
    opacity: annotation.style.opacity * alphaMultiplier,
  }]
  appendSelectionPrimitives(primitives, annotation, selected, context)
  return primitives
}

function hitTestEllipse(entry: AnnotationRenderEntry, screenPoint: Vec2, context: AnnotationRenderContext) {
  const markerDistance = hitTestWorldMarker(entry, screenPoint, context)
  if (markerDistance !== null) {
    return markerDistance
  }

  const annotation = entry.annotation as BoundsAnnotation
  const projected = getRectangleCorners(annotation.geometry)
    .map((point) => context.projectionHost.project(annotation.frame, point, context.viewport))
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

function buildText(entry: AnnotationRenderEntry, context: AnnotationRenderContext): RenderPrimitive[] {
  const worldMarker = buildWorldMarker(entry, context)
  if (worldMarker) {
    return worldMarker
  }
  const annotation = entry.annotation as TextAnnotation
  const { selected, alphaMultiplier = 1 } = entry
  const anchor = context.projectionHost.project(annotation.frame, annotation.geometry.position, context.viewport)
  if (!anchor) {
    return []
  }
  const primitives: RenderPrimitive[] = [{
    kind: 'label',
    text: annotation.geometry.text,
    position: { x: anchor.x, y: anchor.y - (annotation.style.fontSize + 14) },
    paddingX: 10,
    paddingY: 7,
    radius: 10,
    background: parseAnnotationColor(annotation.style.fill),
    stroke: createStroke(annotation, selected),
    style: createTextStyle(annotation.style.fontSize, '#f8fafc', 600),
    opacity: annotation.style.opacity * alphaMultiplier,
  }]
  appendSelectionPrimitives(primitives, annotation, selected, context)
  return primitives
}

function hitTestText(entry: AnnotationRenderEntry, screenPoint: Vec2, context: AnnotationRenderContext) {
  const markerDistance = hitTestWorldMarker(entry, screenPoint, context)
  if (markerDistance !== null) {
    return markerDistance
  }

  const annotation = entry.annotation as TextAnnotation
  const position = context.projectionHost.project(annotation.frame, annotation.geometry.position, context.viewport)
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

function buildCard(entry: AnnotationRenderEntry, context: AnnotationRenderContext): RenderPrimitive[] {
  const worldMarker = buildWorldMarker(entry, context)
  if (worldMarker) {
    return worldMarker
  }
  const annotation = entry.annotation as CardAnnotation
  const { selected, alphaMultiplier = 1 } = entry
  const bounds = getAnnotationScreenBounds(annotation, context.projectionHost, context.viewport)
  if (!bounds) {
    return []
  }
  const { radius, paddingX, topOffset, bodySize, lineHeight } = getDetailCardMetrics(bounds.width, bounds.height)
  const maxLines = Math.max(1, Math.floor((bounds.height - topOffset * 2) / lineHeight))
  const primitives: RenderPrimitive[] = [
    {
      kind: 'roundedRect',
      x: bounds.left,
      y: bounds.top,
      width: bounds.width,
      height: bounds.height,
      radius,
      fill: parseAnnotationColor(annotation.style.fill),
      stroke: createStroke(annotation, selected),
      opacity: annotation.style.opacity * alphaMultiplier,
    },
    {
      kind: 'textBlock',
      lines: annotation.geometry.body,
      position: { x: bounds.left + paddingX, y: bounds.top + topOffset },
      maxWidth: Math.max(20, bounds.width - paddingX * 2),
      lineHeight,
      maxLines,
      style: createTextStyle(bodySize, '#10243a', 500),
      opacity: annotation.style.opacity * alphaMultiplier,
    },
  ]
  if (selected) {
    primitives.push(...buildCardMoveAffordance(bounds))
  }
  appendSelectionPrimitives(primitives, annotation, selected, context)
  return primitives
}

function buildList(entry: AnnotationRenderEntry, context: AnnotationRenderContext): RenderPrimitive[] {
  const worldMarker = buildWorldMarker(entry, context)
  if (worldMarker) {
    return worldMarker
  }
  const annotation = entry.annotation as ListAnnotation
  const { selected, alphaMultiplier = 1 } = entry
  const bounds = getAnnotationScreenBounds(annotation, context.projectionHost, context.viewport)
  if (!bounds) {
    return []
  }
  const titleSize = clamp(annotation.style.fontSize + Math.min(bounds.width / 42, 8), 14, 26)
  const itemSize = clamp(annotation.style.fontSize + Math.min(bounds.width / 84, 4), 11, 20)
  const padding = clamp(bounds.width * 0.05, 12, 22)
  const bulletRadius = clamp(itemSize * 0.22, 2.5, 5)
  const lineHeight = itemSize * 1.45
  const top = bounds.top + padding * 1.8 + titleSize
  const maxItems = Math.max(1, Math.floor((bounds.height - (top - bounds.top) - padding) / lineHeight))
  const primitives: RenderPrimitive[] = [{
    kind: 'roundedRect',
    x: bounds.left,
    y: bounds.top,
    width: bounds.width,
    height: bounds.height,
    radius: 18,
    fill: parseAnnotationColor(annotation.style.fill),
    stroke: createStroke(annotation, selected),
    opacity: annotation.style.opacity * alphaMultiplier,
  }, {
    kind: 'text',
    text: annotation.geometry.title,
    position: { x: bounds.left + padding, y: bounds.top + padding + titleSize },
    style: createTextStyle(titleSize, '#f8fafc', 700),
    opacity: annotation.style.opacity * alphaMultiplier,
  }]
  annotation.geometry.items.slice(0, maxItems).forEach((item: string, index: number) => {
    const y = top + lineHeight * (index + 0.8)
    primitives.push({
      kind: 'circle',
      center: { x: bounds.left + padding + bulletRadius, y: y - itemSize * 0.28 },
      radius: bulletRadius,
      fill: parseAnnotationColor('#f8fafc'),
      opacity: annotation.style.opacity * alphaMultiplier,
    })
    primitives.push({
      kind: 'text',
      text: item,
      position: { x: bounds.left + padding + bulletRadius * 2 + 8, y },
      style: createTextStyle(itemSize, '#f8fafc', 500),
      opacity: annotation.style.opacity * alphaMultiplier,
    })
  })
  appendSelectionPrimitives(primitives, annotation, selected, context)
  return primitives
}

function buildGrid(entry: AnnotationRenderEntry, context: AnnotationRenderContext): RenderPrimitive[] {
  const worldMarker = buildWorldMarker(entry, context)
  if (worldMarker) {
    return worldMarker
  }
  const annotation = entry.annotation as GridAnnotation
  const { selected, alphaMultiplier = 1 } = entry
  const bounds = getAnnotationScreenBounds(annotation, context.projectionHost, context.viewport)
  if (!bounds) {
    return []
  }
  const titleSize = clamp(annotation.style.fontSize + Math.min(bounds.width / 48, 8), 13, 24)
  const cellSize = clamp(annotation.style.fontSize + Math.min(bounds.width / 120, 3), 9, 18)
  const headerHeight = titleSize + 20
  const gridTop = bounds.top + headerHeight
  const cellWidth = bounds.width / annotation.geometry.columns
  const cellHeight = Math.max((bounds.height - headerHeight) / annotation.geometry.rows, 10)
  const primitives: RenderPrimitive[] = [{
    kind: 'roundedRect',
    x: bounds.left,
    y: bounds.top,
    width: bounds.width,
    height: bounds.height,
    radius: 18,
    fill: parseAnnotationColor(annotation.style.fill),
    stroke: createStroke(annotation, selected),
    opacity: annotation.style.opacity * alphaMultiplier,
  }, {
    kind: 'text',
    text: annotation.geometry.title,
    position: { x: bounds.left + 14, y: bounds.top + titleSize + 10 },
    style: createTextStyle(titleSize, '#f8fafc', 700),
    opacity: annotation.style.opacity * alphaMultiplier,
  }]
  for (let column = 1; column < annotation.geometry.columns; column += 1) {
    const x = bounds.left + column * cellWidth
    primitives.push({
      kind: 'line',
      start: { x, y: gridTop },
      end: { x, y: bounds.top + bounds.height },
      stroke: { color: parseAnnotationColor('rgba(248, 250, 252, 0.18)'), width: 1 },
      opacity: annotation.style.opacity * alphaMultiplier,
    })
  }
  for (let row = 1; row < annotation.geometry.rows; row += 1) {
    const y = gridTop + row * cellHeight
    primitives.push({
      kind: 'line',
      start: { x: bounds.left, y },
      end: { x: bounds.left + bounds.width, y },
      stroke: { color: parseAnnotationColor('rgba(248, 250, 252, 0.18)'), width: 1 },
      opacity: annotation.style.opacity * alphaMultiplier,
    })
  }
  if (cellWidth >= 34 && cellHeight >= 22) {
    for (let row = 0; row < annotation.geometry.rows; row += 1) {
      for (let column = 0; column < annotation.geometry.columns; column += 1) {
        primitives.push({
          kind: 'text',
          text: `${row + 1},${column + 1}`,
          position: {
            x: bounds.left + column * cellWidth + 8,
            y: gridTop + row * cellHeight + Math.min(cellHeight * 0.45, 18),
          },
          style: createTextStyle(cellSize, 'rgba(248, 250, 252, 0.76)', 600),
          opacity: annotation.style.opacity * alphaMultiplier,
        })
      }
    }
  }
  appendSelectionPrimitives(primitives, annotation, selected, context)
  return primitives
}

const BUILTIN_PLUGINS: AnnotationRenderPlugin[] = [
  {
    id: 'freehand',
    kinds: ['freehand'],
    renderBatch: (entries, context) => entries.flatMap((entry) => buildFreehand(entry, context)),
    hitTest: (entry, screenPoint, context) => hitTestFreehand(entry, screenPoint, context),
    getScreenBounds: (entry, context) => getAnnotationHitBounds(entry, context, 10),
  },
  {
    id: 'brush',
    kinds: ['brush'],
    renderBatch: (entries, context) => entries.flatMap((entry) => buildBrush(entry, context)),
    hitTest: (entry, screenPoint, context) => hitTestBrush(entry, screenPoint, context),
    getScreenBounds: (entry, context) => getAnnotationHitBounds(entry, context, 12),
  },
  {
    id: 'polygon',
    kinds: ['polygon'],
    renderBatch: (entries, context) => entries.flatMap((entry) => buildPolygon(entry, context)),
    hitTest: (entry, screenPoint, context) => hitTestPolygon(entry, screenPoint, context),
    getScreenBounds: (entry, context) => getAnnotationHitBounds(entry, context, 8),
  },
  {
    id: 'rectangle',
    kinds: ['rectangle'],
    renderBatch: (entries, context) => entries.flatMap((entry) => buildRectangle(entry, context)),
    hitTest: (entry, screenPoint, context) => hitTestBoundsRect(entry, screenPoint, context),
    getScreenBounds: (entry, context) => getAnnotationHitBounds(entry, context, 8),
  },
  {
    id: 'ellipse',
    kinds: ['ellipse'],
    renderBatch: (entries, context) => entries.flatMap((entry) => buildEllipse(entry, context)),
    hitTest: (entry, screenPoint, context) => hitTestEllipse(entry, screenPoint, context),
    getScreenBounds: (entry, context) => getAnnotationHitBounds(entry, context, 8),
  },
  {
    id: 'text',
    kinds: ['text'],
    renderBatch: (entries, context) => entries.flatMap((entry) => buildText(entry, context)),
    hitTest: (entry, screenPoint, context) => hitTestText(entry, screenPoint, context),
    getScreenBounds: (entry, context) => getTextScreenBounds(entry, context),
  },
  {
    id: 'card',
    kinds: ['card'],
    renderBatch: (entries, context) => entries.flatMap((entry) => buildCard(entry, context)),
    hitTest: (entry, screenPoint, context) => hitTestBoundsRect(entry, screenPoint, context),
    getScreenBounds: (entry, context) => getAnnotationHitBounds(entry, context, 8),
  },
  {
    id: 'list',
    kinds: ['list'],
    renderBatch: (entries, context) => entries.flatMap((entry) => buildList(entry, context)),
    hitTest: (entry, screenPoint, context) => hitTestBoundsRect(entry, screenPoint, context),
    getScreenBounds: (entry, context) => getAnnotationHitBounds(entry, context, 8),
  },
  {
    id: 'grid',
    kinds: ['grid'],
    renderBatch: (entries, context) => entries.flatMap((entry) => buildGrid(entry, context)),
    hitTest: (entry, screenPoint, context) => hitTestBoundsRect(entry, screenPoint, context),
    getScreenBounds: (entry, context) => getAnnotationHitBounds(entry, context, 8),
  },
]

export class AnnotationRenderPluginManager {
  private readonly plugins: AnnotationRenderPlugin[]

  constructor(plugins: AnnotationRenderPlugin[]) {
    this.plugins = plugins
  }

  resolvePlugin(annotation: AnnotationEntity) {
    return this.plugins.find((plugin) => plugin.kinds.includes(annotation.geometry.kind))
  }

  hitTest(entry: AnnotationRenderEntry, screenPoint: Vec2, context: AnnotationRenderContext) {
    const plugin = this.resolvePlugin(entry.annotation)
    return plugin ? plugin.hitTest(entry, screenPoint, context) : null
  }

  getScreenBounds(entry: AnnotationRenderEntry, context: AnnotationRenderContext) {
    const plugin = this.resolvePlugin(entry.annotation)
    return plugin ? plugin.getScreenBounds(entry, context) : null
  }
}

export const defaultAnnotationRenderPluginManager = new AnnotationRenderPluginManager(BUILTIN_PLUGINS)

export function buildParticipantRenderPrimitives(participant: ParticipantState): RenderPrimitive[] {
  if (!participant.cursor) {
    return []
  }

  return [
    {
      kind: 'polyline',
      points: [
        { x: participant.cursor.x, y: participant.cursor.y },
        { x: participant.cursor.x + 14, y: participant.cursor.y + 8 },
        { x: participant.cursor.x + 7, y: participant.cursor.y + 10 },
        { x: participant.cursor.x + 8, y: participant.cursor.y + 20 },
        { x: participant.cursor.x + 4, y: participant.cursor.y + 20 },
        { x: participant.cursor.x + 3, y: participant.cursor.y + 9 },
        { x: participant.cursor.x - 2, y: participant.cursor.y + 15 },
      ],
      closed: true,
      fill: parseAnnotationColor(participant.color),
      stroke: {
        color: parseAnnotationColor('#020617'),
        width: 2,
      },
    },
    {
      kind: 'label',
      text: participant.name,
      position: { x: participant.cursor.x + 14, y: participant.cursor.y - 18 },
      paddingX: 7,
      paddingY: 5,
      radius: 8,
      background: parseAnnotationColor('#020617'),
      style: createTextStyle(12, '#f8fafc', 600),
    },
  ]
}