import React, { useState, useCallback, useEffect, useRef } from 'react';
import { 
  Modal, 
  TextInput, 
  Button, 
  Select, 
  Stack,
  Group,
  Text,
  ActionIcon,
  Card,
  Badge,
  NumberInput,
  Textarea,
  Switch,
  Divider,
  Box,
  Tooltip,
} from '@mantine/core';
import { draggable, dropTargetForElements, monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { attachClosestEdge, extractClosestEdge, Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import { IconPlus, IconTrash, IconGripVertical, IconEdit, IconSettings, IconArrowRight } from '@tabler/icons-react';
import { useDataStore } from '../../state/useDataStore';
import type { StatusDefinition, AggregateStatusType } from '../../schema';
import { defaultAggregateStatuses } from '../../schema';

interface ColumnManagerProps {
  opened: boolean;
  onClose: () => void;
}

const DraggableColumnItem = ({ 
  status, 
  index, 
  handleEditColumn, 
  handleDeleteColumn, 
  kanbanSchema 
}: { 
  status: StatusDefinition, 
  index: number, 
  handleEditColumn: (s: StatusDefinition) => void, 
  handleDeleteColumn: (id: string) => void,
  kanbanSchema: any
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const dragHandleRef = useRef<HTMLButtonElement>(null);
  const [closestEdge, setClosestEdge] = useState<Edge | null>(null);

  useEffect(() => {
    const element = ref.current;
    const dragHandle = dragHandleRef.current;
    if (!element || !dragHandle) return;

    return combine(
      draggable({
        element,
        dragHandle,
        getInitialData: () => ({ type: 'column-manager-item', index, id: status.id }),
      }),
      dropTargetForElements({
        element,
        getData: ({ input }) => attachClosestEdge(
          { type: 'column-manager-item', index, id: status.id },
          { element, input, allowedEdges: ['top', 'bottom'] }
        ),
        onDragEnter: ({ self }) => {
          setClosestEdge(extractClosestEdge(self.data));
        },
        onDrag: ({ self }) => {
          setClosestEdge(extractClosestEdge(self.data));
        },
        onDragLeave: () => {
          setClosestEdge(null);
        },
        onDrop: () => {
          setClosestEdge(null);
        },
      })
    );
  }, [status.id, index]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <Card p="md" withBorder style={{ 
          borderTop: closestEdge === 'top' ? '2px solid var(--mantine-color-blue-filled)' : undefined,
          borderBottom: closestEdge === 'bottom' ? '2px solid var(--mantine-color-blue-filled)' : undefined,
        }}>
        <Group justify="space-between">
          <Group gap="sm">
            <ActionIcon 
              ref={dragHandleRef}
              variant="subtle" 
              size="sm" 
              style={{ cursor: 'grab' }}
            >
              <IconGripVertical size={16} />
            </ActionIcon>
            
            <Badge color={status.color} variant="light">
              {status.label}
            </Badge>
            
            {status.aggregateStatus && (
              <Group gap={4}>
                <IconArrowRight size={12} />
                <Badge 
                  color={defaultAggregateStatuses.find(a => a.id === status.aggregateStatus)?.color} 
                  variant="outline"
                  size="sm"
                >
                  {defaultAggregateStatuses.find(a => a.id === status.aggregateStatus)?.label}
                </Badge>
              </Group>
            )}
            
            <Text size="sm" c="dimmed">
              Order: {status.order}
            </Text>
            
            {status.maxCards && (
              <Badge size="xs" color="orange">
                WIP: {status.maxCards}
              </Badge>
            )}                    {status.isInitial && (
              <Badge variant="outline" color="blue" size="sm">
                Initial
              </Badge>
            )}
            
            {status.isFinal && (
              <Badge variant="outline" color="green" size="sm">
                Final
              </Badge>
            )}
          </Group>
          
          <Group gap="xs">
            <Tooltip label="Edit Column">
              <ActionIcon 
                variant="subtle"
                onClick={() => handleEditColumn(status)}
                size="sm"
              >
                <IconEdit size={16} />
              </ActionIcon>
            </Tooltip>
            
            <Tooltip label="Delete Column">
              <ActionIcon 
                color="red" 
                variant="subtle"
                onClick={() => handleDeleteColumn(status.id)}
                size="sm"
                disabled={kanbanSchema.statuses.length <= 1}
              >
                <IconTrash size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
        
        {status.description && (
          <Text size="sm" c="dimmed" mt="xs">
            {status.description}
          </Text>
        )}
      </Card>
    </div>
  );
};

export const ColumnManagerModal: React.FC<ColumnManagerProps> = ({ opened, onClose }) => {
  const kanbanSchema = useDataStore(state => state.kanbanSchema);
  const dataActions = useDataStore(state => state.actions);
  const [editingColumn, setEditingColumn] = useState<StatusDefinition | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  
  useEffect(() => {
    return monitorForElements({
      onDrop({ source, location }) {
        const destination = location.current.dropTargets[0];
        if (!destination) return;
        
        const sourceData = source.data;
        const destinationData = destination.data;

        if (sourceData.type !== 'column-manager-item' || destinationData.type !== 'column-manager-item') return;

        const sourceIndex = sourceData.index as number;
        const destinationIndex = destinationData.index as number;
        
        if (sourceIndex === destinationIndex) return;

        const edge = extractClosestEdge(destinationData);
        
        // Create a deep copy and sort to match visual order
        const newStatuses = kanbanSchema.statuses
            .map(s => ({ ...s }))
            .sort((a, b) => a.order - b.order);
            
        const [movedStatus] = newStatuses.splice(sourceIndex, 1);
        
        let targetIndex = destinationIndex;
        if (edge === 'bottom') {
            targetIndex += 1;
        }
        
        if (sourceIndex < targetIndex) {
            targetIndex -= 1;
        }
        
        newStatuses.splice(targetIndex, 0, movedStatus);
        
        // Update order property
        newStatuses.forEach((s, i) => s.order = i);
        
        dataActions.updateKanbanSchema({
            ...kanbanSchema,
            statuses: newStatuses
        });
      },
    });
  }, [kanbanSchema, dataActions]);

  const [formData, setFormData] = useState({
    id: '',
    label: '',
    description: '',
    color: 'blue',
    icon: 'IconCircle',
    order: 1,
    aggregateStatus: 'not-started' as AggregateStatusType,
    allowDrop: true,
    allowDrag: true,
    wipLimit: undefined as number | undefined,
    showCardCount: true,
    collapsible: false,
    defaultCollapsed: false,
    mobileWidth: 'normal' as 'narrow' | 'normal' | 'wide',
  });

  const resetForm = useCallback(() => {
    setFormData({
      id: '',
      label: '',
      description: '',
      color: 'blue',
      icon: 'IconCircle',
      order: kanbanSchema.statuses.length + 1,
      aggregateStatus: 'not-started',
      allowDrop: true,
      allowDrag: true,
      wipLimit: undefined,
      showCardCount: true,
      collapsible: false,
      defaultCollapsed: false,
      mobileWidth: 'normal',
    });
    setEditingColumn(null);
  }, [kanbanSchema.statuses.length]);

  const handleAddColumn = useCallback(() => {
    const newColumn: StatusDefinition = {
      id: formData.id || formData.label.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
      label: formData.label,
      description: formData.description || undefined,
      color: formData.color || undefined,
      icon: formData.icon || undefined,
      order: formData.order,
      aggregateStatus: formData.aggregateStatus,
      allowDrop: formData.allowDrop,
      allowDrag: formData.allowDrag,
      isInitial: false,
      isFinal: false,
      maxCards: formData.wipLimit || undefined,
      showCardCount: formData.showCardCount,
      collapsible: formData.collapsible,
      defaultCollapsed: formData.defaultCollapsed,
      mobileWidth: formData.mobileWidth,
    };

    let updatedStatuses;
    
    if (editingColumn) {
      // Update existing column
      updatedStatuses = kanbanSchema.statuses.map(s => 
        s.id === editingColumn.id ? newColumn : s
      );
    } else {
      // Add new column
      updatedStatuses = [...kanbanSchema.statuses, newColumn];
    }

    // Sort by order
    updatedStatuses.sort((a, b) => a.order - b.order);

    const updatedSchema = {
      ...kanbanSchema,
      statuses: updatedStatuses,
    };

    dataActions.updateKanbanSchema(updatedSchema);
    setIsAddModalOpen(false);
    resetForm();
  }, [formData, editingColumn, kanbanSchema, dataActions, resetForm]);

  const handleDeleteColumn = useCallback((columnId: string) => {
    const updatedSchema = {
      ...kanbanSchema,
      statuses: kanbanSchema.statuses.filter(s => s.id !== columnId),
    };
    dataActions.updateKanbanSchema(updatedSchema);
  }, [kanbanSchema, dataActions]);

  const handleEditColumn = useCallback((status: StatusDefinition) => {
    setEditingColumn(status);
    setFormData({
      id: status.id,
      label: status.label,
      description: status.description || '',
      color: status.color || '',
      icon: status.icon || 'IconCircle',
      order: status.order,
      aggregateStatus: status.aggregateStatus,
      allowDrop: status.allowDrop,
      allowDrag: status.allowDrag,
      wipLimit: status.maxCards,
      showCardCount: status.showCardCount,
      collapsible: status.collapsible,
      defaultCollapsed: status.defaultCollapsed,
      mobileWidth: status.mobileWidth || 'normal',
    });
    setIsAddModalOpen(true);
  }, []);

  const colorOptions = [
    { value: 'blue', label: 'Blue' },
    { value: 'green', label: 'Green' },
    { value: 'orange', label: 'Orange' },
    { value: 'red', label: 'Red' },
    { value: 'violet', label: 'Violet' },
    { value: 'yellow', label: 'Yellow' },
    { value: 'gray', label: 'Gray' },
    { value: 'pink', label: 'Pink' },
    { value: 'cyan', label: 'Cyan' },
    { value: 'teal', label: 'Teal' },
  ];

  const mobileWidthOptions = [
    { value: 'narrow', label: 'Narrow' },
    { value: 'normal', label: 'Normal' },
    { value: 'wide', label: 'Wide' },
  ];

  return (
    <>
      <Modal
        opened={opened}
        onClose={onClose}
        title={
          <Group gap="sm">
            <IconSettings size={20} />
            <Text size="lg" fw={600}>Column Management</Text>
          </Group>
        }
        size="lg"
        centered
      >
        <Stack gap="md">
          <Group justify="space-between">
            <Text size="sm" c="dimmed">
              Manage your Kanban board columns. Drag to reorder, edit settings, or add new columns.
            </Text>
            <Button 
              leftSection={<IconPlus size={16} />} 
              onClick={() => {
                resetForm();
                setIsAddModalOpen(true);
              }}
              size="sm"
            >
              Add Column
            </Button>
          </Group>

          <Divider />

          {/* Aggregate Status Overview */}
          <Box>
            <Text size="sm" fw={600} mb="sm">Aggregate Status Mapping</Text>
            <Stack gap="xs">
              {defaultAggregateStatuses.map(aggStatus => {
                const mappedColumns = kanbanSchema.statuses.filter(
                  s => s.aggregateStatus === aggStatus.id
                );
                return (
                  <Card key={aggStatus.id} p="sm" withBorder>
                    <Group justify="space-between">
                      <Group gap="sm">
                        <Badge color={aggStatus.color} variant="filled">
                          {aggStatus.label}
                        </Badge>
                        <Text size="xs" c="dimmed">
                          {aggStatus.description}
                        </Text>
                      </Group>
                      <Badge size="xs" variant="outline">
                        {mappedColumns.length} column{mappedColumns.length !== 1 ? 's' : ''}
                      </Badge>
                    </Group>
                    {mappedColumns.length > 0 && (
                      <Group gap="xs" mt="xs">
                        {mappedColumns.map(col => (
                          <Badge key={col.id} color={col.color} size="xs" variant="light">
                            {col.label}
                          </Badge>
                        ))}
                      </Group>
                    )}
                  </Card>
                );
              })}
            </Stack>
          </Box>

          <Divider />

          <Stack gap="sm">
            {kanbanSchema.statuses
              .slice()
              .sort((a, b) => a.order - b.order)
              .map((status, index) => (
              <DraggableColumnItem
                key={status.id}
                status={status}
                index={index}
                handleEditColumn={handleEditColumn}
                handleDeleteColumn={handleDeleteColumn}
                kanbanSchema={kanbanSchema}
              />
            ))}
          </Stack>
        </Stack>
      </Modal>

      {/* Add/Edit Column Modal */}
      <Modal
        opened={isAddModalOpen}
        onClose={() => { setIsAddModalOpen(false); resetForm(); }}
        title={editingColumn ? 'Edit Column' : 'Add New Column'}
        size="md"
        centered
      >
        <Stack gap="md">
          <TextInput
            label="Column Name"
            placeholder="e.g., In Review, Testing, Done"
            value={formData.label}
            onChange={(e) => setFormData(prev => ({ ...prev, label: e.target.value }))}
            required
          />

          <TextInput
            label="Column ID"
            placeholder="Auto-generated from name if empty"
            value={formData.id}
            onChange={(e) => setFormData(prev => ({ ...prev, id: e.target.value }))}
            description="Used internally. Leave empty to auto-generate."
          />

          <Textarea
            label="Description (optional)"
            placeholder="Brief description of this column's purpose"
            value={formData.description}
            onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
            minRows={2}
            maxRows={4}
          />

          <Group grow>
            <Select
              label="Color"
              value={formData.color}
              onChange={(value) => setFormData(prev => ({ ...prev, color: value || 'blue' }))}
              data={colorOptions}
            />

            <Select
              label="Aggregate Status"
              value={formData.aggregateStatus}
              onChange={(value) => setFormData(prev => ({ 
                ...prev, 
                aggregateStatus: (value as AggregateStatusType) || 'not-started' 
              }))}
              data={defaultAggregateStatuses.map(a => ({
                value: a.id,
                label: a.label,
              }))}
              description="For reporting and analytics"
            />
          </Group>

          <Group grow>
            <NumberInput
              label="Order Position"
              value={formData.order}
              onChange={(value) => setFormData(prev => ({ ...prev, order: Number(value) || 1 }))}
              min={1}
              description="Position in the board"
            />
          </Group>

          <NumberInput
            label="WIP Limit (optional)"
            placeholder="No limit"
            value={formData.wipLimit}
            onChange={(value) => setFormData(prev => ({ 
              ...prev, 
              wipLimit: value ? Number(value) : undefined 
            }))}
            min={1}
            description="Maximum cards allowed in this column"
          />

          <Select
            label="Mobile Width"
            value={formData.mobileWidth}
            onChange={(value) => setFormData(prev => ({ 
              ...prev, 
              mobileWidth: (value as 'narrow' | 'normal' | 'wide') || 'normal' 
            }))}
            data={mobileWidthOptions}
            description="Column width on mobile devices"
          />

          <Divider label="Column Behavior" />

          <Box>
            <Stack gap="sm">
              <Switch
                label="Allow Drop"
                description="Cards can be dropped into this column"
                checked={formData.allowDrop}
                onChange={(event) => setFormData(prev => ({ 
                  ...prev, 
                  allowDrop: event.currentTarget.checked 
                }))}
              />

              <Switch
                label="Allow Drag"
                description="Cards can be dragged from this column"
                checked={formData.allowDrag}
                onChange={(event) => setFormData(prev => ({ 
                  ...prev, 
                  allowDrag: event.currentTarget.checked 
                }))}
              />

              <Switch
                label="Show Card Count"
                description="Display number of cards in column header"
                checked={formData.showCardCount}
                onChange={(event) => setFormData(prev => ({ 
                  ...prev, 
                  showCardCount: event.currentTarget.checked 
                }))}
              />

              <Switch
                label="Collapsible"
                description="Allow users to collapse this column"
                checked={formData.collapsible}
                onChange={(event) => setFormData(prev => ({ 
                  ...prev, 
                  collapsible: event.currentTarget.checked 
                }))}
              />

              {formData.collapsible && (
                <Switch
                  label="Default Collapsed"
                  description="Start with column collapsed"
                  checked={formData.defaultCollapsed}
                  onChange={(event) => setFormData(prev => ({ 
                    ...prev, 
                    defaultCollapsed: event.currentTarget.checked 
                  }))}
                  ml="md"
                />
              )}
            </Stack>
          </Box>

          <Group justify="flex-end" mt="lg">
            <Button 
              variant="outline" 
              onClick={() => { setIsAddModalOpen(false); resetForm(); }}
            >
              Cancel
            </Button>
            
            <Button 
              onClick={handleAddColumn} 
              disabled={!formData.label.trim()}
              leftSection={editingColumn ? <IconEdit size={16} /> : <IconPlus size={16} />}
            >
              {editingColumn ? 'Update Column' : 'Add Column'}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
};