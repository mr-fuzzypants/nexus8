import { useQuery } from '@tanstack/react-query';
import { Text } from '@mantine/core';
import { getRecommendations } from '../../api/versions';
import type { AssetSummary } from '../../api/library';
import { useLibraryStore } from '../../stores/library';

const SEED_COUNT = 5;

/**
 * "Based on your recent activity" — embedding-centroid neighbors of the
 * user's recently viewed assets. Hidden until there is activity to seed it.
 */
export function RecommendationsStrip({ onOpen }: { onOpen: (asset: AssetSummary) => void }) {
  const recents = useLibraryStore((s) => s.recents);
  const seedIds = recents.slice(0, SEED_COUNT).map((a) => a.id);

  const recs = useQuery({
    queryKey: ['recommendations', seedIds.join(',')],
    queryFn: () => getRecommendations(seedIds),
    enabled: seedIds.length > 0,
    staleTime: 5 * 60_000,
  });

  if (!seedIds.length || !recs.data?.results.length) return null;

  return (
    <div className="rec-strip">
      <Text size="xs" fw={600} c="dimmed" mb={6} tt="uppercase" style={{ letterSpacing: '0.06em' }}>
        Based on your recent activity
      </Text>
      <div className="rec-row">
        {recs.data.results.map((asset) => (
          <button
            key={asset.id}
            type="button"
            className="rec-cell"
            title={asset.name}
            onClick={() => onOpen(asset)}
          >
            <img
              src={asset.thumbnails['256'] || asset.file_path}
              alt={asset.ai_description || asset.name}
              loading="lazy"
            />
          </button>
        ))}
      </div>
    </div>
  );
}
