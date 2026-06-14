import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AssetSummary } from '../api/library';

const RECENTS_CAP = 100;

interface LibraryState {
  favorites: Record<number, AssetSummary>;
  recents: AssetSummary[];
  toggleFavorite: (asset: AssetSummary) => void;
  pushRecent: (asset: AssetSummary) => void;
}

export const useLibraryStore = create<LibraryState>()(
  persist(
    (set) => ({
      favorites: {},
      recents: [],
      toggleFavorite: (asset) =>
        set((state) => {
          const favorites = { ...state.favorites };
          if (favorites[asset.id]) delete favorites[asset.id];
          else favorites[asset.id] = asset;
          return { favorites };
        }),
      pushRecent: (asset) =>
        set((state) => ({
          recents: [asset, ...state.recents.filter((a) => a.id !== asset.id)].slice(
            0,
            RECENTS_CAP,
          ),
        })),
    }),
    { name: 'nexus-reference-library' },
  ),
);
