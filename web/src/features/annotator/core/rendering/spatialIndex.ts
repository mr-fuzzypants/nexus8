import type { Vec2 } from '../annotations/types'
import {
  defaultAnnotationRenderPluginManager,
  type AnnotationRenderContext,
  type AnnotationRenderEntry,
  type AnnotationRenderPluginManager,
} from './annotationPlugins'

interface IndexedAnnotationEntry {
  entry: AnnotationRenderEntry
  order: number
}

export interface AnnotationSpatialIndex {
  queryPoint: (point: Vec2) => AnnotationRenderEntry[]
}

function getCellKey(column: number, row: number) {
  return `${column}:${row}`
}

export function buildAnnotationSpatialIndex(options: {
  entries: AnnotationRenderEntry[]
  context: AnnotationRenderContext
  pluginManager?: AnnotationRenderPluginManager
  cellSize?: number
}): AnnotationSpatialIndex {
  const pluginManager = options.pluginManager ?? defaultAnnotationRenderPluginManager
  const cellSize = options.cellSize ?? 128
  const buckets = new Map<string, IndexedAnnotationEntry[]>()
  const overflow: IndexedAnnotationEntry[] = []

  options.entries.forEach((entry, order) => {
    const bounds = pluginManager.getScreenBounds(entry, options.context)
    const indexedEntry = { entry, order }
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
      overflow.push(indexedEntry)
      return
    }

    const minColumn = Math.floor(bounds.left / cellSize)
    const maxColumn = Math.floor((bounds.left + bounds.width) / cellSize)
    const minRow = Math.floor(bounds.top / cellSize)
    const maxRow = Math.floor((bounds.top + bounds.height) / cellSize)

    for (let column = minColumn; column <= maxColumn; column += 1) {
      for (let row = minRow; row <= maxRow; row += 1) {
        const key = getCellKey(column, row)
        const bucket = buckets.get(key)
        if (bucket) {
          bucket.push(indexedEntry)
        } else {
          buckets.set(key, [indexedEntry])
        }
      }
    }
  })

  return {
    queryPoint(point) {
      const key = getCellKey(Math.floor(point.x / cellSize), Math.floor(point.y / cellSize))
      const bucket = buckets.get(key) ?? []
      const seen = new Set<number>()
      const matches: IndexedAnnotationEntry[] = []

      for (let index = bucket.length - 1; index >= 0; index -= 1) {
        const candidate = bucket[index]
        if (seen.has(candidate.order)) {
          continue
        }
        seen.add(candidate.order)
        matches.push(candidate)
      }

      for (let index = overflow.length - 1; index >= 0; index -= 1) {
        const candidate = overflow[index]
        if (seen.has(candidate.order)) {
          continue
        }
        seen.add(candidate.order)
        matches.push(candidate)
      }

      return matches.map((candidate) => candidate.entry)
    },
  }
}