import { ActionIcon, Anchor, Badge, Button, Drawer, Group, Stack, Text, Tooltip } from '@mantine/core';
import {
  IconExternalLink,
  IconHeart,
  IconHeartFilled,
  IconPencil,
  IconShoppingBag,
  IconShoppingBagCheck,
} from '@tabler/icons-react';
import { useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { previewUrl, thumbUrl, type AssetSummary } from '../../api/library';
import { listMasks } from '../annotator/annotatorApi';
import { useLibraryStore } from '../../stores/library';
import { useBasketStore } from '../../stores/basket';
import { useProject } from '../projects/ProjectContext';
import { RelatedSection } from './RelatedSection';
import { SimilarSection } from './SimilarSection';
import { VersionsSection } from './VersionsSection';
import { DependenciesSection } from './DependenciesSection';
import { ActivitySection } from './ActivitySection';

interface AssetPanelProps {
  asset: AssetSummary | null;
  onClose: () => void;
  onTagClick?: (tag: string) => void;
  onOpenAsset?: (asset: AssetSummary) => void;
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'AI analysis pending',
  processing: 'AI analysis running',
  completed: 'AI analyzed',
  failed: 'AI analysis failed',
  skipped: 'AI analysis skipped',
};

function MasksSection({
  asset,
  onOpenAsset,
}: {
  asset: AssetSummary;
  onOpenAsset?: (asset: AssetSummary) => void;
}) {
  const { data: masks } = useQuery({
    queryKey: ['asset', asset.id, 'masks'],
    queryFn: () => listMasks(asset.id),
  });

  if (!masks || masks.length === 0) {
    return null;
  }

  return (
    <Stack gap={6}>
      <Text size="xs" tt="uppercase" c="dimmed" fw={700}>
        Masks ({masks.length})
      </Text>
      <Group gap={8}>
        {masks.map((mask) => (
          <img
            key={mask.id}
            src={thumbUrl(mask, 96)}
            alt={mask.name}
            title={mask.name}
            onClick={() => onOpenAsset?.(mask)}
            style={{
              width: 72,
              height: 72,
              objectFit: 'cover',
              borderRadius: 8,
              border: '1px solid var(--border, rgba(148,163,184,0.2))',
              cursor: onOpenAsset ? 'pointer' : undefined,
              background: 'rgba(2,6,23,0.6)',
            }}
          />
        ))}
      </Group>
    </Stack>
  );
}

export function AssetPanel({ asset, onClose, onTagClick, onOpenAsset }: AssetPanelProps) {
  const isFavorite = useLibraryStore((s) => (asset ? Boolean(s.favorites[asset.id]) : false));
  const toggleFavorite = useLibraryStore((s) => s.toggleFavorite);
  const inBasket = useBasketStore((s) =>
    asset ? s.items.some((i) => i.asset.id === asset.id) : false,
  );
  const addToBasket = useBasketStore((s) => s.add);
  const removeFromBasket = useBasketStore((s) => s.remove);
  const [, navigate] = useLocation();
  const { code } = useProject();

  return (
    <Drawer
      opened={asset !== null}
      onClose={onClose}
      position="right"
      size={480}
      title={
        <Text fw={600} size="sm">
          {asset?.name}
        </Text>
      }
      overlayProps={{ backgroundOpacity: 0.45, blur: 3 }}
    >
      {asset && (
        <Stack gap="md">
          {previewUrl(asset) && (
            <div className="asset-panel-hero">
              <img src={previewUrl(asset)} alt={asset.ai_description || asset.name} />
            </div>
          )}

          <Group gap="xs">
            <Tooltip label={inBasket ? 'Remove from basket' : 'Add to basket'}>
              <ActionIcon
                variant={inBasket ? 'light' : 'subtle'}
                color="teal"
                onClick={() => (inBasket ? removeFromBasket(asset.id) : addToBasket(asset))}
                aria-label="Toggle basket"
              >
                {inBasket ? (
                  <IconShoppingBagCheck size={17} stroke={1.75} />
                ) : (
                  <IconShoppingBag size={17} stroke={1.75} />
                )}
              </ActionIcon>
            </Tooltip>
            <Tooltip label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}>
              <ActionIcon
                variant={isFavorite ? 'light' : 'subtle'}
                color="teal"
                onClick={() => toggleFavorite(asset)}
                aria-label="Toggle favorite"
              >
                {isFavorite ? <IconHeartFilled size={17} /> : <IconHeart size={17} stroke={1.75} />}
              </ActionIcon>
            </Tooltip>
            <Anchor href={asset.file_path} target="_blank" rel="noreferrer" size="xs" c="dimmed">
              <Group gap={4}>
                <IconExternalLink size={14} />
                Open original
              </Group>
            </Anchor>
            <Badge variant="light" color={asset.ai_analysis_status === 'completed' ? 'teal' : 'gray'}>
              {STATUS_LABELS[asset.ai_analysis_status] ?? asset.ai_analysis_status}
            </Badge>
          </Group>

          {(asset.media_type === 'image' || asset.media_type === 'video') && (
            <Button
              variant="light"
              color="teal"
              leftSection={<IconPencil size={16} stroke={1.75} />}
              onClick={() => navigate(`~/p/${code}/annotate/${asset.id}`)}
            >
              {asset.media_type === 'video' ? 'Annotate video' : 'Annotate & mask'}
            </Button>
          )}

          {(asset.ai_description || asset.description) && (
            <Text size="sm" c="dimmed">
              {asset.ai_description || asset.description}
            </Text>
          )}

          {asset.tags.length > 0 && (
            <Group gap={6}>
              {asset.tags.map((tag) => (
                <Badge
                  key={tag}
                  variant="light"
                  style={{ cursor: onTagClick ? 'pointer' : undefined, textTransform: 'none' }}
                  onClick={() => onTagClick?.(tag)}
                >
                  {tag}
                </Badge>
              ))}
            </Group>
          )}

          {asset.media_type === 'image' && <MasksSection asset={asset} onOpenAsset={onOpenAsset} />}
          <RelatedSection asset={asset} />
          <SimilarSection asset={asset} onOpenAsset={(a) => onOpenAsset?.(a)} />
          <VersionsSection asset={asset} onAssetUpdated={(a) => onOpenAsset?.(a)} />
          <DependenciesSection asset={asset} />
          <ActivitySection asset={asset} />

          <dl className="meta-grid">
            <dt>ID</dt>
            <dd>{asset.id}</dd>
            <dt>Code</dt>
            <dd>{asset.code}</dd>
            <dt>Type</dt>
            <dd>{asset.media_type || '—'}</dd>
            <dt>Dimensions</dt>
            <dd>{asset.width && asset.height ? `${asset.width} × ${asset.height}` : '—'}</dd>
            <dt>Added</dt>
            <dd>{new Date(asset.created_at).toLocaleString()}</dd>
            <dt>File path</dt>
            <dd style={{ wordBreak: 'break-all' }}>{asset.file_path || '—'}</dd>
          </dl>
        </Stack>
      )}
    </Drawer>
  );
}
