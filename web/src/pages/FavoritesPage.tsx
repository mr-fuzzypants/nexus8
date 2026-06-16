import { useLibraryStore } from '../stores/library';
import { useProject } from '../features/projects/ProjectContext';
import { StaticGalleryPage } from './StaticGalleryPage';

export function FavoritesPage() {
  const { code } = useProject();
  const favorites = useLibraryStore((s) => s.favorites);
  const assets = Object.values(favorites).filter((a) => a.project_code === code);
  return (
    <StaticGalleryPage
      title="Favorites"
      assets={assets}
      emptyMessage="Nothing here yet — hover any asset and tap the heart to keep it close."
    />
  );
}
