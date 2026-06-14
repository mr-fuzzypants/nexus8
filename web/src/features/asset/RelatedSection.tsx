import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ActionIcon, Badge, Button, Group, Select, Text } from '@mantine/core';
import { IconPlus, IconX } from '@tabler/icons-react';
import { Link } from 'wouter';
import {
  addRelation,
  getRelations,
  listEntities,
  removeRelation,
} from '../../api/intelligence';
import type { AssetSummary } from '../../api/library';

export function RelatedSection({ asset }: { asset: AssetSummary }) {
  const queryClient = useQueryClient();
  const [linking, setLinking] = useState(false);
  const [entityId, setEntityId] = useState<string | null>(null);

  const relations = useQuery({
    queryKey: ['relations', asset.id],
    queryFn: () => getRelations(asset.id),
  });
  const entities = useQuery({
    queryKey: ['entities'],
    queryFn: () => listEntities(),
    enabled: linking,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['relations', asset.id] });
    queryClient.invalidateQueries({ queryKey: ['entities'] });
  };

  const link = useMutation({
    mutationFn: () => addRelation(asset.id, Number(entityId)),
    onSuccess: () => {
      setEntityId(null);
      setLinking(false);
      invalidate();
    },
  });
  const unlink = useMutation({ mutationFn: removeRelation, onSuccess: invalidate });

  return (
    <section>
      <Group gap={8} mb={8}>
        <Text size="sm" fw={600}>
          Related entities
        </Text>
        <ActionIcon
          variant="subtle"
          size="sm"
          aria-label="Link entity"
          onClick={() => setLinking((v) => !v)}
        >
          <IconPlus size={14} stroke={1.75} />
        </ActionIcon>
      </Group>

      {relations.data?.length === 0 && !linking && (
        <Text size="xs" c="dimmed">
          No linked entities. Tap + to relate this asset to a character, costume, location…
        </Text>
      )}

      <Group gap={6}>
        {relations.data?.map((relation) => (
          <Badge
            key={relation.id}
            variant="light"
            style={{ textTransform: 'none' }}
            rightSection={
              <IconX
                size={11}
                style={{ cursor: 'pointer' }}
                onClick={() => unlink.mutate(relation.id)}
                aria-label={`Unlink ${relation.entity.name}`}
              />
            }
          >
            <Link
              href={`/entities/${relation.entity.id}`}
              style={{ color: 'inherit', textDecoration: 'none' }}
            >
              {relation.role}: {relation.entity.name}
            </Link>
          </Badge>
        ))}
      </Group>

      {linking && (
        <Group gap={6} mt={8}>
          <Select
            size="xs"
            searchable
            placeholder="Pick an entity…"
            value={entityId}
            onChange={setEntityId}
            data={(entities.data ?? []).map((entity) => ({
              value: String(entity.id),
              label: `${entity.name} (${entity.category})`,
            }))}
            style={{ flex: 1 }}
          />
          <Button size="xs" disabled={!entityId} loading={link.isPending} onClick={() => link.mutate()}>
            Link
          </Button>
        </Group>
      )}
    </section>
  );
}
