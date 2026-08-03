import './MaskTrackTimeline.css'

interface TrackSegment {
  startFrame: number
  endFrame: number
  type: 'keyframe' | 'propagated' | 'lowConfidence'
}

interface MaskTrackState {
  layerId: string
  layerName: string
  layerColor: string
  segments: TrackSegment[]
  keyframes: number[]
}

interface MaskTrackTimelineProps {
  tracks: MaskTrackState[]
  currentFrame: number
  totalFrames: number
  span?: { start: number; end: number } | null
  onSetSpanIn?: () => void
  onSetSpanOut?: () => void
  onClearSpan?: () => void
  onKeyframeClick: (layerId: string, frame: number) => void
  onScrub: (progress: number) => void
}

export function MaskTrackTimeline({
  tracks,
  currentFrame,
  totalFrames,
  span,
  onSetSpanIn,
  onSetSpanOut,
  onClearSpan,
  onKeyframeClick,
  onScrub,
}: MaskTrackTimelineProps) {
  if (!tracks.length) return null

  const safeTotal = Math.max(totalFrames, 1)
  const pct = (frame: number) => `${(frame / safeTotal) * 100}%`
  const width = (start: number, end: number) => `${((end - start) / safeTotal) * 100}%`

  const handleLaneClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const progress = (event.clientX - rect.left) / rect.width
    onScrub(Math.max(0, Math.min(1, progress)))
  }

  const spanValid = span && span.end >= span.start
  const spanLabel = spanValid
    ? `Span ${span!.start}–${span!.end} (${span!.end - span!.start + 1} frames)`
    : 'No span — will auto-scope from prompt'

  return (
    <div className="mask-track-timeline">
      {(onSetSpanIn || onSetSpanOut) ? (
        <div className="mask-track-timeline__span-controls">
          <button type="button" onClick={onSetSpanIn} title="Set span start to playhead">
            Set In [
          </button>
          <button type="button" onClick={onSetSpanOut} title="Set span end to playhead">
            ] Set Out
          </button>
          {spanValid ? (
            <button type="button" onClick={onClearSpan} title="Clear span">
              Clear
            </button>
          ) : null}
          <span className="mask-track-timeline__span-label">{spanLabel}</span>
        </div>
      ) : null}
      {tracks.map((track) => (
        <div key={track.layerId} className="mask-track-timeline__lane">
          <div className="mask-track-timeline__lane-label" style={{ color: track.layerColor }}>
            {track.layerName}
          </div>
          <div
            className="mask-track-timeline__lane-content"
            onClick={handleLaneClick}
          >
            {/* Propagated spans */}
            {track.segments
              .filter((s) => s.type === 'propagated')
              .map((seg, i) => (
                <div
                  key={`prop-${i}`}
                  className="mask-track-timeline__bar mask-track-timeline__bar--propagated"
                  style={{ left: pct(seg.startFrame), width: width(seg.startFrame, seg.endFrame) }}
                />
              ))}

            {/* Low-confidence spans */}
            {track.segments
              .filter((s) => s.type === 'lowConfidence')
              .map((seg, i) => (
                <div
                  key={`low-${i}`}
                  className="mask-track-timeline__bar mask-track-timeline__bar--low-confidence"
                  style={{ left: pct(seg.startFrame), width: width(seg.startFrame, seg.endFrame) }}
                />
              ))}

            {/* Keyframe diamonds */}
            {track.keyframes.map((frame) => (
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

            {/* Propagation span overlay */}
            {spanValid ? (
              <div
                className="mask-track-timeline__span"
                style={{ left: pct(span!.start), width: width(span!.start, span!.end) }}
              />
            ) : null}

            {/* Playhead */}
            <div
              className="mask-track-timeline__playhead"
              style={{ left: pct(currentFrame) }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}
