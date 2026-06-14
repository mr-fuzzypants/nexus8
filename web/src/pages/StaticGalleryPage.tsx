import { useState } from 'react';
import { Text } from '@mantine/core';
import type { AssetSummary } from '../api/library';
import { AssetGrid } from '../features/grid/AssetGrid';
import { AssetPanel } from '../features/asset/AssetPanel';

interface StaticGalleryPageProps {
  title: string;
  assets: AssetSummary[];
  emptyMessage: string;
}

export function StaticGalleryPage({ title, assets, emptyMessage }: StaticGalleryPageProps) {
  const [selected, setSelected] = useState<AssetSummary | null>(null);

  return (
    <>
      <header className="search-header">
        <div className="search-toolbar">
          <Text fw={600}>{title}</Text>
          <Text size="xs" c="dimmed">
            {assets.length.toLocaleString()} asset{assets.length === 1 ? '' : 's'}
          </Text>
        </div>
      </header>
      <AssetGrid assets={assets} onOpen={setSelected} emptyMessage={emptyMessage} />
      <AssetPanel asset={selected} onClose={() => setSelected(null)} />
    </>
  );
}
