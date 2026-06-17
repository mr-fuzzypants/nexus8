import type { AnnotationFrame, Vec2, Vec3 } from '../annotations/types'
import type {
  ViewportSize,
  ViewerAction,
  ViewerAdapter,
} from './adapters'

interface TileLevel {
  downsample: number
  canvas: HTMLCanvasElement
  width: number
  height: number
  columns: number
  rows: number
}

interface ViewState {
  scale: number
  offsetX: number
  offsetY: number
  initialized: boolean
}

export interface TiledImageViewerOptions {
  /** URL of the source image. Loaded at native resolution so annotation frame-local
   *  coordinates map 1:1 to source pixels (required for faithful mask rasterization). */
  imageUrl: string
  /** Sheet id annotations are bound to (frame.targetId). Defaults to 'stage-2-sheet'. */
  targetId?: string
  /** Optional pre-decode dimensions (e.g. from technical_metadata) so the viewer can
   *  fit and lay out before the image finishes loading. Replaced by the real size on load. */
  width?: number
  height?: number
}

// Fallbacks used only until the real image dimensions are known.
const DEFAULT_DOC_WIDTH = 4096
const DEFAULT_DOC_HEIGHT = 3072
const TILE_SIZE = 256
const PADDING = 32
const MIN_SCALE = 0.02
const MAX_SCALE = 8

