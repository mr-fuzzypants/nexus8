import { create } from 'zustand'
import type { AssetSummary } from '../../api/library'
import type { VersionNode } from '../../api/versions'

export interface FloatingViewer {
  id: string
  asset: AssetSummary
  version?: VersionNode | null
  title: string
}

interface OpenViewerInput {
  asset: AssetSummary
  version?: VersionNode | null
}

interface ViewerStoreState {
  viewers: FloatingViewer[]
  open: (input: OpenViewerInput) => void
  close: (id: string) => void
  /** Bring a panel to the front by reordering it last (highest z-index). */
  focus: (id: string) => void
}

function viewerKey(input: OpenViewerInput): string {
  return `${input.asset.id}:${input.version?.id ?? 'current'}`
}

function viewerTitle(input: OpenViewerInput): string {
  return input.version
    ? `${input.asset.name} · v${input.version.version_number}`
    : input.asset.name
}

/**
 * Global registry of tear-off viewer panels. Entry points (detail panel, version
 * rows) call open(); a single <FloatingViewerLayer/> renders the result. Opening
 * the same asset+version twice focuses the existing panel instead of duplicating.
 */
export const useViewerStore = create<ViewerStoreState>((set) => ({
  viewers: [],
  open: (input) =>
    set((state) => {
      const id = viewerKey(input)
      const existing = state.viewers.find((viewer) => viewer.id === id)
      if (existing) {
        // Re-focus: move to the end (front-most).
        return { viewers: [...state.viewers.filter((viewer) => viewer.id !== id), existing] }
      }
      return {
        viewers: [
          ...state.viewers,
          { id, asset: input.asset, version: input.version ?? null, title: viewerTitle(input) },
        ],
      }
    }),
  close: (id) => set((state) => ({ viewers: state.viewers.filter((viewer) => viewer.id !== id) })),
  focus: (id) =>
    set((state) => {
      const target = state.viewers.find((viewer) => viewer.id === id)
      if (!target) {
        return state
      }
      return { viewers: [...state.viewers.filter((viewer) => viewer.id !== id), target] }
    }),
}))
