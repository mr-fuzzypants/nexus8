import { useState } from 'react';
import { ActionIcon, Badge, Group, Loader, Stack, Text, Tooltip } from '@mantine/core';
import { IconRefresh } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cloneIntent, dispatchIntent, listIntents } from '../../api/intents';
import type { AssetSummary } from '../../api/library';

const STATUS_COLOR: Record<string, string> = {
  succeeded: 'teal',
  failed: 'red',
  running: 'yellow',
  queued: 'yellow',
  cancelled: 'gray',
  pending: 'gray',
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function ReproduceButton({ intentId, assetCode }: { intentId: string; assetCode: string }) {
  const qc = useQueryClient();
  const [done, setDone] = useState(false);

  const reproduce = useMutation({
    mutationFn: async () => {
      const clone = await cloneIntent(intentId);
      await dispatchIntent(clone.id);
      return clone;
    },
    onSuccess: () => {
      setDone(true);
      qc.invalidateQueries({ queryKey: ['intents', assetCode] });
    },
  });

  return (
    <Tooltip label={done ? 'Reproduced — check run history' : 'Reproduce this exact run (clone intent + dispatch)'}>
      <ActionIcon
        variant="subtle"
        size="sm"
        loading={reproduce.isPending}
        color={done ? 'teal' : 'gray'}
        onClick={() => reproduce.mutate()}
        aria-label="Reproduce"
      >
        <IconRefresh size={13} stroke={1.75} />
      </ActionIcon>
    </Tooltip>
  );
}

export function RunHistorySection({ asset }: { asset: AssetSummary }) {
  const { data: intents, isLoading } = useQuery({
    queryKey: ['intents', asset.code],
    queryFn: () => listIntents(asset.code),
    refetchInterval: 10_000,
  });

  if (isLoading) return null;
  if (!intents || intents.length === 0) return null;

  return (
    <div style={{ padding: '12px 16px 0' }}>
      <Group gap={8} mb={8}>
        <Text size="sm" fw={600}>
          Run history
        </Text>
        <Text size="xs" c="dimmed">
          {intents.length} intent{intents.length === 1 ? '' : 's'}
        </Text>
      </Group>
      <Stack gap={4}>
        {intents.slice(0, 8).map((intent) => (
          <Group
            key={intent.id}
            gap={8}
            wrap="nowrap"
            style={{
              border: '1px solid var(--border, rgba(148,163,184,0.2))',
              borderRadius: 8,
              padding: '5px 10px',
            }}
          >
            <Badge
              size="xs"
              variant="light"
              color={STATUS_COLOR[intent.status] ?? 'gray'}
              tt="none"
            >
              {intent.status}
            </Badge>
            {(intent.status === 'queued' || intent.status === 'running') && (
              <Loader size={10} />
            )}
            <Text size="xs" ff="monospace" c="dimmed" truncate style={{ flex: 1 }}>
              {intent.engineRunId || `intent-${intent.id}`}
            </Text>
            <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
              {intent.createdAt ? timeAgo(intent.createdAt) : ''}
            </Text>
            {(intent.status === 'succeeded' || intent.status === 'failed') && (
              <ReproduceButton intentId={intent.id} assetCode={asset.code} />
            )}
          </Group>
        ))}
      </Stack>
    </div>
  );
}
