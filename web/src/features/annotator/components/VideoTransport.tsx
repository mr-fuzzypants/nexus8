import { useEffect, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type { VideoViewerAdapter } from '../core/viewers/videoAdapter'

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
 * stepping, a scrub bar, and a live timecode/frame readout. Subscribes to the adapter
 * so it re-renders on every frame callback during playback.
 */
export function VideoTransport({ adapter }: { adapter: VideoViewerAdapter }) {
  const [, setVersion] = useState(0)

  useEffect(() => adapter.subscribe?.(() => setVersion((value) => value + 1)), [adapter])

  const media = adapter.getMediaState()
  const totalDuration = media.playlistDuration || media.duration || 0
  const progress = totalDuration > 0 ? media.playlistCurrentTime / totalDuration : 0

  const handleScrub = (event: ChangeEvent<HTMLInputElement>) => {
    adapter.previewSeekToProgress(Number(event.currentTarget.value))
  }
  const handleScrubStart = () => adapter.beginScrubbing()
  const handleScrubEnd = (event: ReactPointerEvent<HTMLInputElement>) => {
    adapter.endScrubbing(Number(event.currentTarget.value))
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

      <input
        className="video-transport__scrub"
        type="range"
        min={0}
        max={1}
        step={0.0001}
        value={progress}
        onChange={handleScrub}
        onPointerDown={handleScrubStart}
        onPointerUp={handleScrubEnd}
        aria-label="Scrub timeline"
      />

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
