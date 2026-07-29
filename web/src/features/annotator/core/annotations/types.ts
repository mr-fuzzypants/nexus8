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

export type MaskOp = 'inpaint' | 'outpaint' | 'background_replace' | 'remove' | 'segment' | 'scribble' | 'sketch_inpaint'
/** Generation quality tradeoff: fast = LCM (~2s, harmonize/remove only — barely
 *  follows prompts); quality = full CFG (~4-5s, needed for prompted content). */
export type GenMode = 'fast' | 'quality'

export interface AnnotationLayer {
  id: string
  name: string
  visible: boolean
  supportedSpaces: ViewerSpace[]
  /** Visual accent color for display in the mask layers panel. */
  color?: string
  /** Sort order within the mask layers panel (lower = higher in list). */
  order?: number
  /** AI operation this mask region is intended for. */
  mask_op?: MaskOp
  /** Natural language prompt for generative AI operations. */
  prompt?: string
  /** Reference asset URI (nexus8://{code} or nexus8://{code}/{ref}, e.g. nexus8://ABC123/latest). */
  reference?: string
  /** Live-generation quality mode; defaults to 'quality' when a prompt is set. */
  gen_mode?: GenMode
  /** ControlNet conditioning strength for scribble/sketch-inpaint (0.3–1.0, default 0.7). */
  controlnet_scale?: number
  /** CFG guidance scale. Scribble: 0–3 (default 1.0); sketch inpaint: 1–15 (default 7.5). */
  guidance_scale?: number
  /** Number of diffusion steps for sketch inpaint (10–50, default 20). More steps = higher quality, slower. */
  num_inference_steps?: number
  /** Negative prompt for sketch inpaint — describe what to avoid in the generation. */
  negative_prompt?: string
  /** Whether scribble generation replaces the full image or only the sketched region. */
  scribble_scope?: 'full' | 'region'
  /** Fixed RNG seed for reproducible generation. Omit for a random result each time. */
  seed?: number
  /** Scribble + sketch inpaint: images generated per run in one GPU batch (1–4,
   *  default 1). Variant i uses seed base+i, so each is individually reproducible. */
  num_variants?: number
  /** Sketch inpaint denoise strength (0.3–1.0, default 1.0). 1.0 = regenerate the
   *  masked region from noise; lower keeps the original pixels' structure. Effective
   *  steps = num_inference_steps × strength, so raise steps when lowering this. */
  denoise_strength?: number
  /** Sketch inpaint: IP-Adapter influence of the reference image (0–1, default 0.5).
   *  Only meaningful when `reference` resolves to an image; higher values can
   *  override the text prompt. */
  reference_scale?: number
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
