import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AssetSummary } from '../api/library';
import type { CanvasDoc, CanvasItem } from '../api/boards';

export const DEFAULT_SLOT = 'Unsorted';
export const SLOTS = [
  DEFAULT_SLOT,
  'Character',
  'Costume',
  'Lighting',
  'Pose',
  'Environment',
  'Style',
];

export interface BasketItem {
  asset: AssetSummary;
  slot: string;
}

interface BasketState {
  items: BasketItem[];
  collapsed: boolean;
  add: (asset: AssetSummary, slot?: string) => void;
  remove: (assetId: number) => void;
  setSlot: (assetId: number, slot: string) => void;
  clear: () => void;
  toggleCollapsed: () => void;
}

export const useBasketStore = create<BasketState>()(
  persist(
    (set) => ({
      items: [],
      collapsed: false,
      add: (asset, slot = DEFAULT_SLOT) =>
        set((state) =>
          state.items.some((i) => i.asset.id === asset.id)
            ? state
            : { items: [...state.items, { asset, slot }], collapsed: false },
        ),
      remove: (assetId) =>
        set((state) => ({ items: state.items.filter((i) => i.asset.id !== assetId) })),
      setSlot: (assetId, slot) =>
        set((state) => ({
          items: state.items.map((i) => (i.asset.id === assetId ? { ...i, slot } : i)),
        })),
      clear: () => set({ items: [] }),
      toggleCollapsed: () => set((state) => ({ collapsed: !state.collapsed })),
    }),
    { name: 'nexus-reference-basket' },
  ),
);

/**
 * Lay basket items out as a canvas document, clustered by slot: one column
 * per slot, items stacked top-to-bottom at a uniform display width.
 */
export function basketToCanvas(items: BasketItem[]): CanvasDoc {
  const ITEM_WIDTH = 280;
  const GAP = 24;
  const COLUMN_GAP = 80;

  const bySlot = new Map<string, BasketItem[]>();
  for (const item of items) {
    const group = bySlot.get(item.slot) ?? [];
    group.push(item);
    bySlot.set(item.slot, group);
  }

  const canvasItems: CanvasItem[] = [];
  let columnX = 0;
  for (const [, group] of bySlot) {
    let y = 0;
    for (const { asset } of group) {
      const ratio = asset.width && asset.height ? asset.width / asset.height : 1;
      const height = ITEM_WIDTH / ratio;
      canvasItems.push({
        id: crypto.randomUUID(),
        asset_id: asset.id,
        x: columnX,
        y,
        width: ITEM_WIDTH,
        height,
        rotation: 0,
      });
      y += height + GAP;
    }
    columnX += ITEM_WIDTH + COLUMN_GAP;
  }
  return { items: canvasItems };
}

/** JSON manifest of the basket — the hand-off artifact for generation pipelines. */
export function basketManifest(items: BasketItem[]) {
  const slots: Record<string, object[]> = {};
  for (const { asset, slot } of items) {
    slots[slot] = slots[slot] ?? [];
    slots[slot].push({
      id: asset.id,
      code: asset.code,
      name: asset.name,
      file_path: asset.file_path,
      tags: asset.tags,
    });
  }
  return { kind: 'nexus-reference-basket', exported_at: new Date().toISOString(), slots };
}
