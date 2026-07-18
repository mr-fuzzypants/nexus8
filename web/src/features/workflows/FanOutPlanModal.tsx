import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Group, Loader, Modal, Stack, Text, Tooltip } from '@mantine/core';
import { IconCircleCheck, IconPlayerPlay } from '@tabler/icons-react';
import { getFanOutPlan } from './mockApi';
import type { InputResolution, ResolvedCandidate } from './types';

interface FanOutPlanModalProps {
  shotCode: string;
  shotName: string;
  opened: boolean;
  onClose: () => void;
}

function SharedChip({ candidate }: { candidate: ResolvedCandidate }) {
  return (
    <Group
      gap={6}
      wrap="nowrap"
      style={{
        border: '1px solid var(--border, rgba(148,163,184,0.2))',
        borderRadius: 8,
        padding: '2px 8px 2px 2px',
      }}
    >
      <img
        src={candidate.thumb}
        alt=""
        style={{ width: 24, height: 24, borderRadius: 6, objectFit: 'cover' }}
      />
      <Text size="xs">{candidate.entityName}</Text>
      <Badge size="xs" variant="light">
        v{candidate.version}
      </Badge>
    </Group>
  );
}

function SharedQueryStrip({
  resolution,
  refreshing,
}: {
  resolution: Extract<InputResolution, { status: 'query' }>;
  refreshing: boolean;
}) {
  const MAX = 6;
  if (!resolution.summary) {
    return (
      <Text size="xs" c="dimmed" fs="italic">
        materializes after Character is chosen
      </Text>
    );
  }
  return (
    <Group gap={4} wrap="nowrap">
      {refreshing && <Loader size={12} />}
      {resolution.set.slice(0, MAX).map((item) => (
        <Tooltip key={item.assetCode} label={`${item.assetCode} · v${item.version}`}>
          <img
            src={item.thumb}
            alt=""
            style={{
              width: 24,
              height: 24,
              borderRadius: 5,
              objectFit: 'cover',
              border: '1px solid var(--border, rgba(148,163,184,0.2))',
            }}
          />
        </Tooltip>
      ))}
      {resolution.set.length > MAX && (
        <Badge size="xs" variant="light" color="gray">
          +{resolution.set.length - MAX}
        </Badge>
      )}
      <Text size="xs" c="dimmed" ml={4}>
        {resolution.summary}
      </Text>
    </Group>
  );
}

