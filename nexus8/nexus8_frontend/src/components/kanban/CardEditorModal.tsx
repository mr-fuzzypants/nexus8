import React, { useState, useCallback, useEffect } from 'react';
import {
  Modal,
  TextInput,
  Textarea,
  Button,
  Stack,
  Group,
  Select,
  Text,
  Box,
  Badge,
  NumberInput,
  TagsInput,
  Progress,
  Divider,
  ActionIcon,
  Tooltip,
} from '@mantine/core';
import { IconEdit, IconX, IconTrash, IconPhoto } from '@tabler/icons-react';
import { useKanbanStore } from '../../state';
import { AsyncImage } from '../AsyncImage';

interface CardEditorModalProps {
  opened: boolean;
  onClose: () => void;
  cardId: string | null;
}

export const CardEditorModal: React.FC<CardEditorModalProps> = ({
  opened,
  onClose,
  cardId,
}) => {
  const { cards, actions, kanbanSchema, cardSchema } = useKanbanStore();
  
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    imageUrl: '',
    status: '',
    priority: 'medium',
    assignee: '',
    progress: 0,
    storyPoints: 0,
    tags: [] as string[],
    dueDate: '',
    customMetadata: {} as Record<string, any>,
  });

  const [isLoading, setIsLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Get the card being edited
  const card = cardId ? cards[cardId] : null;

  // Reset form when modal opens/closes or card changes
  useEffect(() => {
    if (opened && card) {
      setFormData({
        title: card.title || '',
        description: card.description || '',
        imageUrl: card.imageUrl || '',
        status: card.status || '',
        priority: card.metadata?.priority || 'medium',
        assignee: card.metadata?.assignee || '',
        progress: card.metadata?.progress || 0,
        storyPoints: card.metadata?.storyPoints || 0,
        tags: card.metadata?.tags || [],
        dueDate: card.metadata?.dueDate || '',
        customMetadata: { ...(card.metadata || {}) },
      });
    }
  }, [opened, card]);

  const handleInputChange = useCallback((field: string, value: any) => {
    setFormData(prev => ({
      ...prev,
      [field]: value,
    }));
  }, []);

  const handleSubmit = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    
    if (!card || !formData.title.trim()) {
      return;
    }

    setIsLoading(true);

    try {
      const updatedCard = {
        title: formData.title.trim(),
        description: formData.description.trim(),
        imageUrl: formData.imageUrl.trim() || undefined,
        status: formData.status,
        metadata: {
          ...formData.customMetadata,
          priority: formData.priority,
          assignee: formData.assignee || undefined,
          progress: formData.progress,
          storyPoints: formData.storyPoints || undefined,
          tags: formData.tags.length > 0 ? formData.tags : undefined,
          dueDate: formData.dueDate || undefined,
        },
      };

      actions.updateCard(card.id, updatedCard);
      onClose();
    } catch (error) {
      console.error('Error updating card:', error);
    } finally {
      setIsLoading(false);
    }
  }, [card, formData, actions, onClose]);

  const handleDelete = useCallback(async () => {
    if (!card) return;

    setIsDeleting(true);
    try {
      actions.deleteCard(card.id);
      onClose();
    } catch (error) {
      console.error('Error deleting card:', error);
    } finally {
      setIsDeleting(false);
    }
  }, [card, actions, onClose]);

  const handleClose = useCallback(() => {
    setFormData({
      title: '',
      description: '',
      imageUrl: '',
      status: '',
      priority: 'medium',
      assignee: '',
      progress: 0,
      storyPoints: 0,
      tags: [],
      dueDate: '',
      customMetadata: {},
    });
    onClose();
  }, [onClose]);

  // Get available options from schemas
  const statusOptions = kanbanSchema.statuses.map(status => ({
    value: status.id,
    label: status.label,
  }));

  const assigneeOptions = cardSchema.metadataFields
    .find((field: any) => field.id === 'assignee')?.options
    ?.map((option: any) => ({
      value: option.value,
      label: option.label,
    })) || [];

  const priorityOptions = [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'critical', label: 'Critical' },
  ];

  if (!card) {
    return null;
  }

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title={
        <Group gap="sm" justify="space-between" style={{ width: '100%' }}>
          <Group gap="sm">
            <IconEdit size={20} />
            <Text size="lg" fw={600}>Edit Card</Text>
          </Group>
          
          <Tooltip label="Delete Card">
            <ActionIcon
              color="red"
              variant="subtle"
              onClick={handleDelete}
              loading={isDeleting}
            >
              <IconTrash size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      }
      size="lg"
      centered
      closeButtonProps={{
        'aria-label': 'Close modal',
        icon: <IconX size={16} />,
      }}
    >
      <Stack gap="md">
        {/* Card Info */}
        <Box>
          <Group gap="xs" mb="sm">
            <Badge variant="outline" size="sm">
              ID: {card.id.split('_').pop()?.substring(0, 8)}
            </Badge>
            {card.parentId && (
              <Badge variant="light" color="blue" size="sm">
                Child Card
              </Badge>
            )}
            {card.children && card.children.length > 0 && (
              <Badge variant="light" color="green" size="sm">
                {card.children.length} Children
              </Badge>
            )}
          </Group>
          
          <Text size="xs" c="dimmed">
            Created: {new Date(card.createdAt).toLocaleDateString()}<br />
            Updated: {new Date(card.updatedAt).toLocaleDateString()}
          </Text>
        </Box>

        <Divider />

        {/* Edit Form */}
        <form onSubmit={handleSubmit}>
          <Stack gap="md">
            <TextInput
              label="Title"
              placeholder="Enter card title..."
              value={formData.title}
              onChange={(event) => handleInputChange('title', event.currentTarget.value)}
              required
              data-autofocus
            />

            <Textarea
              label="Description"
              placeholder="Enter card description..."
              value={formData.description}
              onChange={(event) => handleInputChange('description', event.currentTarget.value)}
              minRows={3}
              maxRows={8}
            />

            <Box>
              <TextInput
                label="Image URL"
                placeholder="https://example.com/image.jpg"
                value={formData.imageUrl}
                onChange={(event) => handleInputChange('imageUrl', event.currentTarget.value)}
                leftSection={<IconPhoto size={16} />}
                description="Optional: Add an image to display on the card"
              />
              
              {formData.imageUrl && (
                <Box mt="sm">
                  <Text size="xs" fw={500} mb="xs" c="dimmed">Preview:</Text>
                  <AsyncImage
                    src={formData.imageUrl}
                    alt="Card image preview"
                    height={120}
                    fit="cover"
                    radius="sm"
                  />
                </Box>
              )}
            </Box>

            <Group grow>
              <Select
                label="Status"
                placeholder="Select status"
                value={formData.status}
                onChange={(value) => handleInputChange('status', value || '')}
                data={statusOptions}
                required
              />

              <Select
                label="Priority"
                placeholder="Select priority"
                value={formData.priority}
                onChange={(value) => handleInputChange('priority', value || 'medium')}
                data={priorityOptions}
              />
            </Group>

            <Group grow>
              {assigneeOptions.length > 0 && (
                <Select
                  label="Assignee"
                  placeholder="Select assignee"
                  value={formData.assignee}
                  onChange={(value) => handleInputChange('assignee', value || '')}
                  data={assigneeOptions}
                  clearable
                />
              )}
              
              <NumberInput
                label="Story Points"
                placeholder="0"
                value={formData.storyPoints}
                onChange={(value) => handleInputChange('storyPoints', value || 0)}
                min={0}
                max={100}
              />
            </Group>

            <Box>
              <Text size="sm" fw={500} mb="xs">
                Progress: {formData.progress}%
              </Text>
              <Progress 
                value={formData.progress} 
                size="lg" 
                color={formData.progress === 100 ? 'green' : 'blue'}
                mb="xs"
              />
              <NumberInput
                value={formData.progress}
                onChange={(value) => handleInputChange('progress', Math.min(100, Math.max(0, Number(value) || 0)))}
                min={0}
                max={100}
                suffix="%"
                size="sm"
              />
            </Box>

            <TagsInput
              label="Tags"
              placeholder="Add tags..."
              value={formData.tags}
              onChange={(value) => handleInputChange('tags', value)}
            />

            <TextInput
              label="Due Date"
              type="date"
              value={formData.dueDate}
              onChange={(event) => handleInputChange('dueDate', event.currentTarget.value)}
            />

            <Group justify="flex-end" gap="sm" mt="lg">
              <Button
                variant="outline"
                onClick={handleClose}
                disabled={isLoading || isDeleting}
              >
                Cancel
              </Button>
              
              <Button
                type="submit"
                loading={isLoading}
                disabled={!formData.title.trim() || isDeleting}
                leftSection={<IconEdit size={16} />}
              >
                Save Changes
              </Button>
            </Group>
          </Stack>
        </form>
      </Stack>
    </Modal>
  );
};