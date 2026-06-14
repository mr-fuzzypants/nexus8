import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ActionIcon, Button, Loader, Modal, ScrollArea, Stack, TextInput, ThemeIcon, Tooltip } from '@mantine/core';
import { IconChevronRight, IconChevronDown, IconFolder, IconFolderPlus, IconUsers, IconCheck, IconX } from '@tabler/icons-react';
import { getContainerTree, createContainer, moveEntityToContainer, type ContainerTreeNode, type EntitySummary } from '../../api/intelligence';
import styles from './ContainerBrowser.module.css';

function ContainerNode({
  node,
  level = 0,
  isExpanded,
  onToggle,
  onSelect,
  onDrop,
}: {
  node: ContainerTreeNode;
  level?: number;
  isExpanded: boolean;
  onToggle: () => void;
  onSelect: (containerId: number) => void;
  onDrop: (containerId: number, entity: EntitySummary) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [creatingChild, setCreatingChild] = useState(false);
  const [newName, setNewName] = useState('');
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: () => createContainer(newName, node.id),
    onSuccess: () => {
      setNewName('');
      setCreatingChild(false);
      queryClient.invalidateQueries({ queryKey: ['containerTree'] });
    },
  });

  const hasChildren = node.children && node.children.length > 0;

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget === e.target) {
      setDragOver(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const entityData = e.dataTransfer.getData('application/json');
    if (entityData) {
      const entity = JSON.parse(entityData);
      onDrop(node.id, entity);
    }
  };

  return (
    <>
      <div
        className={`${styles.treeItem} ${dragOver ? styles.dragOver : ''}`}
        style={{ paddingLeft: `${level * 16}px` }}
        role="button"
        tabIndex={0}
        onClick={() => onSelect(node.id)}
        onKeyDown={(e) => e.key === 'Enter' && onSelect(node.id)}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {hasChildren && (
          <button
            className={styles.expandButton}
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            aria-label={isExpanded ? 'Collapse' : 'Expand'}
          >
            {isExpanded ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
          </button>
        )}
        {!hasChildren && <div className={styles.expandButtonPlaceholder} />}
        <ThemeIcon size="sm" variant="light" radius="sm">
          <IconFolder size={12} />
        </ThemeIcon>
        <span className={styles.label}>{node.name}</span>
        <Tooltip label="Create subfolder">
          <ActionIcon
            size="xs"
            variant="subtle"
            onClick={(e) => {
              e.stopPropagation();
              setCreatingChild(!creatingChild);
            }}
            aria-label="Create subfolder"
          >
            <IconFolderPlus size={14} />
          </ActionIcon>
        </Tooltip>
      </div>

      {creatingChild && (
        <div className={styles.createInline} style={{ paddingLeft: `${(level + 1) * 16}px` }}>
          <TextInput
            placeholder="Folder name..."
            value={newName}
            onChange={(e) => setNewName(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newName.trim()) {
                createMutation.mutate();
              } else if (e.key === 'Escape') {
                setCreatingChild(false);
                setNewName('');
              }
            }}
            rightSection={
              <div style={{ display: 'flex', gap: 4 }}>
                <ActionIcon
                  size="xs"
                  variant="subtle"
                  color="green"
                  disabled={!newName.trim() || createMutation.isPending}
                  onClick={() => createMutation.mutate()}
                >
                  <IconCheck size={14} />
                </ActionIcon>
                <ActionIcon
                  size="xs"
                  variant="subtle"
                  color="gray"
                  onClick={() => {
                    setCreatingChild(false);
                    setNewName('');
                  }}
                >
                  <IconX size={14} />
                </ActionIcon>
              </div>
            }
            autoFocus
            size="xs"
          />
        </div>
      )}

      {hasChildren && isExpanded && node.children.map((child) => (
        <ContainerNodeWrapper
          key={child.id}
          node={child}
          level={level + 1}
          onSelect={onSelect}
          onDrop={onDrop}
        />
      ))}
    </>
  );
}

function ContainerNodeWrapper({
  node,
  level,
  onSelect,
  onDrop,
}: {
  node: ContainerTreeNode;
  level: number;
  onSelect: (containerId: number) => void;
  onDrop: (containerId: number, entity: EntitySummary) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <ContainerNode
      node={node}
      level={level}
      isExpanded={expanded}
      onToggle={() => setExpanded(!expanded)}
      onSelect={onSelect}
      onDrop={onDrop}
    />
  );
}

