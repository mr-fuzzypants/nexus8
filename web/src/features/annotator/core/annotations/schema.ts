import type {
  AnnotationDocumentSnapshot,
  AnnotationTimeRange,
  AnnotationEntity,
  AnnotationFrame,
  AnnotationGeometry,
  AnnotationGeometryKind,
  AnnotationLayer,
  AnnotationStyle,
  Vec2,
  Vec3,
} from './types'

export const ANNOTATION_SCHEMA_VERSION = 1

export interface AnnotationColor {
  r: number
  g: number
  b: number
  a: number
}

export interface NormalizedAnnotationStyle {
  stroke: AnnotationColor
  fill: AnnotationColor
  strokeWidth: number
  opacity: number
  fontSize: number
  dashed: boolean
}

export interface NormalizedAnnotationEntity {
  schemaVersion: number
  id: string
  type: AnnotationGeometryKind
  timeRange?: AnnotationTimeRange
  layerId: string
  frame: AnnotationFrame
  geometry: AnnotationGeometry
  style: NormalizedAnnotationStyle
  drawOrder: number
  authorId: string
  authorName: string
  createdAt: number
  updatedAt: number
  version: number
}

function finiteNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function finiteInteger(value: number | undefined, fallback: number): number {
  return Math.trunc(finiteNumber(value, fallback))
}

function normalizeVec2(value: Vec2 | undefined, fallback: Vec2): Vec2 {
  return {
    x: finiteNumber(value?.x, fallback.x),
    y: finiteNumber(value?.y, fallback.y),
  }
}

function normalizeVec3(value: Vec3 | undefined, fallback: Vec3): Vec3 {
  return {
    x: finiteNumber(value?.x, fallback.x),
    y: finiteNumber(value?.y, fallback.y),
    z: finiteNumber(value?.z, fallback.z),
  }
}

function parseHexColor(input: string): AnnotationColor | null {
  const hex = input.replace('#', '').trim()
  if (![3, 4, 6, 8].includes(hex.length)) {
    return null
  }

  const expanded = hex.length <= 4
    ? hex.split('').map((part) => `${part}${part}`).join('')
    : hex
  const normalized = expanded.length === 8 ? expanded : `${expanded}ff`
  const value = Number.parseInt(normalized, 16)
  if (Number.isNaN(value)) {
    return null
  }

  return {
    r: (value >> 24) & 255,
    g: (value >> 16) & 255,
    b: (value >> 8) & 255,
    a: (value & 255) / 255,
  }
}

function parseRgbChannel(input: string) {
  const value = Number.parseFloat(input)
  return Math.min(255, Math.max(0, Number.isFinite(value) ? value : 0))
}

function parseAlphaChannel(input: string) {
  const value = Number.parseFloat(input)
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 1))
}

export function parseAnnotationColor(input: string): AnnotationColor {
  const trimmed = input.trim().toLowerCase()
  if (trimmed === 'transparent') {
    return { r: 0, g: 0, b: 0, a: 0 }
  }

  if (trimmed.startsWith('#')) {
    return parseHexColor(trimmed) ?? { r: 255, g: 255, b: 255, a: 1 }
  }

  const rgbaMatch = trimmed.match(/^rgba?\(([^)]+)\)$/)
  if (rgbaMatch) {
    const parts = rgbaMatch[1].split(',').map((part) => part.trim())
    if (parts.length === 3 || parts.length === 4) {
      return {
        r: parseRgbChannel(parts[0]),
        g: parseRgbChannel(parts[1]),
        b: parseRgbChannel(parts[2]),
        a: parts[3] ? parseAlphaChannel(parts[3]) : 1,
      }
    }
  }

  return { r: 255, g: 255, b: 255, a: 1 }
}

export function getAnnotationType(annotation: AnnotationEntity): AnnotationGeometryKind {
  return annotation.geometry.kind
}

export function getAnnotationTimeRange(annotation: AnnotationEntity): AnnotationTimeRange | undefined {
  if (annotation.timeRange) {
    const start = finiteNumber(annotation.timeRange.start, 0)
    const end = finiteNumber(annotation.timeRange.end, start)
    return {
      start: Math.min(start, end),
      end: Math.max(start, end),
    }
  }

  const binding = annotation.frame.mediaBinding
  if (!binding) {
    return undefined
  }

  const start = finiteNumber(binding.globalTime ?? binding.time, 0)
  return { start, end: start }
}

