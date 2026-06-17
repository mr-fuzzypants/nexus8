import { lazy, Suspense, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useViewerStore } from './viewerStore'

// The panel pulls in the viewer adapters (2D/video) and render pipeline; keep it
// out of the initial bundle until a viewer is actually opened.
const FloatingViewerPanel = lazy(() =>
  import('./FloatingViewerPanel').then((module) => ({ default: module.FloatingViewerPanel })),
)

/**
 * Renders all open tear-off viewer panels into a body-level portal so they float
 * above the app shell regardless of where they were launched from. Mount once.
 */
export function FloatingViewerLayer() {
  const viewers = useViewerStore((s) => s.viewers)
  const active = viewers.length > 0

  // While a viewer is open, suppress the app's backdrop-filter chrome (sticky
  // toolbars, drawer overlays). Chrome re-rasterizes every backdrop-filter region
  // on each composited frame, so a playing video behind them stutters — most
  // visibly in full screen. The blur is purely cosmetic and hidden by the panel
  // anyway. (Annotate mode never hits this: it renders outside the Shell.)
  useEffect(() => {
    document.body.classList.toggle('viewer-open', active)
    return () => document.body.classList.remove('viewer-open')
  }, [active])

  if (!active) {
    return null
  }
  return createPortal(
    <Suspense fallback={null}>
      {viewers.map((viewer, index) => (
        <FloatingViewerPanel key={viewer.id} viewer={viewer} index={index} />
      ))}
    </Suspense>,
    document.body,
  )
}
