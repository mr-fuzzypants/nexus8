import { getRectangleCorners } from '../annotations/geometry'
import type {
  AnnotationEntity,
  Vec2,
} from '../annotations/types'
import type { AnnotationProjectionHost, ViewportSize } from './host'
import { getLabelBounds } from './textLayout'

export interface AnnotationScreenBounds {
  left: number
  top: number
  width: number
  height: number
  centerX: number
  centerY: number
}

export const DETAIL_CARD_BASE_WIDTH = 620
export const DETAIL_CARD_BASE_HEIGHT = 220
export const DETAIL_CARD_BASE_RADIUS = 28
export const DETAIL_CARD_BASE_PADDING_X = 40
export const DETAIL_CARD_BASE_TOP_OFFSET = 44
export const DETAIL_CARD_BASE_BODY_SIZE = 24
export const DETAIL_CARD_BASE_LINE_HEIGHT = 40

export function getDetailCardMetrics(width: number, height: number) {
  const scale = Math.min(width / DETAIL_CARD_BASE_WIDTH, height / DETAIL_CARD_BASE_HEIGHT)
  return {
    scale,
    radius: Math.max(1, DETAIL_CARD_BASE_RADIUS * scale),
    paddingX: Math.max(1, DETAIL_CARD_BASE_PADDING_X * scale),
    topOffset: Math.max(1, DETAIL_CARD_BASE_TOP_OFFSET * scale),
    bodySize: Math.max(1, DETAIL_CARD_BASE_BODY_SIZE * scale),
    lineHeight: Math.max(1, DETAIL_CARD_BASE_LINE_HEIGHT * scale),
  }
}

export function getCardMoveGripBounds(bounds: AnnotationScreenBounds) {
  const handleRadius = Math.max(4, Math.min(bounds.width, bounds.height) * 0.045)
  return {
    left: bounds.left + bounds.width / 2 - handleRadius,
    top: bounds.top - handleRadius,
    width: handleRadius * 2,
    height: handleRadius * 2,
  }
}

export function getCardMoveHandleTargets(bounds: AnnotationScreenBounds) {
  const radius = Math.max(4, Math.min(bounds.width, bounds.height) * 0.045)
  return [
    { x: bounds.left, y: bounds.top, radius },
    { x: bounds.left + bounds.width, y: bounds.top, radius },
    { x: bounds.left + bounds.width, y: bounds.top + bounds.height, radius },
    { x: bounds.left, y: bounds.top + bounds.height, radius },
  ]
}

function getProjectedBounds(
  annotation: AnnotationEntity,
  projectionHost: AnnotationProjectionHost,
  viewport: ViewportSize,
): AnnotationScreenBounds | null {
  if (!('start' in annotation.geometry) || !('end' in annotation.geometry)) {
    return null
  }

  const corners = getRectangleCorners(annotation.geometry)
    .map((point) => projectionHost.project(annotation.frame, point, viewport))
    .filter((point): point is Vec2 => point !== null)
  if (corners.length !== 4) {
    return null
  }

  const xs = corners.map((point) => point.x)
  const ys = corners.map((point) => point.y)
  const left = Math.min(...xs)
  const top = Math.min(...ys)
  const width = Math.max(...xs) - left
  const height = Math.max(...ys) - top
  return {
    left,
    top,
    width,
    height,
    centerX: left + width / 2,
    centerY: top + height / 2,
  }
}

export function getAnnotationScreenBounds(
  annotation: AnnotationEntity,
  projectionHost: AnnotationProjectionHost,
  viewport: ViewportSize,
): AnnotationScreenBounds | null {
  switch (annotation.geometry.kind) {
    case 'rectangle':
    case 'ellipse':
    case 'card':
    case 'grid':
    case 'list':
      return getProjectedBounds(annotation, projectionHost, viewport)
    case 'text': {
      const anchor = projectionHost.project(annotation.frame, annotation.geometry.position, viewport)
      if (!anchor) {
        return null
      }
      const bounds = getLabelBounds({
        text: annotation.geometry.text,
        position: { x: anchor.x, y: anchor.y - (annotation.style.fontSize + 14) },
        paddingX: 10,
        paddingY: 7,
        style: {
          fontSize: annotation.style.fontSize,
          fontWeight: 600,
          fontFamily: 'Inter, system-ui, sans-serif',
          color: { r: 248, g: 250, b: 252, a: 1 },
        },
      })
      return {
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height,
        centerX: bounds.left + bounds.width / 2,
        centerY: bounds.top + bounds.height / 2,
      }
    }
    case 'freehand':
    case 'brush':
    case 'polygon': {
      const points = annotation.geometry.points
        .map((point) => projectionHost.project(annotation.frame, point, viewport))
        .filter((point): point is Vec2 => point !== null)
      if (points.length === 0) {
        return null
      }
      const xs = points.map((point) => point.x)
      const ys = points.map((point) => point.y)
      const left = Math.min(...xs)
      const top = Math.min(...ys)
      const width = Math.max(...xs) - left
      const height = Math.max(...ys) - top
      return {
        left,
        top,
        width,
        height,
        centerX: left + width / 2,
        centerY: top + height / 2,
      }
    }
  }
}