function normalizeGeometry(geometry: AnnotationGeometry): AnnotationGeometry {
  switch (geometry.kind) {
    case 'freehand':
      return {
        kind: 'freehand',
        points: geometry.points.map((point) => normalizeVec2(point, { x: 0, y: 0 })),
      }
    case 'brush':
      return {
        kind: 'brush',
        points: geometry.points.map((point) => normalizeVec2(point, { x: 0, y: 0 })),
        radius: Math.max(0.5, finiteNumber(geometry.radius, 12)),
      }
    case 'polygon':
      return {
        kind: 'polygon',
        points: geometry.points.map((point) => normalizeVec2(point, { x: 0, y: 0 })),
      }
    case 'rectangle':
    case 'ellipse':
      return {
        kind: geometry.kind,
        start: normalizeVec2(geometry.start, { x: 0, y: 0 }),
        end: normalizeVec2(geometry.end, { x: 0, y: 0 }),
      }
    case 'text':
      return {
        kind: 'text',
        position: normalizeVec2(geometry.position, { x: 0, y: 0 }),
        text: geometry.text,
      }
    case 'card':
      return {
        kind: 'card',
        start: normalizeVec2(geometry.start, { x: 0, y: 0 }),
        end: normalizeVec2(geometry.end, { x: 0, y: 0 }),
        body: geometry.body.map((entry) => `${entry}`),
      }
    case 'grid':
      return {
        kind: 'grid',
        start: normalizeVec2(geometry.start, { x: 0, y: 0 }),
        end: normalizeVec2(geometry.end, { x: 0, y: 0 }),
        title: geometry.title,
        rows: Math.max(1, finiteInteger(geometry.rows, 1)),
        columns: Math.max(1, finiteInteger(geometry.columns, 1)),
      }
    case 'list':
      return {
        kind: 'list',
        start: normalizeVec2(geometry.start, { x: 0, y: 0 }),
        end: normalizeVec2(geometry.end, { x: 0, y: 0 }),
        title: geometry.title,
        items: geometry.items.map((entry) => `${entry}`),
      }
  }
}

function normalizeFrame(frame: AnnotationFrame): AnnotationFrame {
  return {
    space: frame.space,
    origin: normalizeVec3(frame.origin, { x: 0, y: 0, z: 0 }),
    xAxis: normalizeVec3(frame.xAxis, { x: 1, y: 0, z: 0 }),
    yAxis: normalizeVec3(frame.yAxis, { x: 0, y: 1, z: 0 }),
    targetId: frame.targetId,
    cameraView: frame.cameraView
      ? {
          position: normalizeVec3(frame.cameraView.position, { x: 0, y: 0, z: 0 }),
          target: normalizeVec3(frame.cameraView.target, { x: 0, y: 0, z: 0 }),
          radius: finiteNumber(frame.cameraView.radius, 0),
          theta: finiteNumber(frame.cameraView.theta, 0),
          phi: finiteNumber(frame.cameraView.phi, 0),
        }
      : undefined,
    mediaBinding: frame.mediaBinding
      ? {
          time: finiteNumber(frame.mediaBinding.time, 0),
          frame: Math.max(0, finiteInteger(frame.mediaBinding.frame, 0)),
          clipId: frame.mediaBinding.clipId,
          clipLabel: frame.mediaBinding.clipLabel,
          globalTime: frame.mediaBinding.globalTime === undefined
            ? undefined
            : finiteNumber(frame.mediaBinding.globalTime, 0),
        }
      : undefined,
  }
}

function normalizeStyle(style: AnnotationStyle): AnnotationStyle {
  return {
    stroke: style.stroke,
    fill: style.fill,
    strokeWidth: Math.max(0, finiteNumber(style.strokeWidth, 0)),
    opacity: Math.min(1, Math.max(0, finiteNumber(style.opacity, 1))),
    fontSize: Math.max(1, finiteNumber(style.fontSize, 15)),
    dashed: Boolean(style.dashed),
  }
}

