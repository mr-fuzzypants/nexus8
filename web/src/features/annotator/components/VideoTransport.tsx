import { useEffect, useState, type KeyboardEvent } from 'react'
import type { VideoViewerAdapter } from '../core/viewers/videoAdapter'
import { FilmstripScrubber, type FrameSpan } from './FilmstripScrubber'

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
 * Frame-number field for one end of the span. Keeps its own text while focused
 * so typing isn't fought by re-renders; commits on Enter/blur, reverts on
 * Escape or invalid input.
 */
function SpanFrameInput({
  value,
  placeholder,
  label,
  onCommit,
}: {
  value: number | null
  placeholder: string
  label: string
  onCommit: (frame: number) => void
}) {
  const [text, setText] = useState<string | null>(null)
  const displayed = text ?? (value != null ? String(value) : '')

  const commit = () => {
    if (text != null && text.trim() !== '') {
      const parsed = Number(text)
      if (Number.isFinite(parsed)) {
        onCommit(Math.round(parsed))
      }
    }
    setText(null)
  }
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commit()
      event.currentTarget.blur()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setText(null)
      event.currentTarget.blur()
    }
  }

  return (
    <input
      className="video-transport__span-input"
      type="number"
      min={0}
      inputMode="numeric"
      placeholder={placeholder}
      aria-label={label}
      title={label}
      value={displayed}
      onChange={(event) => setText(event.currentTarget.value)}
      onFocus={() => setText(displayed)}
      onBlur={commit}
      onKeyDown={handleKeyDown}
    />
  )
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
}: {
  adapter: VideoViewerAdapter
  span?: FrameSpan | null
  onSpanChange?: (span: FrameSpan | null) => void
}) {
  const [, setVersion] = useState(0)
  const [zoomToSpan, setZoomToSpan] = useState(false)

  useEffect(() => adapter.subscribe?.(() => setVersion((value) => value + 1)), [adapter])

  const media = adapter.getMediaState()
  const totalDuration = media.playlistDuration || media.duration || 0
  const fps = Math.max(media.frameRate, 1)
  const lastFrame = Math.max(0, Math.round(totalDuration * fps) - 1)

  const spanEnabled = Boolean(onSpanChange)
  const spanActive = span != null && span.end >= span.start

  // Clearing the span drops the zoom back to the full strip (render-time state
  // adjustment, not an effect, so the reset lands in the same commit).
  const [prevSpanActive, setPrevSpanActive] = useState(spanActive)
  if (prevSpanActive !== spanActive) {
    setPrevSpanActive(spanActive)
    if (!spanActive) {
      setZoomToSpan(false)
    }
  }

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
            onCommit={commitStart}
          />
          <span className="video-transport__span-dash">–</span>
          <SpanFrameInput
            value={span?.end ?? null}
            placeholder="out"
            label="Span end frame"
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
            onClick={() => setZoomToSpan((value) => !value)}
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
