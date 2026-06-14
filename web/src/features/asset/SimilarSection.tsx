import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader, SegmentedControl, Text } from '@mantine/core';
import { getSimilar } from '../../api/intelligence';
import type { AssetSummary } from '../../api/library';

interface SimilarSectionProps {
  asset: AssetSummary;
  onOpenAsset: (asset: AssetSummary) => void;
}

export function SimilarSection({ asset, onOpenAsset }: SimilarSectionProps) {
  const [mode, setMode] = useState<'embedding' | 'tags'>('embedding');
  const similar = useQuery({
    queryKey: ['similar', asset.id, mode],
    queryFn: () => getSimilar(asset.id, mode, 9),
  });

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Text size="sm" fw={600}>
          Similar
        </Text>
        <SegmentedControl
          size="xs"
          value={mode}
          onChange={(v) => setMode(v as 'embedding' | 'tags')}
          data={[
            { label: 'Visual', value: 'embedding' },
            { label: 'Tags', value: 'tags' },
          ]}
        />
        {similar.isFetching && <Loader size={14} />}
      </div>
      {similar.data?.results.length === 0 ? (
        <Text size="xs" c="dimmed">
          No similar assets yet{mode === 'embedding' ? ' — AI analysis may still be running.' : '.'}
        </Text>
      ) : (
        <div className="similar-grid">
          {similar.data?.results.map((result) => (
            <button
              key={result.id}
              type="button"
              className="similar-cell"
              title={`${result.name}`}
              onClick={() => onOpenAsset(result)}
            >
              <img
                src={result.thumbnails['256'] || result.file_path}
                alt={result.name}
                loading="lazy"
              />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
