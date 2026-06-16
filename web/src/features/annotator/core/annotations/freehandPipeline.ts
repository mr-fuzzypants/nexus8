import { StabilizedPointer, oneEuroFilter } from '@stroke-stabilizer/core'
import simplify from 'simplify-js'
import type { Vec2 } from './types'

export interface FreehandPipelineOptions {
  enableStabilizer: boolean
  enableSimplify: boolean
  simplifyTolerance: number
  simplifyHighQuality: boolean
}

interface FreehandInputPoint extends Vec2 {
  timestamp: number
  pressure?: number
}

function dedupeConsecutivePoints(points: Vec2[]) {
  return points.filter((point, index) => (
    index === 0
    || point.x !== points[index - 1].x
    || point.y !== points[index - 1].y
  ))
}

export class FreehandStrokePipeline {
  private readonly options: FreehandPipelineOptions
  private readonly pointer: StabilizedPointer | null
  // Stabilization (one-euro velocity smoothing) and simplification both work in
  // the coordinate space of the incoming points and are tuned for screen pixels.
  // World-anchored (3D) frames feed tiny world-unit deltas, which would be
  // over-smoothed and over-simplified (a curve flattens to a line). We scale
  // input up to a pixel-equivalent space internally and scale results back out,
  // so behaviour is identical regardless of the frame's world scale.
  private readonly scale: number
  private readonly rawPoints: Vec2[] = []
  private previewPoints: Vec2[] = []

  constructor(options: FreehandPipelineOptions, coordinateScale = 1) {
    this.options = options
    this.scale = Number.isFinite(coordinateScale) && coordinateScale > 1e-9 ? coordinateScale : 1
    this.pointer = options.enableStabilizer
      ? new StabilizedPointer().addFilter(oneEuroFilter({ minCutoff: 1.0, beta: 0.007, dCutoff: 1.0 }))
      : null
  }

  private unscale(points: Vec2[]): Vec2[] {
    if (this.scale === 1) {
      return points.map((point) => ({ x: point.x, y: point.y }))
    }
    return points.map((point) => ({ x: point.x / this.scale, y: point.y / this.scale }))
  }

  addPoint(point: FreehandInputPoint) {
    const scaledX = point.x * this.scale
    const scaledY = point.y * this.scale
    this.rawPoints.push({ x: scaledX, y: scaledY })

    if (!this.pointer) {
      this.previewPoints = dedupeConsecutivePoints([...this.previewPoints, { x: scaledX, y: scaledY }])
      return this.unscale(this.previewPoints)
    }

    const next = this.pointer.process({ ...point, x: scaledX, y: scaledY })
    if (next) {
      this.previewPoints = dedupeConsecutivePoints([...this.previewPoints, { x: next.x, y: next.y }])
    }
    return this.unscale(this.previewPoints)
  }

  getPreviewPoints() {
    return this.unscale(this.previewPoints.length > 0 ? this.previewPoints : this.rawPoints)
  }

  finish() {
    let finalPoints = this.pointer
      ? this.pointer.finish().map((point) => ({ x: point.x, y: point.y }))
      : [...this.rawPoints]

    finalPoints = dedupeConsecutivePoints(finalPoints)

    if (this.options.enableSimplify && finalPoints.length > 2) {
      const simplified = simplify(finalPoints, this.options.simplifyTolerance, this.options.simplifyHighQuality)
      if (simplified.length >= 2) {
        finalPoints = simplified.map((point) => ({ x: point.x, y: point.y }))
      }
    }

    if (finalPoints.length === 0) {
      finalPoints = [...this.rawPoints]
    }

    return this.unscale(dedupeConsecutivePoints(finalPoints))
  }
}

export const DEFAULT_FREEHAND_PIPELINE_OPTIONS: FreehandPipelineOptions = {
  enableStabilizer: true,
  enableSimplify: true,
  simplifyTolerance: 1.25,
  simplifyHighQuality: false,
}