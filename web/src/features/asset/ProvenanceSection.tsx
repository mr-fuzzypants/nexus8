import { useMutation, useQuery } from '@tanstack/react-query';
import { Badge, Button, Group, Loader, Stack, Text } from '@mantine/core';
import { IconRefresh } from '@tabler/icons-react';
import { getProvenance, reproduceAsset, type Provenance } from '../../api/versions';
import type { AssetSummary } from '../../api/library';

const ENV_KEYS = ['torch', 'diffusers', 'device', 'dtype'] as const;

/** Forward lineage panel: the run that produced this asset — workflow,
 *  ingredient versions, seed, and the recorded execution environment. */
export function ProvenanceSection({ asset }: { asset: AssetSummary }) {
  const query = useQuery({
    queryKey: ['provenance', asset.id],
    queryFn: () => getProvenance(asset.id),
  });

  const data = query.data;
  const manifest = data && 'ingredients' in data ? (data as Provenance) : null;
  const environment = manifest?.batch.params?.environment;

  const reproduce = useMutation({
    mutationFn: () => reproduceAsset(manifest!.output.code),
  });

  return (
    <div>
      <Group gap={8} mb={8}>
        <Text size="sm" fw={600}>
          Provenance
        </Text>
        {query.isFetching && <Loader size={14} />}
      </Group>

      {!manifest ? (
        <Text size="xs" c="dimmed">
          Not generated in nexus8 — no recorded run.
        </Text>
      ) : (
        <Stack gap={6}>
          {Object.entries(manifest.ingredients).map(([name, ingredient]) => (
            <Group key={name} gap={6} justify="space-between" wrap="nowrap">
              <Text size="xs" c="dimmed" truncate>
                {name.startsWith('workflow') ? 'workflow' : name}
              </Text>
              <Group gap={6} wrap="nowrap">
                <Text size="xs" ff="monospace" truncate maw={160}>
                  {ingredient.code}
                </Text>
                <Badge size="xs" variant="light">
                  v{ingredient.pinned_version}
                </Badge>
              </Group>
            </Group>
          ))}

          {manifest.output.seed != null && (
            <Group gap={6} justify="space-between">
              <Text size="xs" c="dimmed">
                seed
              </Text>
              <Text size="xs" ff="monospace">
                {manifest.output.seed}
              </Text>
            </Group>
          )}

          {environment && (
            <Text size="xs" c="dimmed" mt={2}>
              {ENV_KEYS.map((k) => environment[k])
                .filter(Boolean)
                .join(' · ')}
            </Text>
          )}

          <Button
            size="compact-xs"
            variant="light"
            color="grape"
            leftSection={<IconRefresh size={13} stroke={1.75} />}
            loading={reproduce.isPending}
            onClick={() => reproduce.mutate()}
            mt={4}
          >
            Reproduce
          </Button>
          {reproduce.isSuccess && (
            <Text size="xs" c="teal">
              Run {reproduce.data.runId} started · {reproduce.data.workflow}
            </Text>
          )}
          {reproduce.isError && (
            <Text size="xs" c="red">
              {(reproduce.error as { response?: { data?: { error?: string } } })?.response?.data
                ?.error ?? 'Reproduce failed'}
            </Text>
          )}
        </Stack>
      )}
    </div>
  );
}
