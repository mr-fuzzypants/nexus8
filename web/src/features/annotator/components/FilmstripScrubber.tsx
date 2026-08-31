import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  frameToMidTime,
  timeToFrame,
  type VideoMediaState,
  type VideoSpriteManifest,
  type VideoViewerAdapter,
} from '../core/viewers/videoAdapter'

export interface FrameSpan {
  start: number
  end: number
}

const STRIP_HEIGHT = 48
// Regenerate thumbnails only when the bar crosses a width bucket, so live layout
// resizes stretch the existing canvas instead of re-decoding the whole strip.
const WIDTH_QUANTUM = 64
const SEEK_TIMEOUT_MS = 4000
const MIN_THUMB_WIDTH = 28
const MAX_THUMB_WIDTH = 120
// Cap the extracted-frame bitmap cache so deep scrubbing can't leak GPU memory.
const MAX_FRAME_CACHE = 600
// Trail span edits (handle drags, rapid typing) before re-extracting thumbnails.
const WINDOW_DEBOUNCE_MS = 250

type DragMode = 'scrub' | 'start' | 'end'

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

interface SourceRect {
  sx: number
  sy: number
  sw: number
  sh: number
}

// The tile in a sprite sheet covering `localTime` seconds into the clip.
function spriteTileRect(sprite: VideoSpriteManifest, localTime: number): SourceRect {
  const index = clamp(Math.floor(localTime / sprite.interval), 0, sprite.count - 1)
  const col = index % sprite.columns
  const row = Math.floor(index / sprite.columns)
  return {
    sx: col * sprite.tile_width,
    sy: row * sprite.tile_height,
    sw: sprite.tile_width,
    sh: sprite.tile_height,
  }
}

// Cover-fit a source region into a destination slot without distortion.
function drawCover(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  region: SourceRect,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
) {
  if (region.sw <= 0 || region.sh <= 0) {
    return
  }
  const scale = Math.max(dw / region.sw, dh / region.sh)
  const cropW = dw / scale
  const cropH = dh / scale
  ctx.drawImage(
    source,
    region.sx + (region.sw - cropW) / 2,
    region.sy + (region.sh - cropH) / 2,
    cropW,
    cropH,
    dx,
    dy,
    dw,
    dh,
  )
}

// Decode an image URL (e.g. a sprite sheet) to a GPU-friendly bitmap.
async function loadImageBitmap(url: string): Promise<ImageBitmap> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`sprite fetch failed: ${response.status}`)
  }
  return createImageBitmap(await response.blob())
}

// Insert a frame bitmap, evicting the oldest (and freeing its GPU memory) once
// the cache is full. Map iteration order is insertion order, so the first key
// is the oldest.
function rememberFrame(cache: Map<string, ImageBitmap>, key: string, bitmap: ImageBitmap) {
  cache.set(key, bitmap)
  while (cache.size > MAX_FRAME_CACHE) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) {
      break
    }
    cache.get(oldest)?.close()
    cache.delete(oldest)
  }
}

// Wait until a seek is actually presented before capturing. `seeked` alone can
// hand back the previous frame on some decoders, so prefer requestVideoFrameCallback.
function waitForPresentedFrame(video: HTMLVideoElement): Promise<boolean> {
  const hasRvfc = 'requestVideoFrameCallback' in video
  return new Promise<boolean>((resolve) => {
    let settled = false
    const settle = (ok: boolean) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('error', onError)
      resolve(ok)
    }
    const onSeeked = () => {
      if (hasRvfc) {
        ;(video as HTMLVideoElement & {
          requestVideoFrameCallback: (cb: () => void) => number
        }).requestVideoFrameCallback(() => settle(true))
      } else {
        settle(true)
      }
    }
    const onError = () => settle(false)
    const timer = setTimeout(() => settle(false), SEEK_TIMEOUT_MS)
    video.addEventListener('seeked', onSeeked, { once: true })
    video.addEventListener('error', onError, { once: true })
  })
}

// Resolves false on error or timeout instead of rejecting, so one bad clip
// leaves its slots dark and the rest of the strip still fills in.
function waitForVideo(video: HTMLVideoElement, eventName: string) {
  return new Promise<boolean>((resolve) => {
    const settle = (ok: boolean) => {
      clearTimeout(timer)
      video.removeEventListener(eventName, onEvent)
      video.removeEventListener('error', onError)
      resolve(ok)
    }
    const onEvent = () => settle(true)
    const onError = () => settle(false)
    const timer = setTimeout(() => settle(false), SEEK_TIMEOUT_MS)
    video.addEventListener(eventName, onEvent, { once: true })
    video.addEventListener('error', onError, { once: true })
  })
}

