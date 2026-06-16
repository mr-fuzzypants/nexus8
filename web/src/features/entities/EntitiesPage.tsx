import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { Button, Checkbox, Modal, Select, Stack, Text, TextInput } from '@mantine/core';
import { IconFolderShare, IconPlus, IconUsers } from '@tabler/icons-react';
import { ENTITY_CATEGORIES, createEntity, getRootEntities, getContainerTree } from '../../api/intelligence';
import { assignToProject } from '../../api/projects';
import { useProject } from '../projects/ProjectContext';
import { ContainerBrowser } from './ContainerBrowser';

const REMOVE_FROM_PROJECT = '_none';

export function EntitiesPage() {
  const [, navigate] = useLocation();
  const { code: project, projects } = useProject();
  const queryClient = useQueryClient();
  const [selectedContainerId, setSelectedContainerId] = useState<number | null>(null);
  const [modal, setModal] = useState(false);
  const [name, setName] = useState('');
  const [newCategory, setNewCategory] = useState<string | null>('character');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [moveModal, setMoveModal] = useState(false);
  const [moveTarget, setMoveTarget] = useState<string | null>(null);

  const toggleSelect = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Load container tree once and cache it
  const tree = useQuery({
    queryKey: ['containerTree'],
    queryFn: getContainerTree,
  });

  // Get entities from tree or root, using cached data
  const entities = useQuery({
    queryKey: selectedContainerId
      ? ['entities', 'container', selectedContainerId]
      : ['entities', 'root', project],
    queryFn: () => {
      if (!selectedContainerId) {
        return getRootEntities(undefined, project || undefined);
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
    mutationFn: () => createEntity(name, newCategory ?? 'character', project || undefined),
    onSuccess: () => {
      setModal(false);
      setName('');
      queryClient.invalidateQueries({ queryKey: ['entities'] });
      queryClient.invalidateQueries({ queryKey: ['containerTree'] });
    },
  });

  const move = useMutation({
    mutationFn: () => assignToProject(moveTarget ?? REMOVE_FROM_PROJECT, [...selected]),
    onSuccess: () => {
      setMoveModal(false);
      setMoveTarget(null);
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ['entities'] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
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
            {selected.size > 0 && (
              <>
                <Button
                  size="xs"
                  variant="light"
                  leftSection={<IconFolderShare size={15} stroke={1.75} />}
                  onClick={() => setMoveModal(true)}
                  style={{ marginLeft: 'auto' }}
                >
                  Move {selected.size} to project
                </Button>
                <Button size="xs" variant="subtle" onClick={() => setSelected(new Set())}>
                  Clear
                </Button>
              </>
            )}
            <Button
              size="xs"
              leftSection={<IconPlus size={15} stroke={1.75} />}
              onClick={() => setModal(true)}
              style={selected.size > 0 ? undefined : { marginLeft: 'auto' }}
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
                style={{ cursor: 'grab', position: 'relative' }}
              >
                <Checkbox
                  checked={selected.has(entity.id)}
                  onChange={() => toggleSelect(entity.id)}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`Select ${entity.name}`}
                  style={{ position: 'absolute', top: 8, left: 8, zIndex: 1 }}
                />
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

        <Modal
          opened={moveModal}
          onClose={() => setMoveModal(false)}
          title={`Move ${selected.size} entit${selected.size === 1 ? 'y' : 'ies'} to project`}
          size="sm"
        >
          <Stack gap="sm">
            <Select
              label="Project"
              placeholder="Select a project"
              value={moveTarget}
              onChange={setMoveTarget}
              data={[
                { value: REMOVE_FROM_PROJECT, label: '— Remove from project —' },
                ...projects.map((p) => ({ value: p.code, label: p.name })),
              ]}
              searchable
              data-autofocus
            />
            <Button disabled={!moveTarget} loading={move.isPending} onClick={() => move.mutate()}>
              Move
            </Button>
          </Stack>
        </Modal>
      </div>
    </div>
  );
}
