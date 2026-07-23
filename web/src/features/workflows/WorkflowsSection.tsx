import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ActionIcon, Badge, Button, Group, Loader, Popover, Stack, Text, Tooltip } from '@mantine/core';
import { IconPlayerPlay, IconSchema, IconStack2 } from '@tabler/icons-react';
import type { AssetSummary } from '../../api/library';
import { getAttachments } from '../../api/intents';
import { getAttachmentsForShot } from './mockApi';
import { FanOutPlanModal } from './FanOutPlanModal';
import { useRunPanelStore } from './runPanelStore';
import type { AssetNode, OutputBinding, WorkflowAttachment } from './types';

export type WorkflowsTarget =
  | { kind: 'asset'; asset: AssetSummary }
  | { kind: 'shot'; shotCode: string; shotName: string };

const MODE_LABELS: Record<WorkflowAttachment['mode'], string> = {
  iterate: 'versions this asset',
  derive: 'creates linked assets',
  custom: 'custom bindings',
};

const NODE_KIND_COLORS: Record<AssetNode['kind'], string> = {
  self: 'teal',
  entity_ref: 'blue',
  asset_query: 'grape',
  output: 'orange',
  pin: 'gray',
};

const TARGET_LABELS: Record<string, string> = {
  new_version_of_self: 'new version of this asset',
  new_asset: 'new asset',
  discard: 'discard',
};

function nodeDescription(node: AssetNode, bindings?: OutputBinding[]): string {
  switch (node.kind) {
    case 'self':
      return node.label;
    case 'entity_ref':
      return `${node.label} · ${node.role}.${node.referenceSlot} @ ${node.policy}`;
    case 'asset_query':
      return `${node.label} · ${node.criteria.process} related to {Character} @ ${node.criteria.ref}`;
    case 'output': {
      const binding = bindings?.find((b) => b.slot === node.slot);
      const dest = binding ? (TARGET_LABELS[binding.target] ?? binding.target) : 'no binding';
      return `${node.slot} → ${dest}`;
    }
    case 'pin':
      return `${node.label} (${node.dataType})`;
  }
}

/** Read-only view of the graph's scanned nexus8 interface — the run form mirrors this. */
function GraphInterfacePopover({ attachment }: { attachment: WorkflowAttachment }) {
  return (
    <Popover width={340} shadow="md" position="bottom-end">
      <Popover.Target>
        <Tooltip label="Graph interface (scanned asset nodes)">
          <ActionIcon variant="subtle" size="sm" aria-label="Graph interface">
            <IconSchema size={14} stroke={1.75} />
          </ActionIcon>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown>
        <Text size="xs" fw={600} mb={6}>
          Graph interface · the run form mirrors these nodes
        </Text>
        <Stack gap={4}>
          {attachment.graph.nodes.map((node) => (
            <Group key={node.id} gap={6} wrap="nowrap">
              <Badge
                size="xs"
                variant="light"
                color={NODE_KIND_COLORS[node.kind]}
                tt="none"
                w={78}
                style={{ flexShrink: 0 }}
              >
                {node.kind.replace('_', ' ')}
              </Badge>
              <Text size="xs" c="dimmed" truncate>
                {nodeDescription(node, attachment.outputs)}
              </Text>
            </Group>
          ))}
        </Stack>
        <Text size="xs" c="dimmed" mt={8}>
          Parameters come from the “{attachment.viewName}” view.
        </Text>
      </Popover.Dropdown>
    </Popover>
  );
}

/** Attached workflows for an asset (Run) or a shot container (fan-out). */
export function WorkflowsSection({ target, onRunOpen }: { target: WorkflowsTarget; onRunOpen?: () => void }) {
  const openRunPanel = useRunPanelStore((s) => s.open);
  const [fanOutOpen, setFanOutOpen] = useState(false);

  const attachments = useQuery({
    queryKey:
      target.kind === 'asset'
        ? ['wf-attachments', 'asset', target.asset.id]
        : ['wf-attachments', 'shot', target.shotCode],
    queryFn: () =>
      target.kind === 'asset'
        ? getAttachments(target.asset.code)
        : getAttachmentsForShot(target.shotCode),
    enabled: true,
  });

  return (
    <div>
      <Group gap={8} mb={8}>
        <Text size="sm" fw={600}>
          Workflows
        </Text>
        {attachments.isFetching && <Loader size={14} />}
      </Group>

      {attachments.error ? (
        <Text size="xs" c="red">
          {String((attachments.error as Error).message ?? attachments.error)}
        </Text>
      ) : !attachments.data || attachments.data.length === 0 ? (
        <Text size="xs" c="dimmed">
          No workflows attached for this process.
        </Text>
      ) : (
        <Stack gap={6}>
          {attachments.data.map((attachment) => (
            <Group
              key={attachment.id}
              gap={8}
              wrap="nowrap"
              style={{
                border: '1px solid var(--border, rgba(148,163,184,0.2))',
                borderRadius: 10,
                padding: '8px 10px',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <Group gap={6}>
                  <Text size="xs" fw={600} truncate>
                    {attachment.workflow.name}
                  </Text>
                  <Badge size="xs" variant="light">
                    v{attachment.workflow.version}
                  </Badge>
                  {attachment.workflow.processes.map((process) => (
                    <Badge key={process} size="xs" variant="outline" color="gray" tt="none">
                      {process}
                    </Badge>
                  ))}
                </Group>
                <Text size="xs" c="dimmed" mt={2}>
                  {target.kind === 'shot'
                    ? 'fan-out · one run per frame'
                    : `${MODE_LABELS[attachment.mode]} · ${attachment.level}-level attachment`}
                </Text>
                {attachment.outputs.length > 0 && (
                  <Group gap={4} mt={3} wrap="wrap">
                    {attachment.outputs.map((b) => (
                      <Text key={b.slot} size="xs" c="dimmed" ff="monospace">
                        {b.slot}
                        <span style={{ opacity: 0.5 }}> → </span>
                        {TARGET_LABELS[b.target] ?? b.target}
                      </Text>
                    ))}
                  </Group>
                )}
              </div>
              <GraphInterfacePopover attachment={attachment} />
              <Button
                size="compact-xs"
                variant="light"
                color="teal"
                leftSection={
                  target.kind === 'shot' ? (
                    <IconStack2 size={13} stroke={1.75} />
                  ) : (
                    <IconPlayerPlay size={13} stroke={1.75} />
                  )
                }
                onClick={() => {
                  if (target.kind === 'shot') {
                    setFanOutOpen(true);
                  } else {
                    onRunOpen?.();
                    openRunPanel(attachment, target.asset);
                  }
                }}
              >
                {target.kind === 'shot' ? 'Run all frames' : 'Run'}
              </Button>
            </Group>
          ))}
        </Stack>
      )}

      {target.kind === 'shot' && (
        <FanOutPlanModal
          shotCode={target.shotCode}
          shotName={target.shotName}
          opened={fanOutOpen}
          onClose={() => setFanOutOpen(false)}
        />
      )}
    </div>
  );
}
