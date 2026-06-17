import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ActionIcon, Badge, Button, Group, Loader, Text, Tooltip } from '@mantine/core';
import { IconArrowsDiff, IconEye, IconUpload } from '@tabler/icons-react';
import clsx from 'clsx';
import {
  getVersionHistory,
  uploadVersion,
  versionImage,
  type VersionNode,
} from '../../api/versions';
import type { AssetSummary } from '../../api/library';
import { useViewerStore } from '../viewer/viewerStore';
import { CompareSlider } from './CompareSlider';

interface VersionsSectionProps {
  asset: AssetSummary;
  onAssetUpdated?: (asset: AssetSummary) => void;
}

export function VersionsSection({ asset, onAssetUpdated }: VersionsSectionProps) {
  const queryClient = useQueryClient();
  const openViewer = useViewerStore((s) => s.open);
  const fileRef = useRef<HTMLInputElement>(null);
  const [comparing, setComparing] = useState(false);
  const [pickedIds, setPickedIds] = useState<number[]>([]);

  const history = useQuery({
    queryKey: ['versions', asset.id],
    queryFn: () => getVersionHistory(asset.id),
  });

  const upload = useMutation({
    mutationFn: (file: File) => uploadVersion(asset.id, file),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['versions', asset.id] });
      queryClient.invalidateQueries({ queryKey: ['library-search'] });
      onAssetUpdated?.(response.asset);
    },
  });

  const versions = history.data?.versions ?? [];
  const picked = pickedIds
    .map((id) => versions.find((v) => v.id === id))
    .filter((v): v is VersionNode => Boolean(v));

  const togglePick = (version: VersionNode) => {
    setPickedIds((ids) => {
      if (ids.includes(version.id)) return ids.filter((id) => id !== version.id);
      return [...ids.slice(-1), version.id];
    });
  };

  return (
    <section>
      <Group gap={8} mb={8}>
        <Text size="sm" fw={600}>
          Versions
        </Text>
        {history.isFetching && <Loader size={14} />}
        <div style={{ flex: 1 }} />
        {versions.length > 1 && (
          <Tooltip label="Pick two versions to compare">
            <Button
              size="compact-xs"
              variant={comparing ? 'light' : 'subtle'}
              leftSection={<IconArrowsDiff size={13} stroke={1.75} />}
              onClick={() => {
                setComparing((v) => !v);
                setPickedIds([]);
              }}
            >
              Compare
            </Button>
          </Tooltip>
        )}
        <Tooltip label="Upload a new version of this asset">
          <ActionIcon
            variant="subtle"
            size="sm"
            loading={upload.isPending}
            onClick={() => fileRef.current?.click()}
            aria-label="Upload new version"
          >
            <IconUpload size={14} stroke={1.75} />
          </ActionIcon>
        </Tooltip>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            if (file) upload.mutate(file);
            e.currentTarget.value = '';
          }}
        />
      </Group>

      {comparing && picked.length === 2 && (
        <CompareSlider
          beforeSrc={versionImage(picked[0])}
          beforeLabel={`v${picked[0].version_number}`}
          afterSrc={versionImage(picked[1])}
          afterLabel={`v${picked[1].version_number}`}
        />
      )}
      {comparing && picked.length < 2 && (
        <Text size="xs" c="dimmed" mb={6}>
          Select {2 - picked.length} more version{picked.length === 1 ? '' : 's'} below.
        </Text>
      )}

      <div className="version-list">
        {versions.map((version) => (
          <div key={version.id} className="version-row-wrap">
            <button
              type="button"
              className={clsx(
                'version-row',
                comparing && pickedIds.includes(version.id) && 'picked',
              )}
              onClick={() => comparing && togglePick(version)}
              style={{ cursor: comparing ? 'pointer' : 'default', width: '100%' }}
            >
              <img src={version.thumbnails['256'] || version.file_path} alt="" loading="lazy" />
              <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                <Group gap={6}>
                  <Badge size="xs" variant="outline">
                    v{version.version_number}
                  </Badge>
                  {version.symlinks.map((name) => (
                    <Badge key={name} size="xs" variant="light">
                      {name}
                    </Badge>
                  ))}
                </Group>
                <Text size="xs" c="dimmed" mt={2}>
                  {new Date(version.created_at).toLocaleString()}
                  {version.created_by ? ` · ${version.created_by}` : ''}
                </Text>
              </div>
            </button>
            <Tooltip label={`View v${version.version_number}`}>
              <ActionIcon
                className="version-row-view"
                variant="subtle"
                size="sm"
                onClick={() => openViewer({ asset, version })}
                aria-label={`View version ${version.version_number}`}
              >
                <IconEye size={14} stroke={1.75} />
              </ActionIcon>
            </Tooltip>
          </div>
        ))}
      </div>

      {(history.data?.derived_from.length ?? 0) > 0 && (
        <Text size="xs" c="dimmed" mt={6}>
          Derived from:{' '}
          {history.data!.derived_from
            .map((edge) => `${edge.entity_name} v${edge.version_number} (${edge.role})`)
            .join(', ')}
        </Text>
      )}
      {(history.data?.derives.length ?? 0) > 0 && (
        <Text size="xs" c="dimmed" mt={2}>
          Used by:{' '}
          {history.data!.derives
            .map((edge) => `${edge.entity_name} v${edge.version_number} (${edge.role})`)
            .join(', ')}
        </Text>
      )}
    </section>
  );
}
