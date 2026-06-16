import { useLibraryStore } from '../stores/library';
import { useProject } from '../features/projects/ProjectContext';
import { StaticGalleryPage } from './StaticGalleryPage';

export function RecentPage() {
  const { code } = useProject();
  const recents = useLibraryStore((s) => s.recents);
  const assets = recents.filter((a) => a.project_code === code);
  return (
    <StaticGalleryPage
      title="Recent"
      assets={assets}
      emptyMessage="Assets you open will show up here."
    />
  );
}
