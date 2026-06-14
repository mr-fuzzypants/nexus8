export type ViewerSpace = 'image2d' | 'world3d'
export type AnnotationTool =
  | 'select'
  | 'freehand'
  | 'rectangle'
  | 'ellipse'
  | 'text'
  | 'card'
  | 'grid'
  | 'list'
  | 'brush'
  | 'polygon'
export type AnnotationGeometryKind = Exclude<AnnotationTool, 'select'>

export interface Vec2 {
  x: number
  y: number
}

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface AnnotationFrame {
  space: ViewerSpace
  origin: Vec3
  xAxis: Vec3
  yAxis: Vec3
  targetId?: string
  cameraView?: {
    position: Vec3
    target: Vec3
    radius: number
    theta: number
    phi: number
  }
  mediaBinding?: {
    time: number
    frame: number
    clipId?: string
    clipLabel?: string
    globalTime?: number
  }
}

export interface AnnotationStyle {
  stroke: string
  fill: string
  strokeWidth: number
  opacity: number
  fontSize: number
  dashed?: boolean
}

export type AnnotationGeometry =
  | {
      kind: 'freehand'
      points: Vec2[]
    }
  | {
      kind: 'brush'
      points: Vec2[]
      /** Brush half-width in frame-local (image-pixel) units. */
      radius: number
    }
  | {
      kind: 'polygon'
      points: Vec2[]
    }
  | {
      kind: 'rectangle'
      start: Vec2
      end: Vec2
    }
  | {
      kind: 'ellipse'
      start: Vec2
      end: Vec2
    }
  | {
      kind: 'text'
      position: Vec2
      text: string
    }
  | {
      kind: 'card'
      start: Vec2
      end: Vec2
      body: string[]
    }
  | {
      kind: 'grid'
      start: Vec2
      end: Vec2
      title: string
      rows: number
      columns: number
    }
  | {
      kind: 'list'
      start: Vec2
      end: Vec2
      title: string
      items: string[]
    }

export interface AnnotationTimeRange {
  start: number
  end: number
}

export interface AnnotationEntity {
  id: string
  layerId: string
  timeRange?: AnnotationTimeRange
  frame: AnnotationFrame
  geometry: AnnotationGeometry
  style: AnnotationStyle
  drawOrder?: number
  /** When true, this shape contributes to rasterized mask generation. */
  maskRegion?: boolean
  authorId: string
  authorName: string
  createdAt: number
  updatedAt: number
  version: number
}

export interface AnnotationLayer {
  id: string
  name: string
  visible: boolean
  supportedSpaces: ViewerSpace[]
}

export interface AnnotationDocumentSnapshot {
  annotations: AnnotationEntity[]
  layers: AnnotationLayer[]
  version: number
}

export interface CollaborationProfile {
  id: string
  name: string
  color: string
}

export interface ParticipantState extends CollaborationProfile {
  activeTool?: AnnotationTool
  viewerId?: string
  cursor?: Vec2
  lastSeen: number
}

export const DEFAULT_LAYER_ID = 'shared-markup'

export const DEFAULT_LAYER: AnnotationLayer = {
  id: DEFAULT_LAYER_ID,
  name: 'Shared Markup',
  visible: true,
  supportedSpaces: ['image2d', 'world3d'],
}

export const DEFAULT_STYLE: AnnotationStyle = {
  stroke: '#5eead4',
  fill: 'rgba(94, 234, 212, 0.14)',
  strokeWidth: 2,
  opacity: 1,
  fontSize: 15,
}

export const STRUCTURED_OBJECT_TOOLS = ['card', 'grid', 'list'] as const

export type StructuredObjectTool = (typeof STRUCTURED_OBJECT_TOOLS)[number]

export function isStructuredObjectTool(tool: AnnotationTool): tool is StructuredObjectTool {
  return STRUCTURED_OBJECT_TOOLS.includes(tool as StructuredObjectTool)
}
