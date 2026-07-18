import { useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  ActionIcon,
  Badge,
  Button,
  Checkbox,
  Drawer,
  Group,
  Loader,
  NumberInput,
  Slider,
  Stack,
  Text,
  Textarea,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import {
  IconArrowBackUp,
  IconArrowRight,
  IconDice5,
  IconDragDrop,
  IconPlayerPlay,
  IconX,
} from '@tabler/icons-react';
import { getVersionHistory } from '../../api/versions';
import { createIntent as apiCreateIntent, dispatchIntent, getIntent, resolve as apiResolve } from '../../api/intents';
import { placeholderThumb } from './fixtures';
import { dragAccepted, readAssetDrag, type DraggedAsset } from './dnd';
import { useRunPanelStore } from './runPanelStore';
import type {
  AcceptedMedia,
  InputResolution,
  ResolvedCandidate,
  RunIntent,
} from './types';
import { useRunTrace } from './useRunTrace';

interface ListEdit {
  added: DraggedAsset[];
  removed: string[];
}

/** Wraps an input row as a drop target with in-flight accept/reject styling. */
function DropRow({
  accepts,
  dragging,
  disabled,
  onDropAsset,
  children,
}: {
  accepts: AcceptedMedia;
  dragging: boolean;
  disabled?: boolean;
  onDropAsset: (asset: DraggedAsset) => void;
  children: ReactNode;
}) {
  const [hover, setHover] = useState<'valid' | 'invalid' | null>(null);

  const border = hover === 'valid'
    ? '1.5px dashed var(--mantine-color-teal-5)'
    : hover === 'invalid'
      ? '1.5px dashed var(--mantine-color-red-6)'
      : dragging && !disabled
        ? '1.5px dashed rgba(148,163,184,0.45)'
        : '1.5px dashed transparent';

  return (
    <div
      style={{ border, borderRadius: 10, padding: 4, transition: 'border-color 80ms' }}
      onDragOver={(event: DragEvent) => {
        if (disabled) return;
        const valid = dragAccepted(event, accepts);
        if (dragAccepted(event, 'any')) {
          event.preventDefault();
          event.dataTransfer.dropEffect = valid ? 'copy' : 'none';
          setHover(valid ? 'valid' : 'invalid');
        }
      }}
      onDragLeave={() => setHover(null)}
      onDrop={(event: DragEvent) => {
        setHover(null);
        if (disabled) return;
        event.preventDefault();
        const asset = readAssetDrag(event);
        if (asset && dragAccepted(event, accepts)) onDropAsset(asset);
      }}
    >
      {children}
    </div>
  );
}

function CandidateChip({ candidate }: { candidate: ResolvedCandidate }) {
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
        style={{ width: 26, height: 26, borderRadius: 6, objectFit: 'cover' }}
      />
      <Text size="xs" ff="monospace" truncate maw={150}>
        {candidate.assetCode}
      </Text>
      <Badge size="xs" variant="light">
        v{candidate.version}
      </Badge>
      <Badge size="xs" variant="outline" color="gray" tt="none">
        {candidate.policy}
      </Badge>
    </Group>
  );
}

