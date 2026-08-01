import { useLocation, useParams } from 'wouter';
import { RelationsGraph } from './RelationsGraph';

export function RelationsGraphPage() {
  const params = useParams<{ nodeId: string }>();
  const [, navigate] = useLocation();
  const nodeId = params.nodeId ?? '';

  if (!/^[ve]\d+$/.test(nodeId)) {
    return <div className="empty-state">Invalid node id (expected v123 or e45).</div>;
  }

  return (
    <div style={{ height: '100vh' }}>
      <RelationsGraph
        rootNodeId={nodeId}
        onOpenEntity={(entityId) => navigate(`/entities/${entityId}`)}
        onOpenDependencies={(versionId) => navigate(`/graph/${versionId}`)}
        onBack={() => window.history.back()}
      />
    </div>
  );
}
