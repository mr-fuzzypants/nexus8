import {
  ActionIcon,
  Anchor,
  Badge,
  Button,
  Drawer,
  Group,
  SegmentedControl,
  Stack,
  TagsInput,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  IconCube,
  IconEdit,
  IconExternalLink,
  IconEye,
  IconHeart,
  IconHeartFilled,
  IconPencil,
  IconShoppingBag,
  IconShoppingBagCheck,
} from '@tabler/icons-react';
import { useLocation } from 'wouter';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  assetIs3DModel,
  assetIsVideo,
  generateImageTo3D,
  imageTo3DPending,
  imageTo3DStatus,
  previewUrl,
  thumbUrl,
  updateAsset,
  type AssetSummary,
  type Gen3DTier,
} from '../../api/library';
import { listMasks } from '../annotator/annotatorApi';
import { useLibraryStore } from '../../stores/library';
import { useBasketStore } from '../../stores/basket';
import { useProject } from '../projects/ProjectContext';
import { useViewerStore } from '../viewer/viewerStore';
import { RelatedSection } from './RelatedSection';
import { SimilarSection } from './SimilarSection';
import { VersionsSection } from './VersionsSection';
import { ProvenanceSection } from './ProvenanceSection';
import { DependenciesSection } from './DependenciesSection';
import { ActivitySection } from './ActivitySection';
import { WorkflowsSection } from '../workflows/WorkflowsSection';
import { RunHistorySection } from '../workflows/RunHistorySection';

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
  versionNumber,
  onOpenAsset,
}: {
  asset: AssetSummary;
  versionNumber?: number | null;
  onOpenAsset?: (asset: AssetSummary) => void;
}) {
  const { data: masks } = useQuery({
    queryKey: ['asset', asset.id, 'masks', versionNumber ?? null],
    queryFn: () => listMasks(asset.id, versionNumber),
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
  const openViewer = useViewerStore((s) => s.open);
  const queryClient = useQueryClient();
  const [selectedVersionNumber, setSelectedVersionNumber] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', tags: [] as string[] });
  const [gen3dTier, setGen3dTier] = useState<Gen3DTier>('balanced');
  // Scope the pending call to its asset id so switching assets naturally disables the poll
  // (no reset-on-change effect needed).
  const [gen3d, setGen3d] = useState<{ assetId: number; callId: string } | null>(null);
  const gen3dHandled = useRef<string | null>(null);
  useEffect(() => {
    setSelectedVersionNumber(null);
    setEditing(false);
  }, [asset?.id]);

  // Image → 3D: dispatch to Modal, then poll until the new 3d_model asset lands.
  const generate3d = useMutation({
    mutationFn: () => {
      if (!asset) throw new Error('no asset');
      return generateImageTo3D(asset.id, { tier: gen3dTier });
    },
    onSuccess: (d) => {
      if (asset) setGen3d({ assetId: asset.id, callId: d.call_id });
    },
  });
  // Resume-after-refresh: call ids only live in memory, but the backend persists in-flight
  // jobs on the asset. On open we ask for any still-running call and adopt it, so a reload
  // (or a job that finished while away) still lands its result.
  const isImage = asset?.media_type === 'image';
  const pendingQuery = useQuery({
    queryKey: ['image-to-3d-pending', asset?.id],
    queryFn: () => imageTo3DPending(asset!.id),
    enabled: Boolean(asset && isImage),
  });
  // A fresh dispatch this session wins; otherwise adopt the server's persisted pending call.
  const activeCall = useMemo(() => {
    if (gen3d && asset && gen3d.assetId === asset.id) return gen3d;
    if (asset && pendingQuery.data?.call_id) {
      return { assetId: asset.id, callId: pendingQuery.data.call_id };
    }
    return null;
  }, [gen3d, asset, pendingQuery.data]);
  const gen3dPoll = useQuery({
    queryKey: ['image-to-3d', activeCall?.assetId, activeCall?.callId],
    queryFn: () => imageTo3DStatus(activeCall!.assetId, activeCall!.callId),
    enabled: Boolean(activeCall),
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s === 'done' || s === 'error' ? false : 4000;
    },
  });
  useEffect(() => {
    const data = gen3dPoll.data;
    if (!activeCall || !data || data.status !== 'done' || !data.result) return;
    // Fire once per call: ref guard avoids re-opening on incidental re-renders.
    if (gen3dHandled.current === activeCall.callId) return;
    gen3dHandled.current = activeCall.callId;
    queryClient.invalidateQueries({ queryKey: ['library-search'] });
    queryClient.invalidateQueries({ queryKey: ['image-to-3d-pending', activeCall.assetId] });
    openViewer({ asset: data.result });
  }, [gen3dPoll.data, activeCall, openViewer, queryClient]);
  const gen3dStatus = activeCall ? gen3dPoll.data?.status : undefined;
  const gen3dWorking =
    generate3d.isPending || (Boolean(activeCall) && gen3dStatus !== 'done' && gen3dStatus !== 'error');

  const save = useMutation({
    mutationFn: () => {
      if (!asset) throw new Error('no asset');
      return updateAsset(asset.id, {
        name: form.name.trim() || asset.name,
        description: form.description,
        tags: form.tags,
      });
    },
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['library-search'] });
      queryClient.invalidateQueries({ queryKey: ['asset', updated.id] });
      setEditing(false);
      onOpenAsset?.(updated);
    },
  });

  function startEditing() {
    if (!asset) return;
    setForm({
      name: asset.name,
      description: asset.description ?? '',
      tags: asset.user_tags ?? [],
    });
    setEditing(true);
  }

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
            <Tooltip label="Edit details">
              <ActionIcon
                variant={editing ? 'light' : 'subtle'}
                color="teal"
                onClick={editing ? () => setEditing(false) : startEditing}
                aria-label="Edit asset details"
              >
                <IconEdit size={17} stroke={1.75} />
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

          {(asset.media_type === 'image' || assetIsVideo(asset) || assetIs3DModel(asset)) && (
            <Group gap="xs" grow>
              <Button
                variant="default"
                leftSection={<IconEye size={16} stroke={1.75} />}
                onClick={() => openViewer({ asset })}
              >
                View
              </Button>
              <Button
                variant="light"
                color="teal"
                leftSection={<IconPencil size={16} stroke={1.75} />}
                onClick={() => navigate(`~/p/${code}/annotate/${asset.id}`)}
              >
                {assetIs3DModel(asset)
                  ? 'Annotate 3D model'
                  : assetIsVideo(asset)
                    ? 'Annotate video'
                    : 'Annotate & mask'}
              </Button>
            </Group>
          )}

          {asset.media_type === 'image' && (
            <Stack gap={6}>
              <Group gap="xs" grow align="flex-end">
                <SegmentedControl
                  size="xs"
                  value={gen3dTier}
                  onChange={(v) => setGen3dTier(v as Gen3DTier)}
                  disabled={gen3dWorking}
                  data={[
                    { label: 'Fast', value: 'fast' },
                    { label: 'Balanced', value: 'balanced' },
                    { label: 'Max', value: 'max' },
                  ]}
                />
                <Button
                  color="grape"
                  leftSection={<IconCube size={16} stroke={1.75} />}
                  loading={gen3dWorking}
                  onClick={() => generate3d.mutate()}
                >
                  Generate 3D
                </Button>
              </Group>
              {gen3dWorking && (
                <Text size="xs" c="dimmed">
                  Generating a 3D model… this can take a minute (longer on the first run).
                </Text>
              )}
              {generate3d.isError && (
                <Text size="xs" c="red">
                  Could not start generation.
                </Text>
              )}
              {gen3dStatus === 'error' && (
                <Text size="xs" c="red">
                  {gen3dPoll.data?.detail || 'Generation failed.'}
                </Text>
              )}
            </Stack>
          )}

          {editing ? (
            <Stack gap="sm">
              <TextInput
                label="Name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.currentTarget.value }))}
              />
              <Textarea
                label="Description"
                autosize
                minRows={2}
                maxRows={6}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.currentTarget.value }))}
              />
              <TagsInput
                label="Tags"
                description="AI-suggested tags are shown separately and can't be edited here."
                value={form.tags}
                onChange={(tags) => setForm((f) => ({ ...f, tags }))}
                clearable
              />
              {save.isError && (
                <Text size="xs" c="red">
                  Couldn’t save changes. Please try again.
                </Text>
              )}
              <Group gap="xs" justify="flex-end">
                <Button variant="subtle" color="gray" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
                <Button color="teal" loading={save.isPending} onClick={() => save.mutate()}>
                  Save
                </Button>
              </Group>
            </Stack>
          ) : (
            <>
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
            </>
          )}

          {asset.media_type === 'image' && (
            <MasksSection
              asset={asset}
              versionNumber={selectedVersionNumber}
              onOpenAsset={onOpenAsset}
            />
          )}
          <RelatedSection asset={asset} />
          <SimilarSection asset={asset} onOpenAsset={(a) => onOpenAsset?.(a)} />
          <VersionsSection
            asset={asset}
            onAssetUpdated={(a) => { setSelectedVersionNumber(null); onOpenAsset?.(a); }}
            selectedVersionNumber={selectedVersionNumber}
            onVersionSelect={setSelectedVersionNumber}
          />
          <ProvenanceSection asset={asset} />
          <WorkflowsSection target={{ kind: 'asset', asset }} onRunOpen={onClose} />
          <RunHistorySection asset={asset} />
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