/** A dropped-asset chip: manual override of a resolved/ambiguous input. */
function OverrideChip({ asset, onRevert }: { asset: DraggedAsset; onRevert: () => void }) {
  return (
    <Group
      gap={6}
      wrap="nowrap"
      style={{
        border: '1px solid var(--mantine-color-teal-7)',
        borderRadius: 8,
        padding: '2px 4px 2px 2px',
        background: 'rgba(20,184,166,0.06)',
      }}
    >
      <img
        src={asset.thumb}
        alt=""
        style={{ width: 26, height: 26, borderRadius: 6, objectFit: 'cover' }}
      />
      <Text size="xs" ff="monospace" truncate maw={140}>
        {asset.code}
      </Text>
      <Badge size="xs" variant="light" color="teal" tt="none">
        manual
      </Badge>
      <Badge size="xs" variant="outline" color="gray" tt="none">
        latest
      </Badge>
      <Tooltip label="Revert to resolved input">
        <ActionIcon variant="subtle" size="xs" onClick={onRevert} aria-label="Revert override">
          <IconArrowBackUp size={12} stroke={1.75} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}

function AmbiguousPicker({
  resolution,
  value,
  onChange,
}: {
  resolution: Extract<InputResolution, { status: 'ambiguous' }>;
  value: string | null;
  onChange: (entityCode: string) => void;
}) {
  return (
    <Group gap={8}>
      {resolution.candidates.map((candidate) => {
        const selected = value === candidate.entityCode;
        return (
          <UnstyledButton
            key={candidate.entityCode}
            onClick={() => onChange(candidate.entityCode)}
            style={{
              border: selected
                ? '1.5px solid var(--mantine-color-teal-5)'
                : '1px solid var(--border, rgba(148,163,184,0.25))',
              borderRadius: 10,
              padding: 6,
              background: selected ? 'rgba(20,184,166,0.08)' : 'transparent',
            }}
          >
            <Group gap={8} wrap="nowrap">
              <img
                src={candidate.thumb}
                alt=""
                style={{ width: 40, height: 40, borderRadius: 8, objectFit: 'cover' }}
              />
              <div>
                <Text size="xs" fw={600}>
                  {candidate.entityName}
                </Text>
                <Text size="xs" c="dimmed">
                  {candidate.referenceSlot} v{candidate.version} · {candidate.policy}
                </Text>
              </div>
            </Group>
          </UnstyledButton>
        );
      })}
    </Group>
  );
}

interface StripItem {
  key: string;
  label: string;
  thumb: string;
  manual: boolean;
}

/** Materialized query set + manual edits: removable items, droppable to add. */
function QuerySetRow({
  resolution,
  edit,
  refreshing,
  onRemove,
}: {
  resolution: Extract<InputResolution, { status: 'query' }>;
  edit: ListEdit;
  refreshing: boolean;
  onRemove: (key: string) => void;
}) {
  if (!resolution.summary) {
    return (
      <Text size="xs" c="dimmed" fs="italic">
        materializes after {'{'}Character{'}'} is chosen — or drop assets to add manually
      </Text>
    );
  }
  const items: StripItem[] = [
    ...resolution.set
      .filter((item) => !edit.removed.includes(item.assetCode))
      .map((item) => ({
        key: item.assetCode,
        label: `${item.assetCode} · v${item.version}`,
        thumb: item.thumb,
        manual: false,
      })),
    ...edit.added.map((asset) => ({
      key: asset.code,
      label: `${asset.code} · latest · manual`,
      thumb: asset.thumb,
      manual: true,
    })),
  ];
  const edited = edit.added.length > 0 || edit.removed.length > 0;
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <Group gap={6} justify="flex-end" mb={4}>
        {refreshing && <Loader size={12} />}
        <Text size="xs" c="dimmed">
          {resolution.summary}
        </Text>
        {edited && (
          <Badge size="xs" variant="light" color="teal" tt="none">
            edited · {items.length} in list
          </Badge>
        )}
      </Group>
      <Group gap={6} justify="flex-end">
        {items.map((item) => (
          <div key={item.key} className="wf-strip-item">
            <Tooltip label={item.label}>
              <img
                src={item.thumb}
                alt=""
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 6,
                  objectFit: 'cover',
                  display: 'block',
                  border: item.manual
                    ? '1.5px solid var(--mantine-color-teal-6)'
                    : '1px solid var(--border, rgba(148,163,184,0.2))',
                }}
              />
            </Tooltip>
            <ActionIcon
              className="wf-strip-remove"
              size={14}
              radius="xl"
              color="red"
              variant="filled"
              onClick={() => onRemove(item.key)}
              aria-label={`Remove ${item.key}`}
            >
              <IconX size={9} stroke={2.5} />
            </ActionIcon>
          </div>
        ))}
      </Group>
    </div>
  );
}

