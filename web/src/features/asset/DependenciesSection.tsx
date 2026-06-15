import { useQuery } from '@tanstack/react-query';
import { Button, Group, Loader, Text } from '@mantine/core';
import { IconArrowsSplit2 } from '@tabler/icons-react';
import { useLocation } from 'wouter';
import { getVersionHistory } from '../../api/versions';
import type { AssetSummary } from '../../api/library';
import { DependencyGraph } from '../graph/DependencyGraph';

interface DependenciesSectionProps {
  asset: AssetSummary;
}

/** Resolve the asset's current version: prefer a "latest" symlink, else highest number. */
export function DependenciesSection({ asset }: DependenciesSectionProps) {
  const [, navigate] = useLocation();
  const history = useQuery({
    queryKey: ['versions', asset.id],
    queryFn: () => getVersionHistory(asset.id),
  });

  const versions = history.data?.versions ?? [];
  const current =
    versions.find((v) => v.symlinks.includes('latest')) ??
    versions.reduce<(typeof versions)[number] | undefined>(
      (best, v) => (!best || v.version_number > best.version_number ? v : best),
      undefined,
    );

  return (
    <section>
      <Group gap={8} mb={8}>
        <Text size="sm" fw={600}>
          Dependencies
        </Text>
        {history.isFetching && <Loader size={14} />}
        <div style={{ flex: 1 }} />
        {current && (
          <Button
            size="compact-xs"
            variant="subtle"
            leftSection={<IconArrowsSplit2 size={13} stroke={1.75} />}
            onClick={() => navigate(`/graph/${current.id}`)}
          >
            Full view
          </Button>
        )}
      </Group>

      {!history.isLoading && !current && (
        <Text size="xs" c="dimmed">
          No versions to analyze yet.
        </Text>
      )}

      {current && (
        <div
          style={{
            height: 320,
            borderRadius: 10,
            overflow: 'hidden',
            border: '1px solid var(--border, rgba(148,163,184,0.18))',
            background: 'rgba(2,6,23,0.6)',
          }}
        >
          <DependencyGraph
            versionId={current.id}
            onOpenEntity={(entityId) => navigate(`/entities/${entityId}`)}
          />
        </div>
      )}
    </section>
  );
}
