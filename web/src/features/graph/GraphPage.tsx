import { useLocation, useParams } from 'wouter';
import { DependencyGraph } from './DependencyGraph';

export function GraphPage() {
  const params = useParams<{ versionId: string }>();
  const [, navigate] = useLocation();
  const versionId = Number(params.versionId);

  if (!Number.isFinite(versionId)) {
    return <div className="empty-state">Invalid version id.</div>;
  }

  return (
    <div style={{ height: '100vh' }}>
      <DependencyGraph
        versionId={versionId}
        onOpenEntity={(entityId) => navigate(`/entities/${entityId}`)}
      />
    </div>
  );
}