export function normalizeAnnotationEntity(
  annotation: AnnotationEntity,
  options?: { now?: number; existing?: AnnotationEntity },
): AnnotationEntity {
  const now = finiteInteger(options?.now, Date.now())
  const existing = options?.existing
  const createdAt = Math.max(0, finiteInteger(existing?.createdAt ?? annotation.createdAt, now))
  const updatedAt = Math.max(createdAt, finiteInteger(annotation.updatedAt, now))
  const drawOrder = finiteNumber(existing?.drawOrder ?? annotation.drawOrder, createdAt)

  return {
    ...annotation,
    id: annotation.id,
    layerId: annotation.layerId,
    timeRange: getAnnotationTimeRange(annotation),
    frame: normalizeFrame(annotation.frame),
    geometry: normalizeGeometry(annotation.geometry),
    style: normalizeStyle(annotation.style),
    drawOrder,
    authorId: annotation.authorId,
    authorName: annotation.authorName,
    createdAt,
    updatedAt,
    version: Math.max(0, finiteInteger(annotation.version, existing?.version ?? 0)),
  }
}

export function toNormalizedAnnotationEntity(annotation: AnnotationEntity): NormalizedAnnotationEntity {
  const normalized = normalizeAnnotationEntity(annotation)
  return {
    schemaVersion: ANNOTATION_SCHEMA_VERSION,
    id: normalized.id,
    type: getAnnotationType(normalized),
    timeRange: getAnnotationTimeRange(normalized),
    layerId: normalized.layerId,
    frame: normalized.frame,
    geometry: normalized.geometry,
    style: {
      stroke: parseAnnotationColor(normalized.style.stroke),
      fill: parseAnnotationColor(normalized.style.fill),
      strokeWidth: normalized.style.strokeWidth,
      opacity: normalized.style.opacity,
      fontSize: normalized.style.fontSize,
      dashed: Boolean(normalized.style.dashed),
    },
    drawOrder: normalized.drawOrder ?? normalized.createdAt,
    authorId: normalized.authorId,
    authorName: normalized.authorName,
    createdAt: normalized.createdAt,
    updatedAt: normalized.updatedAt,
    version: normalized.version,
  }
}

function stableAnnotationRecord(annotation: AnnotationEntity) {
  const normalized = toNormalizedAnnotationEntity(annotation)
  return {
    schemaVersion: normalized.schemaVersion,
    id: normalized.id,
    type: normalized.type,
    timeRange: normalized.timeRange,
    layerId: normalized.layerId,
    frame: normalized.frame,
    geometry: normalized.geometry,
    style: normalized.style,
    drawOrder: normalized.drawOrder,
    authorId: normalized.authorId,
    authorName: normalized.authorName,
    createdAt: normalized.createdAt,
    updatedAt: normalized.updatedAt,
    version: normalized.version,
  }
}

function stableLayerRecord(layer: AnnotationLayer) {
  return {
    id: layer.id,
    name: layer.name,
    visible: layer.visible,
    supportedSpaces: [...layer.supportedSpaces],
  }
}

export function serializeAnnotationSnapshot(snapshot: AnnotationDocumentSnapshot) {
  return JSON.stringify({
    schemaVersion: ANNOTATION_SCHEMA_VERSION,
    version: finiteInteger(snapshot.version, 0),
    layers: snapshot.layers
      .map((layer) => stableLayerRecord(layer))
      .sort((left, right) => left.id.localeCompare(right.id)),
    annotations: snapshot.annotations
      .map((annotation) => stableAnnotationRecord(annotation))
      .sort((left, right) => left.drawOrder - right.drawOrder || left.id.localeCompare(right.id)),
  })
}

export function normalizeAnnotationSnapshot(snapshot: AnnotationDocumentSnapshot): AnnotationDocumentSnapshot {
  return {
    version: Math.max(0, finiteInteger(snapshot.version, 0)),
    layers: snapshot.layers
      .map((layer) => stableLayerRecord(layer))
      .sort((left, right) => left.id.localeCompare(right.id)),
    annotations: snapshot.annotations
      .map((annotation) => normalizeAnnotationEntity(annotation))
      .sort((left, right) => (left.drawOrder ?? left.createdAt) - (right.drawOrder ?? right.createdAt) || left.id.localeCompare(right.id)),
  }
}