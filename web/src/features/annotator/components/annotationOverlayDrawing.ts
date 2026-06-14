import type { AnnotationEntity, ParticipantState } from '../core/annotations/types'
import { renderPrimitivesToCanvas } from '../core/rendering/canvasRenderer'
import {
  DETAIL_CARD_BASE_HEIGHT,
  DETAIL_CARD_BASE_WIDTH,
  getAnnotationScreenBounds,
  getCardMoveGripBounds,
  getCardMoveHandleTargets,
  getDetailCardMetrics,
  type AnnotationScreenBounds,
} from '../core/rendering/annotationLayout'
import { buildParticipantRenderPrimitives } from '../core/rendering/annotationPlugins'
import type { AnnotationProjectionHost, ViewportSize } from '../core/rendering/host'
import { buildAnnotationSceneRenderPlan } from '../core/rendering/renderService'

export type { AnnotationScreenBounds }

export {
  DETAIL_CARD_BASE_HEIGHT,
  DETAIL_CARD_BASE_WIDTH,
  getAnnotationScreenBounds,
  getCardMoveGripBounds,
  getCardMoveHandleTargets,
  getDetailCardMetrics,
}

export function buildAnnotationRenderPrimitives(
  annotation: AnnotationEntity,
  projectionHost: AnnotationProjectionHost,
  viewport: ViewportSize,
  selected: boolean,
  alphaMultiplier = 1,
  collapseUnselectedWorldMarker = true,
) {
  return buildAnnotationSceneRenderPlan({
    projectionHost,
    viewport,
    annotations: [{
      annotation,
      selected,
      alphaMultiplier,
      collapseUnselectedWorldMarker,
    }],
  }).primitives
}

export { buildParticipantRenderPrimitives }

export function drawAnnotation(
  context: CanvasRenderingContext2D,
  annotation: AnnotationEntity,
  projectionHost: AnnotationProjectionHost,
  viewport: ViewportSize,
  selected: boolean,
  alphaMultiplier = 1,
  collapseUnselectedWorldMarker = true,
) {
  renderPrimitivesToCanvas(
    context,
    buildAnnotationRenderPrimitives(annotation, projectionHost, viewport, selected, alphaMultiplier, collapseUnselectedWorldMarker),
  )
}

export function drawParticipant(context: CanvasRenderingContext2D, participant: ParticipantState) {
  renderPrimitivesToCanvas(context, buildParticipantRenderPrimitives(participant))
}

export function roundRect(
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