import type { Vec2 } from '../annotations/types'
import type { AnnotationColor } from '../annotations/schema'

export interface RenderStrokeStyle {
  color: AnnotationColor
  width: number
  dash?: number[]
  lineCap?: CanvasLineCap
  lineJoin?: CanvasLineJoin
}

export interface RenderTextStyle {
  color: AnnotationColor
  fontSize: number
  fontWeight?: number
  fontFamily?: string
}

export interface RenderPrimitiveBase {
  opacity?: number
}

export interface RenderPolylinePrimitive extends RenderPrimitiveBase {
  kind: 'polyline'
  points: Vec2[]
  closed?: boolean
  stroke?: RenderStrokeStyle
  fill?: AnnotationColor
}

export interface RenderEllipsePrimitive extends RenderPrimitiveBase {
  kind: 'ellipse'
  center: Vec2
  radiusX: number
  radiusY: number
  stroke?: RenderStrokeStyle
  fill?: AnnotationColor
}

export interface RenderRoundedRectPrimitive extends RenderPrimitiveBase {
  kind: 'roundedRect'
  x: number
  y: number
  width: number
  height: number
  radius: number
  stroke?: RenderStrokeStyle
  fill?: AnnotationColor
}

export interface RenderCirclePrimitive extends RenderPrimitiveBase {
  kind: 'circle'
  center: Vec2
  radius: number
  stroke?: RenderStrokeStyle
  fill?: AnnotationColor
}

export interface RenderLinePrimitive extends RenderPrimitiveBase {
  kind: 'line'
  start: Vec2
  end: Vec2
  stroke: RenderStrokeStyle
}

export interface RenderTextPrimitive extends RenderPrimitiveBase {
  kind: 'text'
  text: string
  position: Vec2
  style: RenderTextStyle
}

export interface RenderTextBlockPrimitive extends RenderPrimitiveBase {
  kind: 'textBlock'
  lines: string[]
  position: Vec2
  maxWidth: number
  lineHeight: number
  maxLines: number
  style: RenderTextStyle
}

export interface RenderLabelPrimitive extends RenderPrimitiveBase {
  kind: 'label'
  text: string
  position: Vec2
  paddingX: number
  paddingY: number
  radius: number
  background: AnnotationColor
  stroke?: RenderStrokeStyle
  style: RenderTextStyle
}

export type RenderPrimitive =
  | RenderPolylinePrimitive
  | RenderEllipsePrimitive
  | RenderRoundedRectPrimitive
  | RenderCirclePrimitive
  | RenderLinePrimitive
  | RenderTextPrimitive
  | RenderTextBlockPrimitive
  | RenderLabelPrimitive