import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { ActionIcon, Tooltip } from '@mantine/core'
import { IconMaximize, IconMinimize, IconX } from '@tabler/icons-react'
import { AssetViewer } from './AssetViewer'
import type { FloatingViewer } from './viewerStore'
import { useViewerStore } from './viewerStore'

interface FloatingViewerPanelProps {
  viewer: FloatingViewer
  /** Stacking order: later = front-most. */
  index: number
}

const MIN_WIDTH = 360
const MIN_HEIGHT = 280

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

function initialRect(index: number): Rect {
  // Open large so the fit-to-viewport media is comparable to the full-page
  // annotator, then cascade stacked panels so they don't perfectly overlap.
  const offset = (index % 6) * 28
  const width = Math.min(1280, Math.round(window.innerWidth * 0.92))
  const height = Math.min(880, Math.round(window.innerHeight * 0.88))
  const x = Math.max(16, (window.innerWidth - width) / 2 + offset)
  const y = Math.max(16, (window.innerHeight - height) / 2 - 24 + offset)
  return { x, y, width, height }
}

export function FloatingViewerPanel({ viewer, index }: FloatingViewerPanelProps) {
  const close = useViewerStore((s) => s.close)
  const focus = useViewerStore((s) => s.focus)
  const rootRef = useRef<HTMLDivElement>(null)
  const [rect, setRect] = useState<Rect>(() => initialRect(index))
  const [isFullscreen, setIsFullscreen] = useState(false)
  // Active drag/resize gesture. Pointer capture (below) routes move/up events to
  // the originating element, so no window listeners or teardown races.
  const gestureRef = useRef<
    { pointerId: number; mode: 'move' | 'resize'; startX: number; startY: number; origin: Rect } | null
  >(null)

  useEffect(() => {
    const handleChange = () => setIsFullscreen(document.fullscreenElement === rootRef.current)
    document.addEventListener('fullscreenchange', handleChange)
    return () => document.removeEventListener('fullscreenchange', handleChange)
  }, [])

  const beginGesture = (mode: 'move' | 'resize', event: ReactPointerEvent) => {
    if (isFullscreen) {
      return
    }
    event.preventDefault()
    focus(viewer.id)
    event.currentTarget.setPointerCapture(event.pointerId)
    gestureRef.current = { pointerId: event.pointerId, mode, startX: event.clientX, startY: event.clientY, origin: rect }
  }

  const handleMoveStart = (event: ReactPointerEvent) => beginGesture('move', event)
  const handleResizeStart = (event: ReactPointerEvent) => beginGesture('resize', event)

  const handleGesturePointerMove = (event: ReactPointerEvent) => {
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) {
      return
    }
    const dx = event.clientX - gesture.startX
    const dy = event.clientY - gesture.startY
    if (gesture.mode === 'move') {
      // Keep at least a sliver of the title bar reachable on screen.
      const maxX = window.innerWidth - 80
      const maxY = window.innerHeight - 48
      setRect({
        ...gesture.origin,
        x: Math.min(Math.max(80 - gesture.origin.width, gesture.origin.x + dx), maxX),
        y: Math.min(Math.max(0, gesture.origin.y + dy), maxY),
      })
    } else {
      setRect({
        ...gesture.origin,
        width: Math.max(MIN_WIDTH, Math.min(gesture.origin.width + dx, window.innerWidth - gesture.origin.x - 8)),
        height: Math.max(MIN_HEIGHT, Math.min(gesture.origin.height + dy, window.innerHeight - gesture.origin.y - 8)),
      })
    }
  }

  const endGesture = (event: ReactPointerEvent) => {
    if (gestureRef.current?.pointerId === event.pointerId) {
      gestureRef.current = null
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const toggleFullscreen = () => {
    if (document.fullscreenElement === rootRef.current) {
      document.exitFullscreen().catch(() => {})
    } else {
      rootRef.current?.requestFullscreen().catch(() => {})
    }
  }

  return (
    <div
      ref={rootRef}
      className="floating-viewer"
      style={
        isFullscreen
          ? { zIndex: 4000 + index }
          : { left: rect.x, top: rect.y, width: rect.width, height: rect.height, zIndex: 4000 + index }
      }
      onPointerDown={() => focus(viewer.id)}
    >
      <header
        className="floating-viewer__bar"
        onPointerDown={handleMoveStart}
        onPointerMove={handleGesturePointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
      >
        <span className="floating-viewer__title" title={viewer.title}>
          {viewer.title}
        </span>
        <div className="floating-viewer__actions" onPointerDown={(event) => event.stopPropagation()}>
          <Tooltip label={isFullscreen ? 'Exit full screen' : 'Full screen'}>
            <ActionIcon variant="subtle" color="gray" size="sm" onClick={toggleFullscreen} aria-label="Toggle full screen">
              {isFullscreen ? <IconMinimize size={15} stroke={1.75} /> : <IconMaximize size={15} stroke={1.75} />}
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Close">
            <ActionIcon variant="subtle" color="gray" size="sm" onClick={() => close(viewer.id)} aria-label="Close viewer">
              <IconX size={15} stroke={1.75} />
            </ActionIcon>
          </Tooltip>
        </div>
      </header>
      <div className="floating-viewer__content">
        <AssetViewer asset={viewer.asset} version={viewer.version} />
      </div>
      {!isFullscreen ? (
        <div
          className="floating-viewer__resize"
          onPointerDown={handleResizeStart}
          onPointerMove={handleGesturePointerMove}
          onPointerUp={endGesture}
          onPointerCancel={endGesture}
          aria-hidden
        />
      ) : null}
    </div>
  )
}