/**
 * SAM2-demo-style filmstrip timeline: the scrub track is a strip of frame
 * thumbnails sampled evenly across the playlist, with a draggable playhead.
 * Thumbnails are extracted client-side by seeking a hidden video element and
 * drawing onto a canvas, filling in progressively left to right.
 *
 * When `onSpanChange` is provided the strip also shows draggable start/end trim
 * handles for a frame span of interest; frames outside the span are dimmed.
 * With no span set the handles dock at the strip's ends — dragging one inward
 * creates the span. Dragging a handle live-previews the frame under it, like a
 * video-editor trim.
 *
 * `viewWindow` zooms the whole strip into a frame range: thumbnails are
 * re-sampled across just that range (one thumbnail per frame once the range is
 * narrow enough) and scrubbing maps to it.
 */
export function FilmstripScrubber({
  adapter,
  media,
  span,
  onSpanChange,
  viewWindow,
}: {
  adapter: VideoViewerAdapter
  media: VideoMediaState
  span?: FrameSpan | null
  onSpanChange?: (span: FrameSpan | null) => void
  viewWindow?: FrameSpan | null
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const dragModeRef = useRef<DragMode | null>(null)
  // Window frozen at drag start: a handle drag mutates the span, and in zoomed
  // mode the span is the window — remapping mid-drag would shift the timeline
  // under the pointer.
  const dragWindowRef = useRef<FrameSpan | null>(null)
  // Decoded sprite sheets keyed by URL, and extracted video frames keyed by
  // `${src}#${frameIndex}`. Both persist across effect re-runs so zoom/resize
  // changes redraw from cache instead of re-decoding or re-seeking.
  const spriteCacheRef = useRef<Map<string, ImageBitmap>>(new Map())
  const frameCacheRef = useRef<Map<string, ImageBitmap>>(new Map())
  const [stripWidth, setStripWidth] = useState(0)

  // Free every decoded bitmap when the strip unmounts.
  useEffect(() => {
    const sprites = spriteCacheRef.current
    const frames = frameCacheRef.current
    return () => {
      sprites.forEach((bitmap) => bitmap.close())
      sprites.clear()
      frames.forEach((bitmap) => bitmap.close())
      frames.clear()
    }
  }, [])

  useEffect(() => {
    const element = containerRef.current
    if (!element) {
      return
    }
    const observer = new ResizeObserver((entries) => {
      setStripWidth(Math.round(entries[0]?.contentRect.width ?? 0))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const totalDuration = media.playlistDuration || media.duration || 0
  const fps = Math.max(media.frameRate, 1)
  const lastFrame = Math.max(0, Math.round(totalDuration * fps) - 1)

  // The frame range the strip currently displays (full timeline when not zoomed).
  const displayWindow: FrameSpan = viewWindow
    ? { start: clamp(viewWindow.start, 0, lastFrame), end: clamp(viewWindow.end, viewWindow.start, lastFrame) }
    : { start: 0, end: lastFrame }
  const windowStartTime = displayWindow.start / fps
  const windowDuration = Math.max((displayWindow.end - displayWindow.start + 1) / fps, 1 / fps)

  const bucketWidth = stripWidth > 0 ? Math.ceil(stripWidth / WIDTH_QUANTUM) * WIDTH_QUANTUM : 0
  // Durations start at 0 and settle once clip metadata is probed; keying on them
  // (not the playlist array identity, which changes every snapshot) regenerates
  // exactly when the timeline geometry actually changes.
  const playlistKey = media.playlist
    .map((clip) => `${clip.id}@${clip.duration.toFixed(3)}`)
    .join('|')

  const windowKey = viewWindow ? `${displayWindow.start}-${displayWindow.end}` : 'full'
  const [debouncedWindowKey, setDebouncedWindowKey] = useState(windowKey)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedWindowKey(windowKey), WINDOW_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [windowKey])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || bucketWidth <= 0 || !media.ready) {
      return
    }

    let cancelled = false
    const extractor = document.createElement('video')
    extractor.muted = true
    extractor.playsInline = true
    extractor.preload = 'auto'
    extractor.crossOrigin = 'anonymous'

    const disposeExtractor = () => {
      extractor.pause()
      extractor.removeAttribute('src')
      extractor.load()
    }

    const run = async () => {
      const state = adapter.getMediaState()
      const clips = state.playlist.filter((clip) => clip.duration > 0 && !clip.error)
      const stateDuration = state.playlistDuration || state.duration
      if (clips.length === 0 || stateDuration <= 0) {
        return
      }
      const stateFps = Math.max(state.frameRate, 1)
      const stateLastFrame = Math.max(0, Math.round(stateDuration * stateFps) - 1)

      let rangeStart = 0
      let rangeEnd = stateLastFrame
      if (debouncedWindowKey !== 'full') {
        const [parsedStart, parsedEnd] = debouncedWindowKey.split('-').map(Number)
        if (Number.isFinite(parsedStart) && Number.isFinite(parsedEnd)) {
          rangeStart = clamp(parsedStart, 0, stateLastFrame)
          rangeEnd = clamp(parsedEnd, rangeStart, stateLastFrame)
        }
      }
      const rangeStartTime = rangeStart / stateFps
      const rangeDuration = Math.max((rangeEnd - rangeStart + 1) / stateFps, 1 / stateFps)
      const rangeFrameCount = rangeEnd - rangeStart + 1

      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.round(bucketWidth * dpr)
      canvas.height = Math.round(STRIP_HEIGHT * dpr)
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        return
      }
      ctx.fillStyle = 'rgba(15, 23, 42, 0.95)'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      const aspect = clips[0].width > 0 && clips[0].height > 0 ? clips[0].width / clips[0].height : 16 / 9
      const idealThumbWidth = clamp(STRIP_HEIGHT * aspect, MIN_THUMB_WIDTH, MAX_THUMB_WIDTH)
      // Never more slots than frames in the window: a tightly zoomed span shows
      // exactly one thumbnail per frame.
      const slotCount = Math.max(1, Math.min(Math.round(bucketWidth / idealThumbWidth), rangeFrameCount))
      const slotWidth = (bucketWidth / slotCount) * dpr
      const slotHeight = STRIP_HEIGHT * dpr
      const slotX = (slot: number) => slot * slotWidth

      // Map each slot to the clip + local time it samples.
      const slots = Array.from({ length: slotCount }, (_, slot) => {
        const globalTime = clamp(
          rangeStartTime + ((slot + 0.5) / slotCount) * rangeDuration,
          0,
          stateDuration,
        )
        const clip = clips.find((candidate) => globalTime < candidate.endTime) ?? clips[clips.length - 1]
        // Keep a safety margin from the clip end: seeking at/past duration can
        // hang some decoders instead of firing `seeked`.
        const localTime = clamp(globalTime - clip.startTime, 0, Math.max(clip.duration - 0.05, 0))
        return { slot, clip, globalTime, localTime }
      })

      // Pass 1 — sprite tiles paint instantly (one decoded image, no seeking).
      // Slots whose clip has no sprite fall through to client-side extraction.
      const spritesToLoad = new Set<string>()
      const videoSlots: typeof slots = []
      const paintSprite = (item: (typeof slots)[number]) => {
        const sprite = item.clip.sprite
        if (!sprite?.url) {
          videoSlots.push(item)
          return
        }
        const bitmap = spriteCacheRef.current.get(sprite.url)
        if (bitmap) {
          drawCover(ctx, bitmap, spriteTileRect(sprite, item.localTime), slotX(item.slot), 0, slotWidth, slotHeight)
        } else {
          spritesToLoad.add(sprite.url)
        }
      }
      slots.forEach(paintSprite)

      if (spritesToLoad.size > 0) {
        await Promise.all(
          [...spritesToLoad].map(async (url) => {
            if (spriteCacheRef.current.has(url)) {
              return
            }
            try {
              spriteCacheRef.current.set(url, await loadImageBitmap(url))
            } catch {
              // Sheet unreachable: its slots simply stay dark.
            }
          }),
        )
        if (cancelled) {
          return
        }
        for (const item of slots) {
          const sprite = item.clip.sprite
          const bitmap = sprite?.url ? spriteCacheRef.current.get(sprite.url) : undefined
          if (bitmap) {
            drawCover(ctx, bitmap, spriteTileRect(sprite!, item.localTime), slotX(item.slot), 0, slotWidth, slotHeight)
          }
        }
      }

      if (videoSlots.length === 0) {
        return
      }

      // Pass 2 — client-side extraction for spriteless clips (and deep zoom).
      // Paint cached frames first, then seek the rest center-out from the
      // playhead so the visible neighbourhood fills before the edges.
      const frameKey = (item: (typeof slots)[number]) =>
        `${item.clip.src}#${timeToFrame(item.localTime, stateFps)}`
      const playhead = state.playlistCurrentTime
      const pending: Array<(typeof slots)[number] & { key: string }> = []
      for (const item of videoSlots) {
        const key = frameKey(item)
        const cached = frameCacheRef.current.get(key)
        if (cached) {
          drawCover(ctx, cached, { sx: 0, sy: 0, sw: cached.width, sh: cached.height }, slotX(item.slot), 0, slotWidth, slotHeight)
        } else {
          pending.push({ ...item, key })
        }
      }
      pending.sort((a, b) => Math.abs(a.globalTime - playhead) - Math.abs(b.globalTime - playhead))

      const failedSources = new Set<string>()
      // video.src reflects the resolved absolute URL, so it can't be compared
      // against clip.src (possibly relative) to detect source changes.
      let loadedSrc: string | null = null

      for (const item of pending) {
        if (cancelled) {
          return
        }
        if (failedSources.has(item.clip.src)) {
          continue
        }
        if (loadedSrc !== item.clip.src) {
          extractor.src = item.clip.src
          extractor.load()
          if (!(await waitForVideo(extractor, 'loadedmetadata'))) {
            failedSources.add(item.clip.src)
            loadedSrc = null
            continue
          }
          loadedSrc = item.clip.src
        }
        if (cancelled) {
          return
        }

        extractor.currentTime = item.localTime
        if (!(await waitForPresentedFrame(extractor)) || cancelled) {
          if (cancelled) {
            return
          }
          continue
        }
        if (extractor.videoWidth <= 0 || extractor.videoHeight <= 0) {
          continue
        }

        let bitmap: ImageBitmap
        try {
          bitmap = await createImageBitmap(extractor)
        } catch {
          continue
        }
        if (cancelled) {
          bitmap.close()
          return
        }
        rememberFrame(frameCacheRef.current, item.key, bitmap)
        drawCover(ctx, bitmap, { sx: 0, sy: 0, sw: bitmap.width, sh: bitmap.height }, slotX(item.slot), 0, slotWidth, slotHeight)
      }
    }

    void run().finally(disposeExtractor)
    return () => {
      cancelled = true
    }
  }, [adapter, playlistKey, bucketWidth, media.ready, debouncedWindowKey])

  const spanEnabled = Boolean(onSpanChange) && totalDuration > 0
  const spanActive = spanEnabled && span != null && span.end >= span.start
  // Docked at the extremes when no span is set; dragging a handle inward creates one.
  const handleFrames: FrameSpan = spanActive ? span! : { start: 0, end: lastFrame }

  const frameCenterProgress = (frame: number) =>
    totalDuration > 0 ? clamp(frameToMidTime(frame, fps) / totalDuration, 0, 1) : 0
  // Position of an absolute timeline time within the displayed window.
  const windowPosition = (time: number) => clamp((time - windowStartTime) / windowDuration, 0, 1)

  const fractionFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width <= 0) {
      return 0
    }
    return clamp((event.clientX - rect.left) / rect.width, 0, 1)
  }
  const globalProgressFor = (fraction: number, win: FrameSpan) => {
    const winStart = win.start / fps
    const winDuration = Math.max((win.end - win.start + 1) / fps, 1 / fps)
    return totalDuration > 0 ? clamp((winStart + fraction * winDuration) / totalDuration, 0, 1) : 0
  }
  const frameFor = (fraction: number, win: FrameSpan) => {
    const winStart = win.start / fps
    const winDuration = Math.max((win.end - win.start + 1) / fps, 1 / fps)
    return clamp(timeToFrame(winStart + fraction * winDuration, fps), win.start, win.end)
  }

  const applyHandleDrag = (mode: 'start' | 'end', fraction: number, win: FrameSpan) => {
    const frame = frameFor(fraction, win)
    const current = span ?? { start: 0, end: lastFrame }
    const next: FrameSpan =
      mode === 'start'
        ? { start: Math.min(frame, current.end), end: current.end }
        : { start: current.start, end: Math.max(frame, current.start) }
    onSpanChange?.(next)
    // Live-preview the frame under the handle, video-editor style.
    adapter.previewSeekToProgress(frameCenterProgress(mode === 'start' ? next.start : next.end))
    return next
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return
    }
    const handleElement = (event.target as HTMLElement).closest?.('[data-span-handle]')
    const mode: DragMode = spanEnabled
      ? handleElement instanceof HTMLElement && handleElement.dataset.spanHandle === 'start'
        ? 'start'
        : handleElement instanceof HTMLElement && handleElement.dataset.spanHandle === 'end'
          ? 'end'
          : 'scrub'
      : 'scrub'
    event.currentTarget.setPointerCapture(event.pointerId)
    dragModeRef.current = mode
    dragWindowRef.current = { ...displayWindow }
    adapter.beginScrubbing()
    if (mode === 'scrub') {
      adapter.previewSeekToProgress(globalProgressFor(fractionFromPointer(event), displayWindow))
    } else {
      applyHandleDrag(mode, fractionFromPointer(event), displayWindow)
    }
  }
  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const mode = dragModeRef.current
    const win = dragWindowRef.current ?? displayWindow
    if (mode === 'scrub') {
      adapter.previewSeekToProgress(globalProgressFor(fractionFromPointer(event), win))
    } else if (mode) {
      applyHandleDrag(mode, fractionFromPointer(event), win)
    }
  }
  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const mode = dragModeRef.current
    if (!mode) {
      return
    }
    const win = dragWindowRef.current ?? displayWindow
    dragModeRef.current = null
    dragWindowRef.current = null
    if (mode === 'scrub') {
      adapter.endScrubbing(globalProgressFor(fractionFromPointer(event), win))
    } else {
      const next = applyHandleDrag(mode, fractionFromPointer(event), win)
      adapter.endScrubbing(frameCenterProgress(mode === 'start' ? next.start : next.end))
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      adapter.stepFrames(-1)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      adapter.stepFrames(1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      adapter.seekToProgress(frameCenterProgress(displayWindow.start))
    } else if (event.key === 'End') {
      event.preventDefault()
      adapter.seekToProgress(frameCenterProgress(displayWindow.end))
    } else if (spanEnabled && (event.key === 'i' || event.key === 'I')) {
      event.preventDefault()
      const frame = media.currentFrame
      onSpanChange?.({ start: frame, end: Math.max(frame, span?.end ?? lastFrame) })
    } else if (spanEnabled && (event.key === 'o' || event.key === 'O')) {
      event.preventDefault()
      const frame = media.currentFrame
      onSpanChange?.({ start: Math.min(frame, span?.start ?? 0), end: frame })
    }
  }

  const globalProgress = totalDuration > 0 ? clamp(media.playlistCurrentTime / totalDuration, 0, 1) : 0
  const playheadPosition = windowPosition(media.playlistCurrentTime)
  // When the playhead falls outside the zoomed window it stays visible,
  // clamped to the edge with a distinct style — hiding it entirely lets the
  // viewport silently show an out-of-window frame (masks drawn there get
  // stamped with a frame the artist never saw on the strip).
  const playheadInWindow =
    media.playlistCurrentTime >= windowStartTime - 0.5 / fps &&
    media.playlistCurrentTime <= windowStartTime + windowDuration + 0.5 / fps
  const startEdgePosition = windowPosition(handleFrames.start / fps)
  const endEdgePosition = windowPosition((handleFrames.end + 1) / fps)

  return (
    <div
      ref={containerRef}
      className="filmstrip-scrub"
      role="slider"
      tabIndex={0}
      aria-label="Scrub timeline"
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={globalProgress}
      aria-valuetext={`frame ${media.currentFrame}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={handleKeyDown}
    >
      <canvas ref={canvasRef} className="filmstrip-scrub__canvas" />
      {spanActive && !viewWindow ? (
        <>
          <div
            className="filmstrip-scrub__shade"
            style={{ left: 0, width: `${startEdgePosition * 100}%` }}
          />
          <div
            className="filmstrip-scrub__shade"
            style={{ left: `${endEdgePosition * 100}%`, right: 0 }}
          />
        </>
      ) : null}
      <div
        className={`filmstrip-scrub__playhead${
          playheadInWindow ? '' : ' filmstrip-scrub__playhead--outside'
        }`}
        style={{ left: `${playheadPosition * 100}%` }}
        title={
          playheadInWindow
            ? undefined
            : `Playhead at f${media.currentFrame} — outside the zoomed window`
        }
      />
      {spanEnabled ? (
        <>
          <div
            className="filmstrip-scrub__handle filmstrip-scrub__handle--start"
            data-span-handle="start"
            style={{ left: `${startEdgePosition * 100}%` }}
            title="Drag to set span start"
          >
            {spanActive ? (
              <span className="filmstrip-scrub__handle-label">{handleFrames.start}</span>
            ) : null}
          </div>
          <div
            className="filmstrip-scrub__handle filmstrip-scrub__handle--end"
            data-span-handle="end"
            style={{ left: `${endEdgePosition * 100}%` }}
            title="Drag to set span end"
          >
            {spanActive ? (
              <span className="filmstrip-scrub__handle-label">{handleFrames.end}</span>
            ) : null}
          </div>
          {spanActive ? (
            <button
              type="button"
              className="filmstrip-scrub__clear"
              title="Clear span"
              aria-label="Clear span"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => onSpanChange?.(null)}
            >
              ✕
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
