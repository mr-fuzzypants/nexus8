import React, { useState, useCallback } from 'react';
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
} from '@mantine/core';
import { IconPlus, IconX, IconPhoto } from '@tabler/icons-react';
import type { KanbanCard } from '../../schema';
import { useKanbanStore } from '../../state';
import { AsyncImage } from '../AsyncImage';

interface AddChildCardModalProps {
  opened: boolean;
  onClose: () => void;
  parentCard: KanbanCard | null;
}

export const AddChildCardModal: React.FC<AddChildCardModalProps> = ({
  opened,
  onClose,
  parentCard,
}) => {
  const { actions, kanbanSchema, cardSchema } = useKanbanStore();
  
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    imageUrl: '',
    status: '',
    assignee: '',
    priority: 'medium',
  });

  const [isLoading, setIsLoading] = useState(false);

  // Reset form when modal opens/closes or parent changes
  React.useEffect(() => {
    if (opened && parentCard) {
      setFormData({
        title: '',
        description: '',
        imageUrl: '',
        status: parentCard.status, // Default to parent's status
        assignee: '',
        priority: 'medium',
      });
    }
  }, [opened, parentCard]);

  const handleInputChange = useCallback((field: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: value,
    }));
  }, []);

  const handleSubmit = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    
    if (!parentCard || !formData.title.trim()) {
      return;
    }

    setIsLoading(true);

    try {
      const childCardData = {
        title: formData.title.trim(),
        description: formData.description.trim(),
        imageUrl: formData.imageUrl.trim() || undefined,
        status: formData.status || parentCard.status,
        metadata: {
          priority: formData.priority,
          assignee: formData.assignee || undefined,
        },
      };

      actions.createChildCard(parentCard.id, childCardData);
      onClose();
    } catch (error) {
      console.error('Error creating child card:', error);
    } finally {
      setIsLoading(false);
    }
  }, [parentCard, formData, actions, onClose]);

  const handleClose = useCallback(() => {
    setFormData({
      title: '',
      description: '',
      imageUrl: '',
      status: '',
      assignee: '',
      priority: 'medium',
    });
    onClose();
  }, [onClose]);

  // Get available status options
  const statusOptions = kanbanSchema.statuses.map(status => ({
    value: status.id,
    label: status.label,
  }));

  // Get available assignee options (from metadata fields)
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

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title={
        <Group gap="sm">
          <IconPlus size={20} />
          <Text size="lg" fw={600}>Add Child Card</Text>
        </Group>
      }
      size="md"
      centered
      closeButtonProps={{
        'aria-label': 'Close modal',
        icon: <IconX size={16} />,
      }}
    >
      {parentCard && (
        <Box mb="md">
          <Text size="sm" c="dimmed" mb="xs">
            Adding child to:
          </Text>
          <Group gap="xs">
            <Badge variant="light" color="blue">
              {parentCard.title}
            </Badge>
            <Badge variant="outline" size="xs">
              {kanbanSchema.statuses.find(s => s.id === parentCard.status)?.label || parentCard.status}
            </Badge>
          </Group>
        </Box>
      )}

      <form onSubmit={handleSubmit}>
        <Stack gap="md">
          <TextInput
            label="Title"
            placeholder="Enter child card title..."
            value={formData.title}
            onChange={(event) => handleInputChange('title', event.currentTarget.value)}
            required
            data-autofocus
          />

          <Textarea
            label="Description"
            placeholder="Enter child card description..."
            value={formData.description}
            onChange={(event) => handleInputChange('description', event.currentTarget.value)}
            minRows={3}
            maxRows={6}
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

          <Select
            label="Status"
            placeholder="Select status"
            value={formData.status}
            onChange={(value) => handleInputChange('status', value || '')}
            data={statusOptions}
          />

          <Select
            label="Priority"
            placeholder="Select priority"
            value={formData.priority}
            onChange={(value) => handleInputChange('priority', value || 'medium')}
            data={priorityOptions}
          />

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

          <Group justify="flex-end" gap="sm">
            <Button
              variant="outline"
              onClick={handleClose}
              disabled={isLoading}
            >
              Cancel
            </Button>
            
            <Button
              type="submit"
              loading={isLoading}
              disabled={!formData.title.trim()}
              leftSection={<IconPlus size={16} />}
            >
              Create Child Card
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
};