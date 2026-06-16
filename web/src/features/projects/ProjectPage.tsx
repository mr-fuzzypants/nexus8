import { useQuery } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import { Badge, Button, Text } from '@mantine/core';
import { IconArrowLeft, IconPhoto, IconUsers } from '@tabler/icons-react';
import { getProject } from '../../api/projects';
import { thumbUrl } from '../../api/library';
import { useProject } from './ProjectContext';

const STATUS_COLOR: Record<string, string> = {
  active: 'green',
  wip: 'yellow',
  archived: 'gray',
};

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Text fw={650} size="xl" style={{ lineHeight: 1 }}>
        {value}
      </Text>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
    </div>
  );
}

export function ProjectPage() {
  const [, navigate] = useLocation();
  const { code } = useProject();
  const project = useQuery({
    queryKey: ['project', code],
    queryFn: () => getProject(code),
  });

  if (project.isLoading) {
    return <div className="empty-state">Loading project…</div>;
  }
  if (project.isError || !project.data) {
    return (
      <div className="empty-state">
        <p>Project not found.</p>
        <Button variant="subtle" onClick={() => navigate('~/')}>
          Back to projects
        </Button>
      </div>
    );
  }

  const p = project.data;
  const ai = p.stats.ai ?? {};
  const analyzed = ai.completed ?? 0;
  const totalAi = Object.values(ai).reduce((sum, n) => sum + n, 0);

  return (
    <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          gap: 20,
          padding: 24,
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div
          style={{
            width: 160,
            height: 120,
            borderRadius: 10,
            overflow: 'hidden',
            background: 'var(--muted)',
            flexShrink: 0,
          }}
        >
          {p.cover_thumb && (
            <img
              src={p.cover_thumb}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Link href="~/" className="nav-link" style={{ padding: 0, marginBottom: 8 }}>
            <IconArrowLeft size={15} /> All projects
          </Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Text fw={680} size="xl">
              {p.name}
            </Text>
            <Badge color={STATUS_COLOR[p.status] ?? 'gray'} variant="light">
              {p.status}
            </Badge>
          </div>
          {p.description && (
            <Text size="sm" c="dimmed" mt={4}>
              {p.description}
            </Text>
          )}
          <div style={{ display: 'flex', gap: 32, marginTop: 16 }}>
            <Stat label="Assets" value={p.stats.total_assets} />
            <Stat label="Entities" value={p.stats.total_entities} />
            <Stat
              label="AI analyzed"
              value={totalAi ? `${analyzed}/${totalAi}` : '—'}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <Button
              size="xs"
              variant="light"
              leftSection={<IconUsers size={14} />}
              onClick={() => navigate('/entities')}
            >
              Browse entities
            </Button>
            <Button
              size="xs"
              variant="light"
              leftSection={<IconPhoto size={14} />}
              onClick={() => navigate('/')}
            >
              Browse assets
            </Button>
          </div>
        </div>
      </div>

      {/* Entities by category */}
      <section style={{ padding: 24 }}>
        <Text fw={600} mb={12}>
          Entities by category
        </Text>
        {p.entities_by_category.length === 0 ? (
          <Text size="sm" c="dimmed">
            No entities in this project yet.{' '}
            <Link href="/entities">Create some →</Link>
          </Text>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {p.entities_by_category.map((group) => (
              <div key={group.category}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 8,
                    marginBottom: 8,
                  }}
                >
                  <Text fw={550} tt="capitalize">
                    {group.category}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {group.count}
                  </Text>
                  <Link href="/entities" style={{ marginLeft: 'auto', fontSize: 12 }}>
                    View all →
                  </Link>
                </div>
                <div className="entity-grid">
                  {group.entities.map((entity) => (
                    <div
                      key={entity.id}
                      className="entity-card"
                      role="button"
                      tabIndex={0}
                      onClick={() => navigate(`/entities/${entity.id}`)}
                      onKeyDown={(e) => e.key === 'Enter' && navigate(`/entities/${entity.id}`)}
                      style={{ cursor: 'pointer' }}
                    >
                      {entity.thumb ? (
                        <img src={entity.thumb} alt="" loading="lazy" />
                      ) : (
                        <div style={{ aspectRatio: '4/3', background: 'var(--muted)' }} />
                      )}
                      <div className="entity-card-body">
                        <Text size="sm" fw={550} truncate>
                          {entity.name}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {entity.asset_count ?? 0} asset{entity.asset_count === 1 ? '' : 's'}
                        </Text>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Recent assets */}
      {p.recent_assets.length > 0 && (
        <section style={{ padding: '0 24px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
            <Text fw={600}>Recent assets</Text>
            <Link href="/" style={{ marginLeft: 'auto', fontSize: 12 }}>
              Browse all →
            </Link>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {p.recent_assets.map((asset) => (
              <img
                key={asset.id}
                src={thumbUrl(asset, 160)}
                alt={asset.name}
                title={asset.name}
                loading="lazy"
                onClick={() => navigate('/')}
                style={{
                  width: 120,
                  height: 120,
                  objectFit: 'cover',
                  borderRadius: 8,
                  cursor: 'pointer',
                  background: 'var(--muted)',
                }}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
