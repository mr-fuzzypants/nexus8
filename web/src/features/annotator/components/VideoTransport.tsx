import { useEffect, useRef, useState } from 'react'
import { frameToMidTime, type VideoViewerAdapter } from '../core/viewers/videoAdapter'
import { FilmstripScrubber, type FrameSpan } from './FilmstripScrubber'
import { SpanFrameInput } from './SpanFrameInput'

/** Render a SMPTE-ish timecode (mm:ss:ff) from a time in seconds + frame rate. */
function formatTimecode(seconds: number, frameRate: number) {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0
  const fps = Math.max(frameRate, 1)
  const whole = Math.floor(safeSeconds)
  const minutes = Math.floor(whole / 60)
  const secs = whole % 60
  const frames = Math.floor((safeSeconds - whole) * fps)
  const pad = (value: number) => `${value}`.padStart(2, '0')
  return `${pad(minutes)}:${pad(secs)}:${pad(frames)}`
}

/**
 * Playback transport for the frame-accurate video adapter: play/pause, single-frame
 * stepping, a filmstrip scrub bar, and a live timecode/frame readout. Subscribes to
 * the adapter so it re-renders on every frame callback during playback. When span
 * editing is enabled, also hosts numeric in/out frame fields and a zoom-to-span
 * toggle that focuses the filmstrip on the span.
 */
export function VideoTransport({
  adapter,
  span,
  onSpanChange,
  zoomToSpan = false,
  onZoomToSpanChange,
}: {
  adapter: VideoViewerAdapter
  span?: FrameSpan | null
  onSpanChange?: (span: FrameSpan | null) => void
  /** Controlled zoom-to-span state — lifted so sibling timelines can share the window. */
  zoomToSpan?: boolean
  onZoomToSpanChange?: (zoom: boolean) => void
}) {
  const [, setVersion] = useState(0)

  useEffect(() => adapter.subscribe?.(() => setVersion((value) => value + 1)), [adapter])

  const media = adapter.getMediaState()
  const totalDuration = media.playlistDuration || media.duration || 0
  const fps = Math.max(media.frameRate, 1)
  const lastFrame = Math.max(0, Math.round(totalDuration * fps) - 1)

  const spanEnabled = Boolean(onSpanChange)
  const spanActive = span != null && span.end >= span.start

  // Zooming must not strand the playhead outside the window: the viewport
  // would keep showing an out-of-window frame while the strip displays the
  // span — masks drawn there get stamped with the unseen frame. On zoom
  // activation, seek to the nearest in-window frame. (Activation only: span
  // edits while zoomed already live-preview the dragged handle's frame.)
  const windowActive = zoomToSpan && spanActive
  const wasWindowActive = useRef(false)
  useEffect(() => {
    const activated = windowActive && !wasWindowActive.current
    wasWindowActive.current = windowActive
    if (!activated || !span || totalDuration <= 0) return
    const frame = adapter.getMediaState().currentFrame
    if (frame < span.start || frame > span.end) {
      const clamped = Math.min(Math.max(frame, span.start), span.end)
      adapter.seekToProgress(frameToMidTime(clamped, fps) / totalDuration)
    }
  }, [windowActive, span, adapter, fps, totalDuration])

  const commitStart = (frame: number) => {
    const next = Math.min(Math.max(frame, 0), lastFrame)
    const end = span?.end ?? lastFrame
    onSpanChange?.({ start: Math.min(next, end), end: Math.max(next, end) })
  }
  const commitEnd = (frame: number) => {
    const next = Math.min(Math.max(frame, 0), lastFrame)
    const start = span?.start ?? 0
    onSpanChange?.({ start: Math.min(start, next), end: Math.max(start, next) })
  }

  return (
    <div className="video-transport">
      <div className="video-transport__controls">
        <button
          type="button"
          className="video-transport__button"
          onClick={() => adapter.stepFrames(-1)}
          title="Previous frame"
          aria-label="Previous frame"
        >
          ◀|
        </button>
        <button
          type="button"
          className="video-transport__button video-transport__button--play"
          onClick={() => adapter.togglePlayback()}
          title={media.playing ? 'Pause' : 'Play'}
          aria-label={media.playing ? 'Pause' : 'Play'}
        >
          {media.playing ? '❚❚' : '▶'}
        </button>
        <button
          type="button"
          className="video-transport__button"
          onClick={() => adapter.stepFrames(1)}
          title="Next frame"
          aria-label="Next frame"
        >
          |▶
        </button>
      </div>

      <FilmstripScrubber
        adapter={adapter}
        media={media}
        span={span}
        onSpanChange={onSpanChange}
        viewWindow={zoomToSpan && spanActive ? span : null}
      />

      {spanEnabled ? (
        <div className="video-transport__span-controls">
          <SpanFrameInput
            value={span?.start ?? null}
            placeholder="in"
            label="Span start frame"
            className="video-transport__span-input"
            onCommit={commitStart}
          />
          <span className="video-transport__span-dash">–</span>
          <SpanFrameInput
            value={span?.end ?? null}
            placeholder="out"
            label="Span end frame"
            className="video-transport__span-input"
            onCommit={commitEnd}
          />
          <button
            type="button"
            className={`video-transport__button video-transport__button--zoom${
              zoomToSpan ? ' video-transport__button--zoom-active' : ''
            }`}
            disabled={!spanActive}
            aria-pressed={zoomToSpan}
            title={zoomToSpan ? 'Show full timeline' : 'Zoom filmstrip to span'}
            aria-label={zoomToSpan ? 'Show full timeline' : 'Zoom filmstrip to span'}
            onClick={() => onZoomToSpanChange?.(!zoomToSpan)}
          >
            {zoomToSpan ? '«»' : '»«'}
          </button>
        </div>
      ) : null}

      <div className="video-transport__readout">
        <span className="video-transport__timecode">
          {formatTimecode(media.playlistCurrentTime, media.frameRate)}
        </span>
        <span className="video-transport__frame">f{media.currentFrame}</span>
        <span className="video-transport__fps">{media.frameRate.toFixed(2)} fps</span>
      </div>
    </div>
  )
}
