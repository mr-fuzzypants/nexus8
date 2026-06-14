import { useState } from 'react';
import { Link, useParams } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { ActionIcon, Badge, Text, Tooltip } from '@mantine/core';
import { IconArrowLeft } from '@tabler/icons-react';
import { getEntity } from '../../api/intelligence';
import type { AssetSummary } from '../../api/library';
import { AssetGrid } from '../grid/AssetGrid';
import { AssetPanel } from '../asset/AssetPanel';
import { ContainerBrowser } from './ContainerBrowser';

export function EntityPage() {
  const params = useParams<{ id: string }>();
  const entityId = Number(params.id);
  const [selected, setSelected] = useState<AssetSummary | null>(null);

  const entity = useQuery({
    queryKey: ['entity', entityId],
    queryFn: () => getEntity(entityId),
    enabled: Number.isFinite(entityId),
  });

  if (entity.isError) {
    return (
      <div className="empty-state">
        <p>Entity not found.</p>
        <Link href="/entities">Back to entities</Link>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <ContainerBrowser onSelectContainer={() => {}} />
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        <header className="search-header">
          <div className="search-toolbar">
            <Tooltip label="All entities">
              <ActionIcon component={Link} href="/entities" variant="subtle" aria-label="Back">
                <IconArrowLeft size={17} stroke={1.75} />
              </ActionIcon>
            </Tooltip>
            <Text fw={600}>{entity.data?.name ?? '…'}</Text>
            {entity.data && <Badge variant="light">{entity.data.category}</Badge>}
            <Text size="xs" c="dimmed">
              {entity.data?.assets.length ?? 0} related asset
              {(entity.data?.assets.length ?? 0) === 1 ? '' : 's'}
            </Text>
          </div>
        </header>

        <AssetGrid
          assets={entity.data?.assets ?? []}
          onOpen={setSelected}
          emptyMessage="No assets linked yet. Use asset detail to link to entities."
        />
        <AssetPanel asset={selected} onClose={() => setSelected(null)} onOpenAsset={setSelected} />
      </div>
    </div>
  );
}
