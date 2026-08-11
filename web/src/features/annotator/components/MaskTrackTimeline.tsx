import { useRef } from 'react'
import './MaskTrackTimeline.css'
import { SpanFrameInput } from './SpanFrameInput'

interface TrackSegment {
  startFrame: number
  endFrame: number
  type: 'keyframe' | 'propagated' | 'lowConfidence' | 'result'
}

interface MaskTrackState {
  layerId: string
  layerName: string
  layerColor: string
  segments: TrackSegment[]
  keyframes: number[]
}

interface FrameSpan {
  start: number
  end: number
}

interface MaskTrackTimelineProps {
  tracks: MaskTrackState[]
  currentFrame: number
  totalFrames: number
  span?: FrameSpan | null
  /** Per-layer propagation spans; a layer with its own span overrides the global one. */
  layerSpans?: Record<string, FrameSpan | null>
  onLayerSpanChange?: (layerId: string, span: FrameSpan | null) => void
  /** Frame range the lanes display (the filmstrip's zoom window); full timeline when null. */
  viewWindow?: FrameSpan | null
  onKeyframeClick: (layerId: string, frame: number) => void
  onScrub: (progress: number) => void
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function MaskTrackTimeline({
  tracks,
  currentFrame,
  totalFrames,
  span,
  layerSpans,
  onLayerSpanChange,
  viewWindow,
  onKeyframeClick,
  onScrub,
}: MaskTrackTimelineProps) {
  const dragRef = useRef<{ layerId: string; mode: 'start' | 'end' } | null>(null)
  // A handle drag ends with a click event on the lane; this flag keeps that
  // click from also scrubbing.
  const suppressClickRef = useRef(false)

  if (!tracks.length) return null

  const safeTotal = Math.max(totalFrames, 1)
  const lastFrame = safeTotal - 1
  // Lanes render the same frame window as the filmstrip's zoom (full timeline
  // when not zoomed); all frame → position math is relative to it.
  const winStart = clamp(viewWindow?.start ?? 0, 0, lastFrame)
  const winEnd = clamp(viewWindow?.end ?? lastFrame, winStart, lastFrame)
  const winCount = winEnd - winStart + 1
  const pct = (frame: number) => `${((frame - winStart) / winCount) * 100}%`
  const width = (start: number, end: number) => `${((end - start) / winCount) * 100}%`
  // Clip an inclusive frame band to the window; null when fully outside.
  const clipBand = (start: number, end: number) => {
    if (end < winStart || start > winEnd) return null
    const clippedStart = Math.max(start, winStart)
    const clippedEnd = Math.min(end, winEnd)
    return { left: pct(clippedStart), width: width(clippedStart, clippedEnd) }
  }

  const frameFromPointer = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const fraction = rect.width > 0 ? clamp((event.clientX - rect.left) / rect.width, 0, 1) : 0
    return clamp(winStart + Math.floor(fraction * winCount + 1e-6), winStart, winEnd)
  }

