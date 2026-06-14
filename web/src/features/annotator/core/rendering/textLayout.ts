import type { Vec2 } from '../annotations/types'
import type {
  RenderLabelPrimitive,
  RenderTextBlockPrimitive,
  RenderTextStyle,
} from './primitives'

interface MeasuredTextMetrics {
  width: number
  ascent: number
  descent: number
}

interface LabelMeasurement {
  textWidth: number
  width: number
  height: number
  baselineOffset: number
}

const TEXT_METRIC_CACHE_LIMIT = 2048
const WRAPPED_TEXT_CACHE_LIMIT = 512
const LABEL_MEASUREMENT_CACHE_LIMIT = 512

const textMetricCache = new Map<string, MeasuredTextMetrics>()
const wrappedTextCache = new Map<string, string[]>()
const labelMeasurementCache = new Map<string, LabelMeasurement>()

let measurementContext: CanvasRenderingContext2D | null | undefined

function rememberCachedValue<T>(cache: Map<string, T>, key: string, value: T, limit: number) {
  cache.set(key, value)
  if (cache.size <= limit) {
    return value
  }

  const firstKey = cache.keys().next().value
  if (firstKey) {
    cache.delete(firstKey)
  }
  return value
}

function getMeasurementContext() {
  if (measurementContext !== undefined) {
    return measurementContext
  }

  if (typeof document === 'undefined') {
    measurementContext = null
    return measurementContext
  }

  measurementContext = document.createElement('canvas').getContext('2d')
  return measurementContext
}

export function createCanvasFont(style: RenderTextStyle) {
  return `${style.fontWeight ?? 500} ${style.fontSize}px ${style.fontFamily ?? 'Inter, system-ui, sans-serif'}`
}

export function measureTextMetrics(text: string, style: RenderTextStyle): MeasuredTextMetrics {
  const cacheKey = `${createCanvasFont(style)}|${text}`
  const cached = textMetricCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const context = getMeasurementContext()
  if (!context) {
    return rememberCachedValue(
      textMetricCache,
      cacheKey,
      {
        width: text.length * style.fontSize * 0.56,
        ascent: style.fontSize * 0.8,
        descent: style.fontSize * 0.24,
      },
      TEXT_METRIC_CACHE_LIMIT,
    )
  }

  context.font = createCanvasFont(style)
  const metrics = context.measureText(text)
  return rememberCachedValue(
    textMetricCache,
    cacheKey,
    {
      width: metrics.width,
      ascent: metrics.actualBoundingBoxAscent || style.fontSize * 0.8,
      descent: metrics.actualBoundingBoxDescent || style.fontSize * 0.24,
    },
    TEXT_METRIC_CACHE_LIMIT,
  )
}

function wrapLine(line: string, maxWidth: number, style: RenderTextStyle) {
  const words = line.split(/\s+/).filter(Boolean)
  if (words.length === 0) {
    return ['']
  }

  const rows: string[] = []
  let currentLine = words[0]
  for (let index = 1; index < words.length; index += 1) {
    const nextLine = `${currentLine} ${words[index]}`
    if (measureTextMetrics(nextLine, style).width <= maxWidth) {
      currentLine = nextLine
      continue
    }

    rows.push(currentLine)
    currentLine = words[index]
  }
  rows.push(currentLine)
  return rows
}

export function getWrappedTextBlockRows(primitive: RenderTextBlockPrimitive) {
  const cacheKey = JSON.stringify({
    lines: primitive.lines,
    maxWidth: primitive.maxWidth,
    maxLines: primitive.maxLines,
    font: createCanvasFont(primitive.style),
  })
  const cached = wrappedTextCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const rows: string[] = []
  primitive.lines.forEach((line) => {
    if (rows.length >= primitive.maxLines) {
      return
    }

    wrapLine(line, primitive.maxWidth, primitive.style).forEach((wrappedLine) => {
      if (rows.length < primitive.maxLines) {
        rows.push(wrappedLine)
      }
    })
  })

  return rememberCachedValue(wrappedTextCache, cacheKey, rows, WRAPPED_TEXT_CACHE_LIMIT)
}

export function getLabelMeasurement(primitive: Pick<RenderLabelPrimitive, 'text' | 'paddingX' | 'paddingY' | 'style'>) {
  const cacheKey = JSON.stringify({
    text: primitive.text,
    paddingX: primitive.paddingX,
    paddingY: primitive.paddingY,
    font: createCanvasFont(primitive.style),
  })
  const cached = labelMeasurementCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const metrics = measureTextMetrics(primitive.text, primitive.style)
  return rememberCachedValue(
    labelMeasurementCache,
    cacheKey,
    {
      textWidth: metrics.width,
      width: metrics.width + primitive.paddingX * 2,
      height: metrics.ascent + metrics.descent + primitive.paddingY * 2,
      baselineOffset: primitive.paddingY + metrics.ascent,
    },
    LABEL_MEASUREMENT_CACHE_LIMIT,
  )
}

export function getLabelBounds(options: {
  text: string
  position: Vec2
  paddingX: number
  paddingY: number
  style: RenderTextStyle
}) {
  const measurement = getLabelMeasurement(options)
  return {
    left: options.position.x,
    top: options.position.y,
    width: measurement.width,
    height: measurement.height,
  }
}

export function getTextBounds(text: string, position: Vec2, style: RenderTextStyle) {
  const metrics = measureTextMetrics(text, style)
  return {
    left: position.x,
    top: position.y - metrics.ascent,
    width: metrics.width,
    height: metrics.ascent + metrics.descent,
  }
}