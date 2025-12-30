import React, { useCallback, useMemo, useState } from 'react';
import {
  Card,
  Text,
  Group,
  Badge,
  ActionIcon,
  Menu,
  Avatar,
  Progress,
  Stack,
  Box,
  Tooltip,
  ThemeIcon,
  Indicator,
} from '@mantine/core';
import {
  useSortable,
  defaultAnimateLayoutChanges,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  IconGripVertical,
  IconEdit,
  IconCopy,
  IconTrash,
  IconEye,
  IconChevronRight,
  IconPaperclip,
  IconMessage,
  IconCalendar,
  IconFlag,
  IconPlus,
  IconChevronDown,
} from '@tabler/icons-react';
import type { KanbanCard as KanbanCardType } from '../../schema';
import { useResponsive, responsiveUtils, getResponsiveProps } from '../../utils';
import { useKanbanStore } from '../../state';
import { AsyncImage } from '../AsyncImage';

interface KanbanCardProps {
  card: KanbanCardType;
  onEdit?: (card: KanbanCardType) => void;
  onClick?: (card: KanbanCardType) => void;
  onDuplicate?: (card: KanbanCardType) => void;
  onDelete?: (card: KanbanCardType) => void;
  onView?: (card: KanbanCardType) => void;
  onAddChild?: (parentCard: KanbanCardType) => void;
  onNavigateToChildren?: (parentCard: KanbanCardType) => void;
  isSelected?: boolean;
  isDragging?: boolean;
  style?: React.CSSProperties;
  className?: string;
}

// Helper functions moved outside component to avoid recreation
const getPriorityColor = (priority: string | undefined): string => {
  switch (priority?.toLowerCase()) {
    case 'high':
    case 'urgent':
      return 'red';
    case 'medium':
      return 'yellow';
    case 'low':
      return 'blue';
    default:
      return 'gray';
  }
};

const getDueDateStatus = (dueDate: string | undefined) => {
  if (!dueDate) return null;
  
  const due = new Date(dueDate);
  const now = new Date();
  const diffDays = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  
  if (diffDays < 0) {
    return { color: 'red', label: 'Overdue' };
  } else if (diffDays === 0) {
    return { color: 'orange', label: 'Due today' };
  } else if (diffDays <= 3) {
    return { color: 'yellow', label: `Due in ${diffDays} days` };
  }
  return { color: 'gray', label: `Due ${due.toLocaleDateString()}` };
};