  const handleLaneClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    const frame = frameFromPointer(event)
    onScrub((frame + 0.5) / safeTotal)
  }

  const applyLayerHandleDrag = (layerId: string, mode: 'start' | 'end', frame: number) => {
    const current = layerSpans?.[layerId] ?? { start: 0, end: lastFrame }
    const next: FrameSpan =
      mode === 'start'
        ? { start: Math.min(frame, current.end), end: current.end }
        : { start: current.start, end: Math.max(frame, current.start) }
    onLayerSpanChange?.(layerId, next)
    // Preview the frame under the handle so the video follows the trim.
    onScrub((mode === 'start' ? next.start : next.end) / safeTotal + 0.5 / safeTotal)
  }

  const handleLanePointerDown = (layerId: string) => (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !onLayerSpanChange) return
    const handleElement = (event.target as HTMLElement).closest?.('[data-layer-span-handle]')
    if (!(handleElement instanceof HTMLElement)) return
    const mode = handleElement.dataset.layerSpanHandle === 'start' ? 'start' : 'end'
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { layerId, mode }
    applyLayerHandleDrag(layerId, mode, frameFromPointer(event))
  }
  const handleLanePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    applyLayerHandleDrag(drag.layerId, drag.mode, frameFromPointer(event))
  }
  const handleLanePointerUp = () => {
    if (dragRef.current) {
      dragRef.current = null
      suppressClickRef.current = true
    }
  }

  const commitLayerFrame = (layerId: string, mode: 'start' | 'end', frame: number) => {
    const bounded = clamp(frame, 0, lastFrame)
    const current = layerSpans?.[layerId]
    const other = mode === 'start' ? (current?.end ?? lastFrame) : (current?.start ?? 0)
    onLayerSpanChange?.(
      layerId,
      mode === 'start'
        ? { start: Math.min(bounded, other), end: Math.max(bounded, other) }
        : { start: Math.min(other, bounded), end: Math.max(other, bounded) },
    )
  }

  const spanValid = span && span.end >= span.start

  return (
    <div className="mask-track-timeline">
      {tracks.map((track) => {
        const rawLayerSpan = layerSpans?.[track.layerId]
        const layerSpan = rawLayerSpan && rawLayerSpan.end >= rawLayerSpan.start ? rawLayerSpan : null
        const handlePositions = layerSpan ?? { start: 0, end: lastFrame }
        return (
          <div key={track.layerId} className="mask-track-timeline__lane">
            <div className="mask-track-timeline__lane-label" style={{ color: track.layerColor }}>
              {track.layerName}
            </div>
            {onLayerSpanChange ? (
              <div className="mask-track-timeline__lane-spans">
                <SpanFrameInput
                  value={layerSpan?.start ?? null}
                  placeholder="in"
                  label={`${track.layerName} span start frame`}
                  className="mask-track-timeline__span-input"
                  onCommit={(frame) => commitLayerFrame(track.layerId, 'start', frame)}
                />
                <SpanFrameInput
                  value={layerSpan?.end ?? null}
                  placeholder="out"
                  label={`${track.layerName} span end frame`}
                  className="mask-track-timeline__span-input"
                  onCommit={(frame) => commitLayerFrame(track.layerId, 'end', frame)}
                />
                <button
                  type="button"
                  className={`mask-track-timeline__span-clear${layerSpan ? '' : ' mask-track-timeline__span-clear--hidden'}`}
                  title="Clear layer span"
                  aria-label={`Clear ${track.layerName} span`}
                  onClick={() => onLayerSpanChange(track.layerId, null)}
                >
                  ✕
                </button>
              </div>
            ) : null}
            <div
              className="mask-track-timeline__lane-content"
              onClick={handleLaneClick}
              onPointerDown={handleLanePointerDown(track.layerId)}
              onPointerMove={handleLanePointerMove}
              onPointerUp={handleLanePointerUp}
              onPointerCancel={handleLanePointerUp}
            >
              {/* Propagated spans */}
              {track.segments
                .filter((s) => s.type === 'propagated')
                .map((seg, i) => {
                  const band = clipBand(seg.startFrame, seg.endFrame)
                  return band ? (
                    <div
                      key={`prop-${i}`}
                      className="mask-track-timeline__bar mask-track-timeline__bar--propagated"
                      style={band}
                    />
                  ) : null
                })}

              {/* Low-confidence spans */}
              {track.segments
                .filter((s) => s.type === 'lowConfidence')
                .map((seg, i) => {
                  const band = clipBand(seg.startFrame, seg.endFrame)
                  return band ? (
                    <div
                      key={`low-${i}`}
                      className="mask-track-timeline__bar mask-track-timeline__bar--low-confidence"
                      style={band}
                    />
                  ) : null
                })}

              {/* Result spans: where the layer's pinned removal take lives */}
              {track.segments
                .filter((s) => s.type === 'result')
                .map((seg, i) => {
                  const band = clipBand(seg.startFrame, seg.endFrame)
                  return band ? (
                    <div
                      key={`res-${i}`}
                      className="mask-track-timeline__bar mask-track-timeline__bar--result"
                      style={band}
                    />
                  ) : null
                })}

              {/* Keyframe diamonds */}
              {track.keyframes
                .filter((frame) => frame >= winStart && frame <= winEnd)
                .map((frame) => (
                <button
                  key={`kf-${frame}`}
                  type="button"
                  className="mask-track-timeline__keyframe"
                  style={{ left: pct(frame) }}
                  title={`Frame ${frame}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onKeyframeClick(track.layerId, frame)
                  }}
                >
                  ◆
                </button>
              ))}

              {/* Propagation scope band: the layer's own span when set, else the global one */}
              {(() => {
                const scope = layerSpan ?? (spanValid ? span! : null)
                if (!scope) return null
                const band = clipBand(scope.start, scope.end)
                return band ? (
                  <div
                    className={`mask-track-timeline__span${layerSpan ? ' mask-track-timeline__span--layer' : ''}`}
                    style={band}
                  />
                ) : null
              })()}

              {/* Layer span trim handles (docked at the ends until a span is set) */}
              {onLayerSpanChange ? (
                <>
                  <div
                    className={`mask-track-timeline__span-handle${layerSpan ? '' : ' mask-track-timeline__span-handle--docked'}`}
                    data-layer-span-handle="start"
                    style={{ left: pct(clamp(handlePositions.start, winStart, winEnd)) }}
                    title="Drag to set layer span start"
                  />
                  <div
                    className={`mask-track-timeline__span-handle${layerSpan ? '' : ' mask-track-timeline__span-handle--docked'}`}
                    data-layer-span-handle="end"
                    style={{ left: pct(clamp(handlePositions.end, winStart, winEnd)) }}
                    title="Drag to set layer span end"
                  />
                </>
              ) : null}

              {/* Playhead */}
              {currentFrame >= winStart && currentFrame <= winEnd ? (
                <div
                  className="mask-track-timeline__playhead"
                  style={{ left: pct(currentFrame) }}
                />
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}
