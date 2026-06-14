import type { LucideIcon } from 'lucide-react'
import {
  Brush,
  Circle,
  Eraser,
  Frame,
  Hexagon,
  ImagePlus,
  MousePointer2,
  MoveDown,
  MoveLeft,
  MoveRight,
  MoveUp,
  PencilLine,
  Redo2,
  RotateCcw,
  RotateCw,
  ScanSearch,
  SlidersHorizontal,
  Square,
  StickyNote,
  Trash2,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'

export function getViewerToolbarActionIcon(actionId: string): LucideIcon | undefined {
  switch (actionId) {
    case 'fit':
    case 'video-fit':
    case 'frame-scene':
    case 'frame-selected':
      return ScanSearch
    case 'zoom-in':
    case 'video-zoom-in':
      return ZoomIn
    case 'zoom-out':
    case 'video-zoom-out':
      return ZoomOut
    case 'pan-left':
      return MoveLeft
    case 'pan-right':
      return MoveRight
    case 'pan-up':
      return MoveUp
    case 'pan-down':
      return MoveDown
    case 'rotate-left':
      return RotateCcw
    case 'rotate-right':
      return RotateCw
    case 'rotate-up':
    case 'rotate-down':
      return Frame
    case 'reset-view':
      return ImagePlus
    case 'isometric-view':
    case 'top-view':
      return Frame
    case 'reload-stream':
      return ImagePlus
    default:
      return undefined
  }
}

export const VIEWER_TOOL_ICONS = {
  select: MousePointer2,
  freehand: PencilLine,
  brush: Brush,
  polygon: Hexagon,
  rectangle: Square,
  ellipse: Circle,
  text: Type,
  card: StickyNote,
  deleteSelected: Trash2,
  undo: Undo2,
  redo: Redo2,
  frameScene: ScanSearch,
  parameters: SlidersHorizontal,
  clear3d: Eraser,
} as const

export type ViewerToolbarToolId = keyof Pick<
  typeof VIEWER_TOOL_ICONS,
  'select' | 'freehand' | 'brush' | 'polygon' | 'rectangle' | 'ellipse' | 'text' | 'card'
>