const KanbanCardComponent: React.FC<KanbanCardProps> = ({
  card,
  onEdit,
  onClick,
  onDuplicate,
  onDelete,
  onView,
  onAddChild,
  onNavigateToChildren,
  isSelected = false,
  isDragging = false,
  style,
  className,
}) => {
  // Hooks
  const screenSize = useResponsive();
  const [menuOpened, setMenuOpened] = useState(false);
  
  // Removed cardScale subscription - scaling is handled at board level via CSS transform
  
  // Drag and drop
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({
    id: card.id,
    disabled: isDragging,
    data: {
      type: 'card',
      cardId: card.id, // Optimize: Only pass ID, not full object
    },
    // Optimize: Skip layout animations for better performance with many cards
    animateLayoutChanges: (args) => 
      args.isSorting || args.wasDragging ? defaultAnimateLayoutChanges(args) : true,
  });
  
  // Transform for dragging
  const dragStyle = {
    transform: CSS.Transform.toString(transform),
    transition: isSortableDragging ? undefined : transition, // Optimize: Remove transition when dragging
  };
  
  // Get responsive props
  const responsiveProps = useMemo(() => 
    getResponsiveProps(screenSize),
    [screenSize]
  );
  
  // Extract metadata for display
  const priority = card.metadata?.priority;
  const assignee = card.metadata?.assignee;
  const dueDate = card.metadata?.dueDate;
  const storyPoints = card.metadata?.storyPoints;
  const progress = card.metadata?.progress;
  const attachmentCount = card.metadata?.attachmentCount || 0;
  const commentCount = card.metadata?.commentCount || 0;
  const childrenCount = card.children?.length || 0;
  
  const dueDateStatus = getDueDateStatus(dueDate);
  
  // Handle card click
  const handleClick = useCallback((event: React.MouseEvent) => {
    if (menuOpened) return;
    
    event.preventDefault();
    event.stopPropagation();
    
    onClick?.(card);
  }, [onClick, card, menuOpened]);
  
  // Handle menu actions
  const handleEdit = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    setMenuOpened(false);
    onEdit?.(card);
  }, [onEdit, card]);
  
  const handleDuplicate = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    setMenuOpened(false);
    onDuplicate?.(card);
  }, [onDuplicate, card]);
  
  const handleDelete = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    setMenuOpened(false);
    onDelete?.(card);
  }, [onDelete, card]);
  
  const handleView = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    setMenuOpened(false);
    onView?.(card);
  }, [onView, card]);
  
  const handleAddChild = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    setMenuOpened(false);
    onAddChild?.(card);
  }, [onAddChild, card]);
  
  const handleNavigateToChildren = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    setMenuOpened(false);
    onNavigateToChildren?.(card);
  }, [onNavigateToChildren, card]);
  
  const cardSize = responsiveUtils.getCardSize(screenSize);
  const isCompact = cardSize === 'compact';
  const spacing = isCompact ? 'xs' : 'sm';
  
  return (
    <Card
      ref={setNodeRef}
      className={className}
      style={{
        ...dragStyle,
        ...style,
        cursor: isDragging ? 'grabbing' : 'grab',
        opacity: isSortableDragging || isDragging ? 0.6 : 1,
        border: isSelected ? '2px solid var(--mantine-color-blue-5)' : undefined,
        boxShadow: isSelected 
          ? 'var(--mantine-shadow-md)' 
          : (isDragging || isSortableDragging)
          ? 'var(--mantine-shadow-xl)' 
          : undefined,
        zIndex: isSortableDragging || isDragging ? 1000 : 1,
        transition: 'none',
        willChange: isSortableDragging || isDragging ? 'transform, opacity' : 'auto',
      }}
      padding={responsiveProps.padding}
      radius="md"
      withBorder
      onClick={handleClick}
      {...attributes}
      {...listeners}
    >
      <Stack gap={spacing}>
        {/* Header with drag handle and menu */}
        <Group justify="space-between" gap="xs">
          <Tooltip label="Drag to reorder">
            <Box
              {...attributes}
              {...listeners}
              style={{ 
                cursor: 'grab',
                padding: '4px',
                borderRadius: '4px',
                transition: 'background-color 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--mantine-color-gray-1)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              <IconGripVertical 
                size={16} 
                color="var(--mantine-color-gray-5)" 
                style={{ display: 'block' }}
              />
            </Box>
          </Tooltip>
          
          <Menu
            opened={menuOpened}
            onChange={setMenuOpened}
            position="bottom-end"
            withArrow
            shadow="md"
          >
            <Menu.Target>
              <ActionIcon
                variant="subtle"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpened(true);
                }}
              >
                <IconChevronRight size={12} />
              </ActionIcon>
            </Menu.Target>
            
            <Menu.Dropdown>
              {onView && (
                <Menu.Item
                  leftSection={<IconEye size={14} />}
                  onClick={handleView}
                >
                  View Details
                </Menu.Item>
              )}
              
              {onEdit && (
                <Menu.Item
                  leftSection={<IconEdit size={14} />}
                  onClick={handleEdit}
                >
                  Edit
                </Menu.Item>
              )}
              
              {onDuplicate && (
                <Menu.Item
                  leftSection={<IconCopy size={14} />}
                  onClick={handleDuplicate}
                >
                  Duplicate
                </Menu.Item>
              )}
              
              {onAddChild && (
                <Menu.Item
                  leftSection={<IconPlus size={14} />}
                  onClick={handleAddChild}
                >
                  Add Child Card
                </Menu.Item>
              )}
              
              {onNavigateToChildren && childrenCount > 0 && (
                <Menu.Item
                  leftSection={<IconChevronDown size={14} />}
                  onClick={handleNavigateToChildren}
                >
                  View Children ({childrenCount})
                </Menu.Item>
              )}
              
              <Menu.Divider />
              
              {onDelete && (
                <Menu.Item
                  leftSection={<IconTrash size={14} />}
                  color="red"
                  onClick={handleDelete}
                >
                  Delete
                </Menu.Item>
              )}
            </Menu.Dropdown>
          </Menu>
        </Group>
        
        {/* Title */}
        <Text
          size={isCompact ? 'sm' : 'md'}
          fw={500}
          lineClamp={2}
          title={card.title}
        >
          {card.title}
        </Text>
        
        {/* Image */}
        {card.imageUrl && !isCompact && (
          <AsyncImage
            src={card.imageUrl}
            alt={card.title}
            height={160}
            fit="cover"
            radius="sm"
            placeholder="https://via.placeholder.com/300x160?text=Loading..."
          />
        )}
        
        {/* Description */}
        {card.description && !isCompact && (
          <Text
            size="xs"
            c="dimmed"
            lineClamp={3}
            title={card.description}
          >
            {card.description}
          </Text>
        )}
        
        {/* Priority and Due Date */}
        {(priority || dueDateStatus) && (
          <Group gap="xs">
            {priority && (
              <Badge
                variant="light"
                color={getPriorityColor(priority)}
                size="xs"
                leftSection={<IconFlag size={10} />}
              >
                {priority}
              </Badge>
            )}
            
            {dueDateStatus && (
              <Tooltip label={dueDateStatus.label}>
                <Badge
                  variant="light"
                  color={dueDateStatus.color}
                  size="xs"
                  leftSection={<IconCalendar size={10} />}
                >
                  {dueDateStatus.color === 'red' ? 'Overdue' : 'Due'}
                </Badge>
              </Tooltip>
            )}
          </Group>
        )}
        
        {/* Progress */}
        {progress !== undefined && !isCompact && (
          <Box>
            <Group justify="space-between" gap="xs" mb={4}>
              <Text size="xs" c="dimmed">Progress</Text>
              <Text size="xs" c="dimmed">{progress}%</Text>
            </Group>
            <Progress
              value={progress}
              size="xs"
              color={progress >= 100 ? 'green' : progress >= 50 ? 'blue' : 'orange'}
            />
          </Box>
        )}
        
        {/* Story Points */}
        {storyPoints !== undefined && (
          <Group justify="space-between">
            <Text size="xs" c="dimmed">Story Points</Text>
            <ThemeIcon size="sm" variant="light" color="blue">
              <Text size="xs" fw={600}>{storyPoints}</Text>
            </ThemeIcon>
          </Group>
        )}
        
        {/* Footer with assignee and counts */}
        <Group justify="space-between" gap="xs">
          {/* Assignee */}
          {assignee && (
            <Tooltip label={assignee}>
              <Avatar
                size={isCompact ? 20 : 24}
                src={card.metadata?.assigneeAvatar}
                color="blue"
                radius="xl"
              >
                {assignee.charAt(0).toUpperCase()}
              </Avatar>
            </Tooltip>
          )}
          
          {/* Counters */}
          <Group gap="xs">
            {childrenCount > 0 && (
              <Tooltip label={`View ${childrenCount} child card${childrenCount !== 1 ? 's' : ''}`}>
                <Indicator
                  label={childrenCount}
                  size={16}
                  color="blue"
                  position="top-end"
                  onClick={(e) => {
                    e.stopPropagation();
                    onNavigateToChildren?.(card);
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <ThemeIcon 
                    size="sm" 
                    variant="light" 
                    color="blue"
                    style={{ cursor: 'pointer' }}
                  >
                    <IconChevronDown size={12} />
                  </ThemeIcon>
                </Indicator>
              </Tooltip>
            )}
            
            {attachmentCount > 0 && (
              <Indicator
                label={attachmentCount}
                size={16}
                color="gray"
                position="top-end"
              >
                <ThemeIcon size="sm" variant="light" color="gray">
                  <IconPaperclip size={12} />
                </ThemeIcon>
              </Indicator>
            )}
            
            {commentCount > 0 && (
              <Indicator
                label={commentCount}
                size={16}
                color="green"
                position="top-end"
              >
                <ThemeIcon size="sm" variant="light" color="gray">
                  <IconMessage size={12} />
                </ThemeIcon>
              </Indicator>
            )}
          </Group>
        </Group>
      </Stack>
    </Card>
  );
};

// Memoize to prevent re-renders when props haven't changed
export const KanbanCard = React.memo(KanbanCardComponent, (prevProps, nextProps) => {
  // Return true to SKIP re-render, false to RE-RENDER
  // Re-render only if critical props have changed
  if (prevProps.card.id !== nextProps.card.id) return false;
  if (prevProps.card.title !== nextProps.card.title) return false;
  if (prevProps.card.status !== nextProps.card.status) return false;
  if (prevProps.card.updatedAt !== nextProps.card.updatedAt) return false;
  if (prevProps.isSelected !== nextProps.isSelected) return false;
  if (prevProps.isDragging !== nextProps.isDragging) return false;
  
  // Props haven't changed, skip re-render
  return true;
});

export default KanbanCard;