function createEmitter() {
  const listeners = new Set<() => void>()
  return {
    emit() {
      listeners.forEach((listener) => listener())
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function createCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.floor(width))
  canvas.height = Math.max(1, Math.floor(height))
  return canvas
}

function roundRect(
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

/** Paint a subtle placeholder so the viewport has tiles to draw before the image decodes. */
function createPlaceholderBase(width: number, height: number) {
  const canvas = createCanvas(width, height)
  const context = canvas.getContext('2d')
  if (context) {
    const gradient = context.createLinearGradient(0, 0, width, height)
    gradient.addColorStop(0, '#0b1626')
    gradient.addColorStop(1, '#111c30')
    context.fillStyle = gradient
    context.fillRect(0, 0, width, height)
  }
  return canvas
}

/** Build a power-of-two mip pyramid from a base canvas (identical math to the demo). */
function buildTileLevelsFromBase(base: HTMLCanvasElement): TileLevel[] {
  const levels: TileLevel[] = []
  let currentCanvas = base
  let downsample = 1

  while (true) {
    levels.push({
      downsample,
      canvas: currentCanvas,
      width: currentCanvas.width,
      height: currentCanvas.height,
      columns: Math.ceil(currentCanvas.width / TILE_SIZE),
      rows: Math.ceil(currentCanvas.height / TILE_SIZE),
    })

    if (currentCanvas.width <= 768 || currentCanvas.height <= 768) {
      break
    }

    const nextCanvas = createCanvas(
      Math.max(1, Math.floor(currentCanvas.width / 2)),
      Math.max(1, Math.floor(currentCanvas.height / 2)),
    )
    const nextContext = nextCanvas.getContext('2d')
    if (!nextContext) {
      break
    }
    nextContext.imageSmoothingQuality = 'high'
    nextContext.drawImage(currentCanvas, 0, 0, nextCanvas.width, nextCanvas.height)
    currentCanvas = nextCanvas
    downsample *= 2
  }

  return levels
}

function frameToWorld(frame: AnnotationFrame, localPoint: Vec2): Vec3 {
  return {
    x: frame.origin.x + frame.xAxis.x * localPoint.x + frame.yAxis.x * localPoint.y,
    y: frame.origin.y + frame.xAxis.y * localPoint.x + frame.yAxis.y * localPoint.y,
    z: frame.origin.z + frame.xAxis.z * localPoint.x + frame.yAxis.z * localPoint.y,
  }
}

function worldToFrame(frame: AnnotationFrame, worldPoint: Vec3): Vec2 {
  const dx = worldPoint.x - frame.origin.x
  const dy = worldPoint.y - frame.origin.y
  const dz = worldPoint.z - frame.origin.z
  return {
    x: dx * frame.xAxis.x + dy * frame.xAxis.y + dz * frame.xAxis.z,
    y: dx * frame.yAxis.x + dy * frame.yAxis.y + dz * frame.yAxis.z,
  }
}

export function createTiledImageViewerAdapter(options: TiledImageViewerOptions): ViewerAdapter {
  const targetId = options.targetId ?? 'stage-2-sheet'
  let docWidth = options.width && options.width > 0 ? options.width : DEFAULT_DOC_WIDTH
  let docHeight = options.height && options.height > 0 ? options.height : DEFAULT_DOC_HEIGHT
  let levels = buildTileLevelsFromBase(createPlaceholderBase(docWidth, docHeight))
  let imageReady = false
  let lastViewport: ViewportSize | null = null

  const emitter = createEmitter()
  const view: ViewState = {
    scale: 0.25,
    offsetX: 0,
    offsetY: 0,
    initialized: false,
  }

  function fitToViewport(viewport: ViewportSize) {
    if (viewport.width <= 0 || viewport.height <= 0) {
      return
    }
    view.scale = Math.min(
      (viewport.width - PADDING * 2) / docWidth,
      (viewport.height - PADDING * 2) / docHeight,
    )
    view.offsetX = (viewport.width - docWidth * view.scale) / 2
    view.offsetY = (viewport.height - docHeight * view.scale) / 2
    view.initialized = true
    emitter.emit()
  }

  function ensureInitialized(viewport: ViewportSize) {
    lastViewport = viewport
    if (!view.initialized && viewport.width > 0 && viewport.height > 0) {
      fitToViewport(viewport)
    }
  }

  // Load the real image and rebuild the pyramid at native resolution.
  const image = new Image()
  image.crossOrigin = 'anonymous'
  image.onload = () => {
    const naturalWidth = image.naturalWidth || docWidth
    const naturalHeight = image.naturalHeight || docHeight
    const base = createCanvas(naturalWidth, naturalHeight)
    const context = base.getContext('2d')
    if (context) {
      context.imageSmoothingQuality = 'high'
      context.drawImage(image, 0, 0, naturalWidth, naturalHeight)
    }
    docWidth = naturalWidth
    docHeight = naturalHeight
    levels = buildTileLevelsFromBase(base)
    imageReady = true
    // Re-fit now that the true dimensions are known.
    view.initialized = false
    if (lastViewport) {
      fitToViewport(lastViewport)
    } else {
      emitter.emit()
    }
  }
  image.onerror = () => {
    emitter.emit()
  }
  image.src = options.imageUrl

  function rawWorldToScreen(worldPoint: Vec3, viewport: ViewportSize) {
    ensureInitialized(viewport)
    return {
      x: view.offsetX + worldPoint.x * view.scale,
      y: view.offsetY + worldPoint.y * view.scale,
    }
  }

  function rawScreenToWorld(screenPoint: Vec2, viewport: ViewportSize): Vec3 {
    ensureInitialized(viewport)
    return {
      x: (screenPoint.x - view.offsetX) / view.scale,
      y: (screenPoint.y - view.offsetY) / view.scale,
      z: 0,
    }
  }

  function clampOffsets(viewport: ViewportSize) {
    const scaledWidth = docWidth * view.scale
    const scaledHeight = docHeight * view.scale
    const minOffsetX = Math.min(PADDING, viewport.width - scaledWidth - PADDING)
    const maxOffsetX = Math.max(PADDING, viewport.width - scaledWidth - PADDING)
    const minOffsetY = Math.min(PADDING, viewport.height - scaledHeight - PADDING)
    const maxOffsetY = Math.max(PADDING, viewport.height - scaledHeight - PADDING)
    view.offsetX = clamp(view.offsetX, minOffsetX, maxOffsetX)
    view.offsetY = clamp(view.offsetY, minOffsetY, maxOffsetY)
  }

  function zoomAt(screenPoint: Vec2, factor: number, viewport: ViewportSize) {
    ensureInitialized(viewport)
    const before = rawScreenToWorld(screenPoint, viewport)
    view.scale = clamp(view.scale * factor, MIN_SCALE, MAX_SCALE)
    view.offsetX = screenPoint.x - before.x * view.scale
    view.offsetY = screenPoint.y - before.y * view.scale
    clampOffsets(viewport)
    emitter.emit()
  }

  function panBy(delta: Vec2, viewport: ViewportSize) {
    ensureInitialized(viewport)
    view.offsetX += delta.x
    view.offsetY += delta.y
    clampOffsets(viewport)
    emitter.emit()
  }

  function getVisibleLevel() {
    const targetDownsample = Math.max(1, 1 / view.scale)
    return levels.reduce((best, current) => {
      const bestDistance = Math.abs(Math.log2(best.downsample) - Math.log2(targetDownsample))
      const currentDistance = Math.abs(Math.log2(current.downsample) - Math.log2(targetDownsample))
      return currentDistance < bestDistance ? current : best
    }, levels[0])
  }

  const actions: ViewerAction[] = [
    { id: 'zoom-in', label: 'Zoom in', onSelect: (viewport) => zoomAt({ x: viewport.width / 2, y: viewport.height / 2 }, 1.2, viewport) },
    { id: 'zoom-out', label: 'Zoom out', onSelect: (viewport) => zoomAt({ x: viewport.width / 2, y: viewport.height / 2 }, 1 / 1.2, viewport) },
    { id: 'fit', label: 'Fit', onSelect: (viewport) => fitToViewport(viewport) },
  ]

  return {
    id: 'image-viewer',
    name: '2D tiled image viewer',
    description: 'Pan and zoom a large image-space document while reusing the shared annotation layer.',
    space: 'image2d',
    targetId,
    createFrame(origin) {
      return {
        space: 'image2d',
        origin,
        xAxis: { x: 1, y: 0, z: 0 },
        yAxis: { x: 0, y: 1, z: 0 },
        targetId,
      }
    },
    worldToScreen(worldPoint, viewport) {
      return rawWorldToScreen(worldPoint, viewport)
    },
    screenToWorld(screenPoint, viewport) {
      const world = rawScreenToWorld(screenPoint, viewport)
      if (world.x < 0 || world.x > docWidth || world.y < 0 || world.y > docHeight) {
        return null
      }
      return world
    },
    project(frame, localPoint, viewport) {
      return rawWorldToScreen(frameToWorld(frame, localPoint), viewport)
    },
    screenToFrameLocal(screenPoint, frame, viewport) {
      const worldPoint = rawScreenToWorld(screenPoint, viewport)
      if (worldPoint.x < 0 || worldPoint.x > docWidth || worldPoint.y < 0 || worldPoint.y > docHeight) {
        return null
      }
      return worldToFrame(frame, worldPoint)
    },
    getProjectionRevision() {
      // Image-space projection changes whenever zoom or pan changes (or the image loads).
      return `${view.scale}|${view.offsetX}|${view.offsetY}|${imageReady ? 1 : 0}`
    },
    renderBackdrop(context, viewport) {
      ensureInitialized(viewport)
      context.clearRect(0, 0, viewport.width, viewport.height)
      const background = context.createLinearGradient(0, 0, viewport.width, viewport.height)
      background.addColorStop(0, '#061120')
      background.addColorStop(1, '#0f172a')
      context.fillStyle = background
      context.fillRect(0, 0, viewport.width, viewport.height)

      const worldTopLeft = rawScreenToWorld({ x: 0, y: 0 }, viewport)
      const worldBottomRight = rawScreenToWorld({ x: viewport.width, y: viewport.height }, viewport)
      const level = getVisibleLevel()
      const worldTileSize = TILE_SIZE * level.downsample
      const startColumn = clamp(Math.floor(worldTopLeft.x / worldTileSize), 0, level.columns - 1)
      const endColumn = clamp(Math.floor(worldBottomRight.x / worldTileSize), 0, level.columns - 1)
      const startRow = clamp(Math.floor(worldTopLeft.y / worldTileSize), 0, level.rows - 1)
      const endRow = clamp(Math.floor(worldBottomRight.y / worldTileSize), 0, level.rows - 1)

      context.save()
      context.shadowColor = 'rgba(15, 23, 42, 0.35)'
      context.shadowBlur = 40
      context.fillStyle = imageReady ? '#05070d' : '#0b1626'
      context.fillRect(view.offsetX, view.offsetY, docWidth * view.scale, docHeight * view.scale)
      context.restore()

      context.save()
      context.beginPath()
      context.rect(view.offsetX, view.offsetY, docWidth * view.scale, docHeight * view.scale)
      context.clip()
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'

      for (let row = startRow; row <= endRow; row += 1) {
        for (let column = startColumn; column <= endColumn; column += 1) {
          const sourceX = column * TILE_SIZE
          const sourceY = row * TILE_SIZE
          const sourceWidth = Math.min(TILE_SIZE, level.width - sourceX)
          const sourceHeight = Math.min(TILE_SIZE, level.height - sourceY)
          const worldX = column * worldTileSize
          const worldY = row * worldTileSize
          const worldWidth = sourceWidth * level.downsample
          const worldHeight = sourceHeight * level.downsample
          const topLeft = rawWorldToScreen({ x: worldX, y: worldY, z: 0 }, viewport)
          const bottomRight = rawWorldToScreen(
            { x: worldX + worldWidth, y: worldY + worldHeight, z: 0 },
            viewport,
          )
          context.drawImage(
            level.canvas,
            sourceX,
            sourceY,
            sourceWidth,
            sourceHeight,
            topLeft.x,
            topLeft.y,
            bottomRight.x - topLeft.x,
            bottomRight.y - topLeft.y,
          )
        }
      }
      context.restore()

      context.strokeStyle = 'rgba(148, 163, 184, 0.35)'
      context.lineWidth = 1.5
      context.strokeRect(view.offsetX, view.offsetY, docWidth * view.scale, docHeight * view.scale)

      if (!imageReady) {
        context.fillStyle = 'rgba(226, 232, 240, 0.72)'
        context.font = '500 15px Inter, system-ui, sans-serif'
        context.textAlign = 'center'
        context.fillText('Loading image…', viewport.width / 2, viewport.height / 2)
        context.textAlign = 'start'
      }

      const minimapWidth = 180
      const minimapHeight = (docHeight / docWidth) * minimapWidth
      const minimapX = viewport.width - minimapWidth - 18
      const minimapY = 18
      context.fillStyle = 'rgba(2, 6, 23, 0.78)'
      roundRect(context, minimapX - 10, minimapY - 10, minimapWidth + 20, minimapHeight + 20, 16)
      context.fill()
      context.drawImage(levels[levels.length - 1].canvas, minimapX, minimapY, minimapWidth, minimapHeight)
      context.strokeStyle = 'rgba(255, 255, 255, 0.14)'
      context.strokeRect(minimapX, minimapY, minimapWidth, minimapHeight)

      const visibleMinimapX = minimapX + (Math.max(worldTopLeft.x, 0) / docWidth) * minimapWidth
      const visibleMinimapY = minimapY + (Math.max(worldTopLeft.y, 0) / docHeight) * minimapHeight
      const visibleMinimapWidth = ((Math.min(worldBottomRight.x, docWidth) - Math.max(worldTopLeft.x, 0)) / docWidth) * minimapWidth
      const visibleMinimapHeight = ((Math.min(worldBottomRight.y, docHeight) - Math.max(worldTopLeft.y, 0)) / docHeight) * minimapHeight
      context.strokeStyle = '#5eead4'
      context.lineWidth = 2
      context.strokeRect(visibleMinimapX, visibleMinimapY, visibleMinimapWidth, visibleMinimapHeight)
    },
    formatAnchor(frame) {
      return `image(${frame.origin.x.toFixed(1)}, ${frame.origin.y.toFixed(1)})`
    },
    subscribe(listener) {
      return emitter.subscribe(listener)
    },
    getStatusBadges() {
      const level = getVisibleLevel()
      return [
        `Zoom ${Math.round(view.scale * 100)}%`,
        `Tiles ${level.columns}×${level.rows}`,
        `Level 1:${level.downsample}`,
      ]
    },
    getActions() {
      return actions
    },
    handleWheel(screenPoint, deltaY, viewport) {
      const factor = Math.exp(-deltaY * 0.0012)
      zoomAt(screenPoint, factor, viewport)
      return true
    },
    beginNavigation(_screenPoint, options) {
      return options.button === 1 || options.button === 2 || options.altKey || options.metaKey
    },
    beginViewNavigation() {
      // View-only: any drag pans the image.
      return true
    },
    updateNavigation(_screenPoint, delta, viewport) {
      panBy(delta, viewport)
    },
    endNavigation() {},
  }
}