export function FanOutPlanModal({ shotCode, shotName, opened, onClose }: FanOutPlanModalProps) {
  /** node id → chosen entity code; part of the plan key, so query nodes re-materialize. */
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState(-1); // -1 = not started; else rows completed

  const plan = useQuery({
    queryKey: ['wf-fanout', shotCode, selections],
    queryFn: () => getFanOutPlan(shotCode, selections),
    enabled: opened,
    placeholderData: (previous) => previous,
  });

  useEffect(() => {
    if (!opened) {
      setSelections({});
      setProgress(-1);
    }
  }, [opened]);

  const rows = plan.data?.rows ?? [];
  const running = progress >= 0 && progress < rows.length;
  const finished = rows.length > 0 && progress >= rows.length;

  useEffect(() => {
    if (!running) return;
    const timer = setTimeout(() => setProgress((count) => count + 1), 550);
    return () => clearTimeout(timer);
  }, [running, progress]);

  const ambiguous = (plan.data?.shared ?? []).filter(
    (resolution): resolution is Extract<InputResolution, { status: 'ambiguous' }> =>
      resolution.status === 'ambiguous',
  );
  const ready = ambiguous.every((resolution) => selections[resolution.node.id]);

  const rowStatus = (index: number): 'pending' | 'running' | 'done' => {
    if (progress < 0) return 'pending';
    if (index < progress) return 'done';
    if (index === progress) return 'running';
    return 'pending';
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size={600}
      title={
        <Group gap={8}>
          <Text fw={600} size="sm">
            Run for all frames — {shotName}
          </Text>
          {plan.data && (
            <>
              <Badge size="xs" variant="light">
                {plan.data.attachment.workflow.code} v{plan.data.attachment.workflow.version}
              </Badge>
              <Badge size="xs" variant="outline" color="yellow" tt="none">
                mock
              </Badge>
            </>
          )}
        </Group>
      }
    >
      {plan.isPending ? (
        <Group gap={8} py="md">
          <Loader size={16} />
          <Text size="xs" c="dimmed">
            Scanning graph interface and building per-frame plan…
          </Text>
        </Group>
      ) : !plan.data ? (
        <Text size="xs" c="red">
          Could not build the plan.
        </Text>
      ) : (
        <Stack gap="md">
          <div>
            <Text size="xs" tt="uppercase" c="dimmed" fw={700} mb={6}>
              Shared context (applies to every frame)
            </Text>
            <Stack gap={8}>
              {plan.data.shared.map((resolution) => (
                <Group key={resolution.node.id} gap={6} align="flex-start" wrap="nowrap">
                  <Text size="xs" c="dimmed" style={{ minWidth: 90 }}>
                    {resolution.node.label}
                  </Text>
                  {resolution.status === 'resolved' ? (
                    <Group gap={6}>
                      {resolution.chosen.map((candidate) => (
                        <SharedChip key={candidate.assetCode} candidate={candidate} />
                      ))}
                    </Group>
                  ) : resolution.status === 'ambiguous' ? (
                    <Group gap={6}>
                      {resolution.candidates.map((candidate) => {
                        const selected =
                          selections[resolution.node.id] === candidate.entityCode;
                        return (
                          <Button
                            key={candidate.entityCode}
                            size="compact-xs"
                            variant={selected ? 'light' : 'default'}
                            color="teal"
                            onClick={() =>
                              setSelections((prev) => ({
                                ...prev,
                                [resolution.node.id]: candidate.entityCode,
                              }))
                            }
                          >
                            {candidate.entityName}
                          </Button>
                        );
                      })}
                      {!selections[resolution.node.id] && (
                        <Badge size="xs" color="yellow" variant="light" tt="none">
                          choose
                        </Badge>
                      )}
                    </Group>
                  ) : (
                    <SharedQueryStrip resolution={resolution} refreshing={plan.isFetching} />
                  )}
                </Group>
              ))}
            </Stack>
            <Text size="xs" c="dimmed" mt={6}>
              Pins default off for batch runs.
            </Text>
          </div>

          <div>
            <Text size="xs" tt="uppercase" c="dimmed" fw={700} mb={6}>
              Plan · {rows.length} frames → {rows.length} runs, one batch
            </Text>
            <Stack gap={4}>
              {rows.map((row, index) => {
                const status = rowStatus(index);
                return (
                  <Group
                    key={row.frameCode}
                    gap={8}
                    wrap="nowrap"
                    style={{
                      border: '1px solid var(--border, rgba(148,163,184,0.15))',
                      borderRadius: 8,
                      padding: '4px 8px 4px 4px',
                      opacity: status === 'pending' && progress >= 0 ? 0.65 : 1,
                    }}
                  >
                    <img
                      src={row.thumb}
                      alt=""
                      style={{ width: 34, height: 34, borderRadius: 6, objectFit: 'cover' }}
                    />
                    <Text size="xs" ff="monospace" style={{ minWidth: 110 }}>
                      {row.frameCode}
                    </Text>
                    <Text size="xs" c="dimmed" style={{ flex: 1 }} truncate>
                      → new v{row.outcome.targetVersion}
                    </Text>
                    {status === 'done' ? (
                      <IconCircleCheck
                        size={15}
                        stroke={1.75}
                        color="var(--mantine-color-teal-4)"
                      />
                    ) : status === 'running' ? (
                      <Loader size={13} />
                    ) : (
                      <Badge size="xs" variant="outline" color="gray" tt="none">
                        {progress >= 0 ? 'queued' : 'planned'}
                      </Badge>
                    )}
                  </Group>
                );
              })}
            </Stack>
          </div>

          {finished ? (
            <Text size="xs" c="teal">
              Batch finished — {rows.length} new versions landed, one intent each, grouped under
              one batch. (Mock run: nothing was written.)
            </Text>
          ) : (
            <Group justify="flex-end">
              <Button
                leftSection={<IconPlayerPlay size={15} stroke={1.75} />}
                color="teal"
                disabled={!ready || running}
                loading={running}
                onClick={() => setProgress(0)}
              >
                {ready ? `Run ${rows.length} frames` : 'Choose shared inputs to run'}
              </Button>
            </Group>
          )}
        </Stack>
      )}
    </Modal>
  );
}
