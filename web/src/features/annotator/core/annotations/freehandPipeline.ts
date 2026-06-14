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
  private readonly rawPoints: Vec2[] = []
  private previewPoints: Vec2[] = []

  constructor(options: FreehandPipelineOptions) {
    this.options = options
    this.pointer = options.enableStabilizer
      ? new StabilizedPointer().addFilter(oneEuroFilter({ minCutoff: 1.0, beta: 0.007, dCutoff: 1.0 }))
      : null
  }

  addPoint(point: FreehandInputPoint) {
    this.rawPoints.push({ x: point.x, y: point.y })

    if (!this.pointer) {
      this.previewPoints = dedupeConsecutivePoints([...this.previewPoints, { x: point.x, y: point.y }])
      return this.previewPoints
    }

    const next = this.pointer.process(point)
    if (next) {
      this.previewPoints = dedupeConsecutivePoints([...this.previewPoints, { x: next.x, y: next.y }])
    }
    return this.previewPoints
  }

  getPreviewPoints() {
    return this.previewPoints.length > 0 ? this.previewPoints : this.rawPoints
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

    return dedupeConsecutivePoints(finalPoints)
  }
}

export const DEFAULT_FREEHAND_PIPELINE_OPTIONS: FreehandPipelineOptions = {
  enableStabilizer: true,
  enableSimplify: true,
  simplifyTolerance: 1.25,
  simplifyHighQuality: false,
}