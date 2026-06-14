import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { Button, Modal, Select, Stack, Text, TextInput } from '@mantine/core';
import { IconPlus, IconUsers } from '@tabler/icons-react';
import { ENTITY_CATEGORIES, createEntity, getRootEntities, getContainerTree } from '../../api/intelligence';
import { ContainerBrowser } from './ContainerBrowser';

export function EntitiesPage() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [selectedContainerId, setSelectedContainerId] = useState<number | null>(null);
  const [modal, setModal] = useState(false);
  const [name, setName] = useState('');
  const [newCategory, setNewCategory] = useState<string | null>('character');

  // Load container tree once and cache it
  const tree = useQuery({
    queryKey: ['containerTree'],
    queryFn: getContainerTree,
  });

  // Get entities from tree or root, using cached data
  const entities = useQuery({
    queryKey: selectedContainerId ? ['entities', 'container', selectedContainerId] : ['entities', 'root'],
    queryFn: () => {
      if (!selectedContainerId) {
        return getRootEntities();
      }

      // Find container in cached tree data
      if (!tree.data) return [];

      const findContainer = (nodes: any[]): any => {
        for (const node of nodes) {
          if (node.id === selectedContainerId) return node;
          const found = findContainer(node.children || []);
          if (found) return found;
        }
        return null;
      };

      const container = findContainer(tree.data);
      return container?.entities || [];
    },
    enabled: !selectedContainerId || tree.isSuccess,
  });

  const create = useMutation({
    mutationFn: () => createEntity(name, newCategory ?? 'character'),
    onSuccess: () => {
      setModal(false);
      setName('');
      queryClient.invalidateQueries({ queryKey: ['entities'] });
      queryClient.invalidateQueries({ queryKey: ['containerTree'] });
    },
  });

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <ContainerBrowser onSelectContainer={setSelectedContainerId} />
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        <header className="search-header">
          <div className="search-toolbar">
            <Text fw={600}>Entities</Text>
            <Text size="xs" c="dimmed">
              {entities.data?.length ?? 0} entit{(entities.data?.length ?? 0) === 1 ? 'y' : 'ies'}
            </Text>
            <Button
              size="xs"
              leftSection={<IconPlus size={15} stroke={1.75} />}
              onClick={() => setModal(true)}
              style={{ marginLeft: 'auto' }}
            >
              New entity
            </Button>
          </div>
        </header>

        {entities.data?.length === 0 ? (
          <div className="empty-state">
            <IconUsers size={36} stroke={1.4} />
            <p style={{ maxWidth: 440, margin: 0 }}>
              No entities in this container. Create characters, costumes, locations... then organize them into containers.
            </p>
          </div>
        ) : (
          <div className="entity-grid">
            {entities.data?.map((entity: any) => (
              <div
                key={entity.id}
                className="entity-card"
                role="button"
                tabIndex={0}
                draggable
                onClick={() => navigate(`/entities/${entity.id}`)}
                onKeyDown={(e) => e.key === 'Enter' && navigate(`/entities/${entity.id}`)}
                onDragStart={(e) => {
                  e.dataTransfer?.setData('application/json', JSON.stringify(entity));
                  e.dataTransfer!.effectAllowed = 'move';
                }}
                style={{ cursor: 'grab' }}
              >
                {entity.thumb ? (
                  <img src={entity.thumb} alt="" loading="lazy" />
                ) : (
                  <div style={{ aspectRatio: '4/3', background: 'var(--muted)' }} />
                )}
                <div className="entity-card-body">
                  <Text size="sm" fw={550} truncate>
                    {entity.name}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {entity.category} · {entity.asset_count ?? 0} asset
                    {entity.asset_count === 1 ? '' : 's'}
                  </Text>
                </div>
              </div>
            ))}
          </div>
        )}

        <Modal opened={modal} onClose={() => setModal(false)} title="New entity" size="sm">
          <Stack gap="sm">
            <TextInput
              label="Name"
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              placeholder="e.g. Wanda"
              data-autofocus
            />
            <Select
              label="Category"
              value={newCategory}
              onChange={setNewCategory}
              data={[...ENTITY_CATEGORIES]}
            />
            <Button disabled={!name.trim()} loading={create.isPending} onClick={() => create.mutate()}>
              Create
            </Button>
          </Stack>
        </Modal>
      </div>
    </div>
  );
}
