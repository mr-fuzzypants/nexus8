import { useLibraryStore } from '../stores/library';
import { StaticGalleryPage } from './StaticGalleryPage';

export function FavoritesPage() {
  const favorites = useLibraryStore((s) => s.favorites);
  return (
    <StaticGalleryPage
      title="Favorites"
      assets={Object.values(favorites)}
      emptyMessage="Nothing here yet — hover any asset and tap the heart to keep it close."
    />
  );
}