/**
 * Global run panel: a non-blocking side drawer (no overlay, no focus trap),
 * so the whole app behind it stays browsable — assets can be dragged in from
 * any grid, the basket, or an entity page.
 */
export function RunWorkflowPanel() {
  const { attachment, asset, dragging, close } = useRunPanelStore();
  const opened = attachment !== null && asset !== null;

  const history = useQuery({
    queryKey: ['versions', asset?.id],
    queryFn: () => getVersionHistory(asset!.id),
    enabled: opened,
  });
  const nextVersion = useMemo(() => {
    const versions = history.data?.versions;
    if (!versions || versions.length === 0) return 2;
    return Math.max(...versions.map((v) => v.version_number)) + 1;
  }, [history.data]);

  /** node id → chosen entity code; part of the resolve key, so query nodes re-materialize. */
  const [selections, setSelections] = useState<Record<string, string>>({});
  /** node id → dropped asset replacing the resolved input. */
  const [overrides, setOverrides] = useState<Record<string, DraggedAsset>>({});
  /** node id → manual add/remove edits to a list input. */
  const [listEdits, setListEdits] = useState<Record<string, ListEdit>>({});
  const [armedPins, setArmedPins] = useState<Record<string, boolean>>({});
  const [prompt, setPrompt] = useState('');
  const [denoise, setDenoise] = useState(0.5);
  const [seed, setSeed] = useState(0);
  const [intentId, setIntentId] = useState<string | null>(null);
  const [engineRunId, setEngineRunId] = useState<string | null>(null);

  const polledIntent = useQuery({
    queryKey: ['intent', intentId],
    queryFn: () => getIntent(intentId!),
    enabled: intentId !== null,
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s === 'succeeded' || s === 'failed' || s === 'cancelled' ? false : 2000;
    },
  });
  const intent = polledIntent.data ?? null;

  const trace = useRunTrace(engineRunId);
  const traceFinishedRef = useRef(false);
  useEffect(() => {
    if (trace.finished && !traceFinishedRef.current) {
      traceFinishedRef.current = true;
      polledIntent.refetch();
    }
  }, [trace.finished, polledIntent]);

  const proposal = useQuery({
    queryKey: ['wf-resolve', attachment?.id, asset?.id, selections],
    queryFn: () => apiResolve(Number(attachment!.id), asset!.code, selections),
    enabled: opened && history.isFetched,
    placeholderData: (previous) => previous,
  });

  // Reset per-run state whenever the panel targets a different attachment/asset.
  useEffect(() => {
    setSelections({});
    setOverrides({});
    setListEdits({});
    setArmedPins({});
    setIntentId(null);
    setEngineRunId(null);
    const view =
      attachment?.graph.views.find((v) => v.name === attachment.viewName) ??
      attachment?.graph.views[0];
    setPrompt(String(view?.params[0]?.default ?? ''));
    setDenoise(Number(view?.params[1]?.default ?? 0.5));
    setSeed(Number(view?.params[2]?.default ?? 0));
  }, [attachment, asset]);

  const run = useMutation({
    mutationFn: async () => {
      const armed = Object.entries(armedPins)
        .filter(([, on]) => on)
        .map(([label]) => label);
      const intent = await apiCreateIntent({
        attachmentId: Number(attachment!.id),
        targetAssetCode: asset!.code,
        selections,
        params: { prompt, denoise },
        seed,
        armedPins: armed,
      });
      const dispatched = await dispatchIntent(intent.id);
      return { intent, engineRunId: dispatched.engineRunId };
    },
    onSuccess: ({ intent: created, engineRunId: eid }) => {
      traceFinishedRef.current = false;
      setIntentId(created.id);
      setEngineRunId(eid || null);
    },
  });

  const finished =
    intent?.status === 'succeeded' ||
    intent?.status === 'failed' ||
    intent?.status === 'cancelled';

  const ambiguous = (proposal.data?.inputs ?? []).filter(
    (resolution) => resolution.status === 'ambiguous',
  );
  const ready = ambiguous.every(
    (resolution) => selections[resolution.node.id] || overrides[resolution.node.id],
  );
  const plannedOutcomes = proposal.data?.outcomes ?? [];
  const primaryOutcome = plannedOutcomes[0];
  const secondaryOutcomes = plannedOutcomes.slice(1);

  const editFor = (nodeId: string): ListEdit => listEdits[nodeId] ?? { added: [], removed: [] };

  const dropOnList = (nodeId: string, dropped: DraggedAsset) =>
    setListEdits((prev) => {
      const edit = prev[nodeId] ?? { added: [], removed: [] };
      if (edit.added.some((a) => a.code === dropped.code)) return prev;
      return {
        ...prev,
        [nodeId]: {
          removed: edit.removed.filter((code) => code !== dropped.code),
          added: [...edit.added, dropped],
        },
      };
    });

  const removeFromList = (nodeId: string, key: string, materialized: boolean) =>
    setListEdits((prev) => {
      const edit = prev[nodeId] ?? { added: [], removed: [] };
      return {
        ...prev,
        [nodeId]: materialized
          ? { ...edit, removed: [...edit.removed, key] }
          : { ...edit, added: edit.added.filter((a) => a.code !== key) },
      };
    });

  return (
    <Drawer
      opened={opened}
      onClose={close}
      position="right"
      size={540}
      withOverlay={false}
      lockScroll={false}
      trapFocus={false}
      closeOnClickOutside={false}
      closeOnEscape={false}
      zIndex={400}
      title={
        attachment && (
          <Group gap={8}>
            <Text fw={600} size="sm">
              {attachment.workflow.name}
            </Text>
            <Badge size="xs" variant="light">
              v{attachment.workflow.version}
            </Badge>
            <Badge size="xs" variant="outline" color="gray" tt="none">
              {attachment.workflow.engine}
            </Badge>
          </Group>
        )
      }
    >
      {!opened ? null : proposal.isPending ? (
        <Group gap={8} py="md">
          <Loader size={16} />
          <Text size="xs" c="dimmed">
            Scanning graph interface and resolving from shot context…
          </Text>
        </Group>
      ) : !proposal.data ? (
        <Text size="xs" c="red">
          Could not resolve this run.
        </Text>
      ) : intent === null ? (
        <Stack gap="md">
          <Group
            gap={8}
            style={{
              border: dragging
                ? '1px solid var(--mantine-color-teal-6)'
                : '1px solid var(--border, rgba(148,163,184,0.2))',
              background: dragging ? 'rgba(20,184,166,0.07)' : 'rgba(148,163,184,0.05)',
              borderRadius: 10,
              padding: '6px 10px',
            }}
          >
            <IconDragDrop size={15} stroke={1.75} color="var(--mantine-color-teal-4)" />
            <Text size="xs" c={dragging ? 'teal' : 'dimmed'}>
              {dragging
                ? 'Drop on an input to bind it'
                : 'Drag any asset from the library, an entity page, or the basket onto an input.'}
            </Text>
          </Group>

          <div>
            <Group gap={6} mb={6}>
              <Text size="xs" tt="uppercase" c="dimmed" fw={700}>
                Inputs
              </Text>
              <Text size="xs" c="dimmed">
                · from graph asset nodes
                {proposal.data.contextLabel && `, resolved from ${proposal.data.contextLabel}`}
              </Text>
            </Group>
            <Stack gap={4}>
              {proposal.data.inputs.map((resolution) => {
                const nodeId = resolution.node.id;
                const override = overrides[nodeId];
                const isList = resolution.status === 'query';
                return (
                  <DropRow
                    key={nodeId}
                    accepts={resolution.node.accepts}
                    dragging={dragging}
                    onDropAsset={(dropped) =>
                      isList ? dropOnList(nodeId, dropped) : (
                        setOverrides((prev) => ({ ...prev, [nodeId]: dropped }))
                      )
                    }
                  >
                    <Group gap={6} justify="space-between" align="flex-start" wrap="nowrap">
                      <Group gap={4} style={{ minWidth: 90 }}>
                        <Text size="xs" c="dimmed">
                          {resolution.node.label}
                        </Text>
                        {resolution.status === 'ambiguous' && !override && (
                          <Badge size="xs" color="yellow" variant="light" tt="none">
                            choose
                          </Badge>
                        )}
                        {resolution.status === 'query' && (
                          <Badge size="xs" color="gray" variant="outline" tt="none">
                            query
                          </Badge>
                        )}
                      </Group>
                      {isList && resolution.status === 'query' ? (
                        <QuerySetRow
                          resolution={resolution}
                          edit={editFor(nodeId)}
                          refreshing={proposal.isFetching}
                          onRemove={(key) =>
                            removeFromList(
                              nodeId,
                              key,
                              resolution.set.some((item) => item.assetCode === key),
                            )
                          }
                        />
                      ) : override ? (
                        <Group gap={6} justify="flex-end" style={{ flex: 1 }}>
                          <OverrideChip
                            asset={override}
                            onRevert={() =>
                              setOverrides((prev) => {
                                const next = { ...prev };
                                delete next[nodeId];
                                return next;
                              })
                            }
                          />
                        </Group>
                      ) : resolution.status === 'resolved' ? (
                        <Group gap={6} justify="flex-end" style={{ flex: 1 }}>
                          {resolution.chosen.map((candidate) => (
                            <CandidateChip key={candidate.assetCode} candidate={candidate} />
                          ))}
                        </Group>
                      ) : resolution.status === 'ambiguous' ? (
                        <AmbiguousPicker
                          resolution={resolution}
                          value={selections[nodeId] ?? null}
                          onChange={(entityCode) =>
                            setSelections((prev) => ({ ...prev, [nodeId]: entityCode }))
                          }
                        />
                      ) : null}
                    </Group>
                  </DropRow>
                );
              })}
            </Stack>
          </div>

          <div>
            <Text size="xs" tt="uppercase" c="dimmed" fw={700} mb={6}>
              Parameters · {proposal.data.viewName} view
            </Text>
            <Stack gap={8}>
              <Textarea
                label="Prompt"
                size="xs"
                autosize
                minRows={2}
                value={prompt}
                onChange={(event) => setPrompt(event.currentTarget.value)}
              />
              <div>
                <Text size="xs" mb={4}>
                  Denoise · {denoise.toFixed(2)}
                </Text>
                <Slider
                  size="sm"
                  min={0}
                  max={1}
                  step={0.05}
                  value={denoise}
                  onChange={setDenoise}
                  label={null}
                />
              </div>
              <Group gap={8} align="flex-end">
                <NumberInput
                  label="Seed"
                  size="xs"
                  value={seed}
                  onChange={(value) => setSeed(Number(value) || 0)}
                  w={140}
                />
                <Button
                  size="compact-xs"
                  variant="subtle"
                  leftSection={<IconDice5 size={13} stroke={1.75} />}
                  onClick={() => setSeed(Math.floor(Math.random() * 1_000_000))}
                >
                  Randomize
                </Button>
              </Group>
            </Stack>
          </div>

          {proposal.data.pins.length > 0 && (
            <div>
              <Group gap={6} mb={6}>
                <Text size="xs" tt="uppercase" c="dimmed" fw={700}>
                  Keeps
                </Text>
                <Text size="xs" c="dimmed">
                  · pinned intermediates this run should keep
                </Text>
              </Group>
              <Stack gap={4}>
                {proposal.data.pins.map((pin) => (
                  <Checkbox
                    key={pin.id}
                    size="xs"
                    checked={armedPins[pin.label] ?? false}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      setArmedPins((prev) => ({ ...prev, [pin.label]: checked }));
                    }}
                    label={
                      <Group gap={6}>
                        <Text size="xs" ff="monospace">
                          {pin.label}
                        </Text>
                        <Badge size="xs" variant="outline" color="gray" tt="none">
                          {pin.dataType}
                        </Badge>
                        <Text size="xs" c="dimmed">
                          → run artifact
                        </Text>
                      </Group>
                    }
                  />
                ))}
              </Stack>
            </div>
          )}

          <div
            style={{
              border: '1px solid rgba(20,184,166,0.35)',
              background: 'rgba(20,184,166,0.06)',
              borderRadius: 10,
              padding: '8px 12px',
            }}
          >
            <Group gap={6} mb={secondaryOutcomes.length > 0 ? 2 : 0}>
              <IconArrowRight size={14} stroke={1.75} color="var(--mantine-color-teal-4)" />
              <Text size="sm" fw={600} c="teal">
                {primaryOutcome?.description}
              </Text>
            </Group>
            {secondaryOutcomes.map((outcome) => (
              <Text key={outcome.targetCode} size="xs" c="dimmed" ml={20}>
                {outcome.description}
              </Text>
            ))}
          </div>

          <Group justify="flex-end">
            <Button
              leftSection={<IconPlayerPlay size={15} stroke={1.75} />}
              color="teal"
              disabled={!ready}
              loading={run.isPending}
              onClick={() => run.mutate()}
            >
              {ready ? 'Run' : 'Choose inputs to run'}
            </Button>
          </Group>
        </Stack>
      ) : (
        <Stack gap="md">
          <Group gap={8}>
            <Text size="xs" c="dimmed">
              Run
            </Text>
            <Text size="xs" ff="monospace">
              {intent.id}
            </Text>
            <Badge
              size="xs"
              variant="light"
              color={
                intent.status === 'succeeded'
                  ? 'teal'
                  : intent.status === 'failed'
                    ? 'red'
                    : 'yellow'
              }
              tt="none"
            >
              {intent.status}
            </Badge>
            <Text size="xs" c="dimmed">
              seed {intent.seed}
            </Text>
          </Group>

          {!finished && trace.phase && (
            <Group gap={6}>
              <Loader size={10} />
              <Text size="xs" c="dimmed">
                {trace.phase === 'queued' ? 'Queued on engine' : `Running on engine`}
                {trace.nodesTotal > 0
                  ? ` — ${trace.nodesDone}/${trace.nodesTotal} nodes`
                  : ''}
              </Text>
            </Group>
          )}

          {intent.status === 'failed' && intent.errorMessage && (
            <Text size="xs" c="red">
              {intent.errorMessage}
            </Text>
          )}

          {finished && intent.status !== 'failed' && (
            <div
              style={{
                border: '1px solid var(--border, rgba(148,163,184,0.2))',
                borderRadius: 10,
                padding: 10,
              }}
            >
              <Group gap={10} wrap="nowrap">
                <img
                  src={placeholderThumb(`v${primaryOutcome?.targetVersion ?? '?'}`, 170)}
                  alt=""
                  style={{ width: 56, height: 56, borderRadius: 8, objectFit: 'cover' }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Group gap={6}>
                    <Badge size="xs" variant="outline">
                      v{primaryOutcome?.targetVersion ?? '?'}
                    </Badge>
                    <Badge size="xs" variant="light" color="grape" tt="none">
                      generated
                    </Badge>
                    <Text size="xs" ff="monospace" truncate>
                      {primaryOutcome?.targetCode}
                    </Text>
                  </Group>
                  {intent.armedPins.length > 0 && (
                    <Text size="xs" c="dimmed" mt={4}>
                      kept: {intent.armedPins.join(', ')} → run artifact
                      {intent.armedPins.length === 1 ? '' : 's'}
                    </Text>
                  )}
                  <Text size="xs" c="dimmed" mt={4}>
                    {intent.status === 'succeeded'
                      ? 'Results created — new version should appear in the asset library.'
                      : 'Intent dispatched — nodegraph is running the workflow.'}
                  </Text>
                </div>
              </Group>
            </div>
          )}

          <Group justify="flex-end">
            <Button variant="default" size="xs" onClick={close}>
              {finished ? 'Close' : 'Run in background'}
            </Button>
          </Group>
        </Stack>
      )}
    </Drawer>
  );
}
