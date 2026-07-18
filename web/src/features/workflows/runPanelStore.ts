import { create } from 'zustand';
import type { AssetSummary } from '../../api/library';
import type { WorkflowAttachment } from './types';

/**
 * Global state for the run panel. The panel is mounted once in the Shell and
 * rendered as a non-blocking side drawer, so the rest of the app stays
 * interactive — that's what makes drag-and-drop from anywhere possible.
 */
interface RunPanelState {
  attachment: WorkflowAttachment | null;
  asset: AssetSummary | null;
  /** True while an asset drag (started anywhere in the app) is in flight. */
  dragging: boolean;
  open: (attachment: WorkflowAttachment, asset: AssetSummary) => void;
  close: () => void;
  setDragging: (dragging: boolean) => void;
}

export const useRunPanelStore = create<RunPanelState>((set) => ({
  attachment: null,
  asset: null,
  dragging: false,
  open: (attachment, asset) => set({ attachment, asset }),
  close: () => set({ attachment: null, asset: null }),
  setDragging: (dragging) => set({ dragging }),
}));
