import { useLibraryStore } from '../stores/library';
import { StaticGalleryPage } from './StaticGalleryPage';

export function RecentPage() {
  const recents = useLibraryStore((s) => s.recents);
  return (
    <StaticGalleryPage
      title="Recent"
      assets={recents}
      emptyMessage="Assets you open will show up here."
    />
  );
}
