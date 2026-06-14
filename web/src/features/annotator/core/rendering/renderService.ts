import type { ParticipantState } from '../annotations/types'
import type { AnnotationProjectionHost, ViewportSize } from './host'
import {
  defaultAnnotationRenderPluginManager,
  buildParticipantRenderPrimitives,
  type AnnotationRenderEntry,
  type AnnotationRenderPluginManager,
} from './annotationPlugins'
import type { RenderPrimitive } from './primitives'

export interface PackedPolylineBatch {
  kind: 'polyline'
  points: Float32Array
  pointCounts: Uint32Array
}

export interface PackedLineBatch {
  kind: 'line'
  segments: Float32Array
}

export interface PackedCircleBatch {
  kind: 'circle'
  circles: Float32Array
}

export interface PackedRoundedRectBatch {
  kind: 'roundedRect'
  rects: Float32Array
}

export interface PackedEllipseBatch {
  kind: 'ellipse'
  ellipses: Float32Array
}

export type PackedPrimitiveBatch =
  | PackedPolylineBatch
  | PackedLineBatch
  | PackedCircleBatch
  | PackedRoundedRectBatch
  | PackedEllipseBatch

export interface RenderPrimitiveBatch {
  key: string
  kind: RenderPrimitive['kind']
  primitives: RenderPrimitive[]
  orderStart: number
  orderEnd: number
  packed?: PackedPrimitiveBatch
}

export interface AnnotationSceneRenderPlan {
  primitives: RenderPrimitive[]
  batches: RenderPrimitiveBatch[]
}

function primitiveSignature(primitive: RenderPrimitive) {
  switch (primitive.kind) {
    case 'polyline':
      return JSON.stringify({ kind: primitive.kind, closed: primitive.closed, stroke: primitive.stroke, fill: primitive.fill, opacity: primitive.opacity })
    case 'ellipse':
    case 'roundedRect':
    case 'circle':
      return JSON.stringify({ kind: primitive.kind, stroke: primitive.stroke, fill: primitive.fill, opacity: primitive.opacity })
    case 'line':
      return JSON.stringify({ kind: primitive.kind, stroke: primitive.stroke, opacity: primitive.opacity })
    case 'text':
    case 'textBlock':
    case 'label':
      return JSON.stringify({ kind: primitive.kind, style: 'style' in primitive ? primitive.style : undefined, opacity: primitive.opacity })
  }
}

function buildPrimitiveBatches(primitives: RenderPrimitive[]): RenderPrimitiveBatch[] {
  const batches: RenderPrimitiveBatch[] = []
  primitives.forEach((primitive, index) => {
    const key = primitiveSignature(primitive)
    const previous = batches[batches.length - 1]
    if (previous && previous.key === key && previous.kind === primitive.kind) {
      previous.primitives.push(primitive)
      previous.orderEnd = index
      return
    }

    batches.push({
      key,
      kind: primitive.kind,
      primitives: [primitive],
      orderStart: index,
      orderEnd: index,
    })
  })

  batches.forEach((batch) => {
    batch.packed = packPrimitiveBatch(batch.primitives)
  })

  return batches
}