export function ContainerBrowser({ onSelectContainer }: { onSelectContainer: (containerId: number | null) => void }) {
  const queryClient = useQueryClient();
  const [showNewContainer, setShowNewContainer] = useState(false);
  const [newContainerName, setNewContainerName] = useState('');
  const [dragOverRoot, setDragOverRoot] = useState(false);
  const [rootExpanded, setRootExpanded] = useState(true);

  const tree = useQuery({
    queryKey: ['containerTree'],
    queryFn: getContainerTree,
  });

  const createMutation = useMutation({
    mutationFn: () => createContainer(newContainerName),
    onSuccess: () => {
      setNewContainerName('');
      setShowNewContainer(false);
      queryClient.invalidateQueries({ queryKey: ['containerTree'] });
    },
  });

  const moveMutation = useMutation({
    mutationFn: ({ entityId, containerId }: { entityId: number; containerId: number }) =>
      moveEntityToContainer(entityId, containerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['containerTree'] });
      queryClient.invalidateQueries({ queryKey: ['entities'] });
    },
  });

  const handleRootDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverRoot(false);
    const entityData = e.dataTransfer.getData('application/json');
    if (entityData) {
      const entity = JSON.parse(entityData);
      moveMutation.mutate({ entityId: entity.id, containerId: null as any });
    }
  };

  if (tree.isPending) {
    return (
      <div className={styles.sidebar}>
        <div style={{ padding: 16, display: 'flex', justifyContent: 'center' }}>
          <Loader size="sm" />
        </div>
      </div>
    );
  }

  const rootNode = tree.data?.[0];
  const hasChildren = rootNode?.children && rootNode.children.length > 0;

  return (
    <aside className={styles.sidebar}>
      <div className={styles.header}>
        <h3 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 600 }}>Entities</h3>
        <Tooltip label="Create folder">
          <ActionIcon
            size="sm"
            variant="subtle"
            onClick={() => setShowNewContainer(true)}
            aria-label="Create container"
          >
            <IconFolderPlus size={16} />
          </ActionIcon>
        </Tooltip>
      </div>

      <ScrollArea className={styles.tree}>
        <div className={styles.content}>
          {rootNode ? (
            <>
              <div
                className={`${styles.treeItem} ${dragOverRoot ? styles.dragOver : ''}`}
                onClick={() => onSelectContainer(null)}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverRoot(true);
                }}
                onDragLeave={() => setDragOverRoot(false)}
                onDrop={handleRootDrop}
                style={{ cursor: 'pointer', fontWeight: 600 }}
              >
                {hasChildren && (
                  <button
                    className={styles.expandButton}
                    onClick={(e) => {
                      e.stopPropagation();
                      setRootExpanded(!rootExpanded);
                    }}
                  >
                    {rootExpanded ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
                  </button>
                )}
                {!hasChildren && <div className={styles.expandButtonPlaceholder} />}
                <ThemeIcon size="sm" variant="light" radius="sm">
                  <IconUsers size={12} />
                </ThemeIcon>
                <span className={styles.label}>{rootNode.name}</span>
              </div>

              {hasChildren && rootExpanded && rootNode.children.map((child) => (
                <ContainerNodeWrapper
                  key={child.id}
                  node={child}
                  level={1}
                  onSelect={(id) => onSelectContainer(id)}
                  onDrop={(containerId, entity) =>
                    moveMutation.mutate({ entityId: entity.id, containerId })
                  }
                />
              ))}
            </>
          ) : (
            <div style={{ padding: '8px 12px', fontSize: '0.75rem', color: 'var(--muted-foreground)' }}>
              Loading...
            </div>
          )}
        </div>
      </ScrollArea>

      <Modal opened={showNewContainer} onClose={() => setShowNewContainer(false)} title="New Folder" size="sm">
        <Stack gap="sm">
          <TextInput
            label="Folder name"
            value={newContainerName}
            onChange={(e) => setNewContainerName(e.currentTarget.value)}
            placeholder="e.g. Characters, Props"
            data-autofocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newContainerName.trim()) {
                createMutation.mutate();
              }
            }}
          />
          <Button
            disabled={!newContainerName.trim()}
            loading={createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            Create Folder
          </Button>
        </Stack>
      </Modal>
    </aside>
  );
}