function packPrimitiveBatch(primitives: RenderPrimitive[]): PackedPrimitiveBatch | undefined {
  if (primitives.length === 0) {
    return undefined
  }

  const exemplar = primitives[0]
  switch (exemplar.kind) {
    case 'polyline': {
      const polylinePrimitives = primitives as Extract<RenderPrimitive, { kind: 'polyline' }>[]
      const totalPoints = polylinePrimitives.reduce((sum, primitive) => sum + primitive.points.length, 0)
      const points = new Float32Array(totalPoints * 2)
      const pointCounts = new Uint32Array(polylinePrimitives.length)
      let pointOffset = 0
      polylinePrimitives.forEach((primitive, index) => {
        pointCounts[index] = primitive.points.length
        primitive.points.forEach((point) => {
          points[pointOffset] = point.x
          points[pointOffset + 1] = point.y
          pointOffset += 2
        })
      })
      return { kind: 'polyline', points, pointCounts }
    }
    case 'line': {
      const linePrimitives = primitives as Extract<RenderPrimitive, { kind: 'line' }>[]
      const segments = new Float32Array(linePrimitives.length * 4)
      linePrimitives.forEach((primitive, index) => {
        const offset = index * 4
        segments[offset] = primitive.start.x
        segments[offset + 1] = primitive.start.y
        segments[offset + 2] = primitive.end.x
        segments[offset + 3] = primitive.end.y
      })
      return { kind: 'line', segments }
    }
    case 'circle': {
      const circlePrimitives = primitives as Extract<RenderPrimitive, { kind: 'circle' }>[]
      const circles = new Float32Array(circlePrimitives.length * 3)
      circlePrimitives.forEach((primitive, index) => {
        const offset = index * 3
        circles[offset] = primitive.center.x
        circles[offset + 1] = primitive.center.y
        circles[offset + 2] = primitive.radius
      })
      return { kind: 'circle', circles }
    }
    case 'roundedRect': {
      const roundedRectPrimitives = primitives as Extract<RenderPrimitive, { kind: 'roundedRect' }>[]
      const rects = new Float32Array(roundedRectPrimitives.length * 5)
      roundedRectPrimitives.forEach((primitive, index) => {
        const offset = index * 5
        rects[offset] = primitive.x
        rects[offset + 1] = primitive.y
        rects[offset + 2] = primitive.width
        rects[offset + 3] = primitive.height
        rects[offset + 4] = primitive.radius
      })
      return { kind: 'roundedRect', rects }
    }
    case 'ellipse': {
      const ellipsePrimitives = primitives as Extract<RenderPrimitive, { kind: 'ellipse' }>[]
      const ellipses = new Float32Array(ellipsePrimitives.length * 4)
      ellipsePrimitives.forEach((primitive, index) => {
        const offset = index * 4
        ellipses[offset] = primitive.center.x
        ellipses[offset + 1] = primitive.center.y
        ellipses[offset + 2] = primitive.radiusX
        ellipses[offset + 3] = primitive.radiusY
      })
      return { kind: 'ellipse', ellipses }
    }
    default:
      return undefined
  }
}

function flushRun(
  primitives: RenderPrimitive[],
  run: AnnotationRenderEntry[],
  pluginId: string | null,
  projectionHost: AnnotationProjectionHost,
  viewport: ViewportSize,
  pluginManager: AnnotationRenderPluginManager,
) {
  if (!pluginId || run.length === 0) {
    return
  }

  const plugin = pluginManager.resolvePlugin(run[0].annotation)
  if (!plugin) {
    return
  }

  primitives.push(...plugin.renderBatch(run, { projectionHost, viewport }))
}

export function buildAnnotationSceneRenderPlan(options: {
  projectionHost: AnnotationProjectionHost
  viewport: ViewportSize
  annotations: AnnotationRenderEntry[]
  participants?: ParticipantState[]
  pluginManager?: AnnotationRenderPluginManager
}) {
  const pluginManager = options.pluginManager ?? defaultAnnotationRenderPluginManager
  const primitives: RenderPrimitive[] = []
  let run: AnnotationRenderEntry[] = []
  let runKey: string | null = null

  options.annotations.forEach((entry) => {
    const plugin = pluginManager.resolvePlugin(entry.annotation)
    const nextKey = plugin
      ? `${plugin.id}:${entry.selected ? 1 : 0}:${entry.alphaMultiplier ?? 1}:${entry.collapseUnselectedWorldMarker === false ? 0 : 1}`
      : null

    if (!plugin) {
      return
    }

    if (runKey !== nextKey) {
      flushRun(primitives, run, runKey, options.projectionHost, options.viewport, pluginManager)
      run = [entry]
      runKey = nextKey
      return
    }

    run.push(entry)
  })

  flushRun(primitives, run, runKey, options.projectionHost, options.viewport, pluginManager)

  options.participants?.forEach((participant) => {
    primitives.push(...buildParticipantRenderPrimitives(participant))
  })

  return {
    primitives,
    batches: buildPrimitiveBatches(primitives),
  } satisfies AnnotationSceneRenderPlan
}