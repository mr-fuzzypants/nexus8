import React, { useState, useMemo, useCallback } from 'react';
import {
  Box,
  Card,
  Text,
  Badge,
  ActionIcon,
  Group,
  Collapse,
  Button,
  Stack,
  Tooltip,
} from '@mantine/core';
import {
  IconChevronDown,
  IconChevronUp,
  IconPlus,
  IconDotsVertical,
} from '@tabler/icons-react';
import { useDroppable } from '@dnd-kit/core';
import { useSortable, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { KanbanCard } from './KanbanCard';
import { CardVirtualList } from './CardVirtualList';
import { useResponsive } from '../../utils';
import type { KanbanCard as KanbanCardType } from '../../schema';

// Status definition interface (matching schema)
interface StatusDefinition {
  id: string;
  label: string;
  order: number;
  color?: string;
  description?: string;
  allowDrop?: boolean;
  allowDrag?: boolean;
  isInitial?: boolean;
  isFinal?: boolean;
  showCardCount?: boolean;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  wipLimit?: number;
  maxCards?: number;
  mobileOrder?: number;
}

interface KanbanColumnProps {
  status: StatusDefinition;
  cards: KanbanCardType[];
  selectedCardIds?: string[];
  onCardClick?: (card: KanbanCardType) => void;
  onCardEdit?: (card: KanbanCardType) => void;
  onCardDuplicate?: (card: KanbanCardType) => void;
  onCardDelete?: (card: KanbanCardType) => void;
  onCardView?: (card: KanbanCardType) => void;
  onCardAddChild?: (parentCard: KanbanCardType) => void;
  onCardNavigateToChildren?: (parentCard: KanbanCardType) => void;
  onNewCard?: (statusId: string) => void;
  onColumnSettingsClick?: (columnId: string) => void;
  enableVirtualization?: boolean;
  itemSize?: number;
  maxHeight?: number;
  className?: string;
  style?: React.CSSProperties;
}

interface DropZoneProps {
  statusId: string;
  statusLabel: string;
  statusColor: string;
  isCollapsed: boolean;
  enableVirtualization: boolean;
  cardsLength: number;
  maxHeight: number;
  responsiveProps: { spacing: string | number };
  onNewCard?: () => void;
  children: React.ReactNode;
}

const KanbanColumnDropZone: React.FC<DropZoneProps> = React.memo(({
  statusId,
  statusLabel,
  statusColor,
  isCollapsed,
  enableVirtualization,
  cardsLength,
  maxHeight,
  responsiveProps,
  onNewCard,
  children
}) => {
  const { setNodeRef, isOver } = useDroppable({
    id: `column-${statusId}`,
    data: { type: 'column', statusId },
  });

  return (
    <Collapse in={!isCollapsed}>
      <Box 
        ref={setNodeRef}
        p={responsiveProps.spacing} 
        style={{ 
          minHeight: 100,
          ...(enableVirtualization && cardsLength > 10 ? {} : {
            maxHeight: maxHeight,
            overflowY: 'auto',
            overflowX: 'hidden',
          }),
          backgroundColor: isOver ? 'var(--mantine-color-blue-0)' : undefined,
          borderRadius: isOver ? 'var(--mantine-radius-md)' : undefined,
          border: isOver ? '2px dashed var(--mantine-color-blue-4)' : '2px dashed transparent',
          transition: 'background-color 0.2s ease, border-color 0.2s ease',
        }}
      >
        {cardsLength === 0 ? (
          /* Empty State */
          <Stack align="center" py="xl" gap="sm">
            <Text size="sm" c="dimmed" ta="center">
              {isOver ? "Drop card here" : `No cards in ${statusLabel}`}
            </Text>
            {onNewCard && !isOver && (
              <Button
                variant="light"
                color={statusColor}
                size="sm"
                leftSection={<IconPlus size={16} />}
                onClick={onNewCard}
              >
                Add first card
              </Button>
            )}
          </Stack>
        ) : (
          children
        )}
      </Box>
    </Collapse>
  );
});

export const KanbanColumn: React.FC<KanbanColumnProps> = ({
  status,
  cards,
  selectedCardIds = [],
  onCardClick,
  onCardEdit,
  onCardDuplicate,
  onCardDelete,
  onCardView,
  onCardAddChild,
  onCardNavigateToChildren,
  onNewCard,
  onColumnSettingsClick,
  enableVirtualization = true,
  itemSize = 160,
  maxHeight = 600,
  className,
  style,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const screenSize = useResponsive();

  // Optimize: Memoize card IDs for SortableContext to prevent unnecessary updates
  const cardIds = useMemo(() => cards.map(c => c.id), [cards]);

  // Drag and drop setup for column reordering
  const {
    setNodeRef: setSortableRef,
    attributes: sortableAttributes,
    listeners: sortableListeners,
  } = useSortable({
    id: status.id,
    data: { type: 'column', status },
  });

  // Responsive props
  const responsiveProps = useMemo(() => ({
    spacing: screenSize.isMobile ? 'xs' : 'sm',
    cardSpacing: screenSize.isMobile ? 'xs' : 'sm',
  }), [screenSize]);

  // Check for WIP limit violations
  const wipViolation = useMemo(() => {
    return status.wipLimit && cards.length > status.wipLimit;
  }, [status.wipLimit, cards.length]);

  // Event handlers
  const handleToggleCollapse = useCallback(() => {
    setIsCollapsed(!isCollapsed);
  }, [isCollapsed]);

  const handleNewCard = useCallback(() => {
    onNewCard?.(status.id);
  }, [onNewCard, status.id]);

  const handleCardClick = useCallback((card: KanbanCardType) => {
    onCardClick?.(card);
  }, [onCardClick]);

  const handleCardEdit = useCallback((card: KanbanCardType) => {
    onCardEdit?.(card);
  }, [onCardEdit]);

  const handleCardDuplicate = useCallback((card: KanbanCardType) => {
    onCardDuplicate?.(card);
  }, [onCardDuplicate]);

  const handleCardDelete = useCallback((card: KanbanCardType) => {
    onCardDelete?.(card);
  }, [onCardDelete]);

  // Virtualization settings
  const virtualizationHeight = useMemo(() => {
    return screenSize.isMobile ? Math.min(maxHeight, 300) : maxHeight;
  }, [screenSize.isMobile, maxHeight]);

  // Status color for theming
  const statusColor = status.color || 'blue';

  return (
    <Card
      ref={setSortableRef}
      className={className}
      style={{
        minWidth: screenSize.isMobile ? 280 : 320,
        maxWidth: screenSize.isMobile ? 320 : 380,
        borderColor: wipViolation 
          ? 'var(--mantine-color-red-5)'
          : undefined,
        borderWidth: wipViolation ? 2 : 1,
        ...style,
      }}
      padding={0}
      radius="md"
      withBorder
    >
      <Stack gap={0}>
        {/* Column Header */}
        <Box
          p={responsiveProps.spacing}
          style={{
            borderBottom: '1px solid var(--mantine-color-gray-3)',
            backgroundColor: `var(--mantine-color-${statusColor}-0)`,
            borderRadius: 'var(--mantine-radius-md) var(--mantine-radius-md) 0 0',
          }}
          {...sortableAttributes}
          {...sortableListeners}
        >
          <Group justify="space-between" gap="xs">
            {/* Title and count */}
            <Group gap="xs" style={{ flex: 1 }}>
              {status.collapsible && (
                <ActionIcon
                  variant="subtle"
                  size="sm"
                  onClick={handleToggleCollapse}
                >
                  {isCollapsed ? (
                    <IconChevronDown size={16} />
                  ) : (
                    <IconChevronUp size={16} />
                  )}
                </ActionIcon>
              )}
              
              <Text
                size={screenSize.isMobile ? 'sm' : 'md'}
                fw={600}
                style={{ color: `var(--mantine-color-${statusColor}-7)` }}
                lineClamp={1}
              >
                {status.label}
              </Text>
              
              {status.showCardCount && (
                <Badge
                  variant="light"
                  color={wipViolation ? 'red' : statusColor}
                  size="xs"
                >
                  {cards.length}
                  {status.wipLimit && ` / ${status.wipLimit}`}
                </Badge>
              )}
            </Group>
            
            {/* Actions */}
            <Group gap="xs">
              {onNewCard && (
                <Tooltip label="Add card">
                  <ActionIcon
                    variant="light"
                    color={statusColor}
                    size="sm"
                    onClick={handleNewCard}
                  >
                    <IconPlus size={16} />
                  </ActionIcon>
                </Tooltip>
              )}
              
              {onColumnSettingsClick && (
                <Tooltip label="Column settings">
                  <ActionIcon
                    variant="subtle"
                    size="sm"
                    onClick={() => onColumnSettingsClick(status.id)}
                  >
                    <IconDotsVertical size={16} />
                  </ActionIcon>
                </Tooltip>
              )}
            </Group>
          </Group>

          {/* WIP Limit Warning */}
          {wipViolation && (
            <Box mt="xs">
              <Text size="xs" c="red">
                WIP limit exceeded ({cards.length}/{status.wipLimit})
              </Text>
            </Box>
          )}
        </Box>

        {/* Cards Container */}
        <KanbanColumnDropZone
          statusId={status.id}
          statusLabel={status.label}
          statusColor={statusColor}
          isCollapsed={isCollapsed}
          enableVirtualization={enableVirtualization}
          cardsLength={cards.length}
          maxHeight={maxHeight}
          responsiveProps={responsiveProps}
          onNewCard={handleNewCard}
        >
          {enableVirtualization && cards.length > 10 ? (
            /* Virtualized List */
            <CardVirtualList
              cards={cards}
              selectedCardIds={selectedCardIds}
              onCardClick={handleCardClick}
              onCardEdit={handleCardEdit}
              onCardDuplicate={handleCardDuplicate}
              onCardDelete={handleCardDelete}
              onCardView={onCardView}
              onCardAddChild={onCardAddChild}
              onCardNavigateToChildren={onCardNavigateToChildren}
              itemSize={itemSize}
              height={virtualizationHeight}
            />
          ) : (
            /* Regular List */
            <SortableContext
              items={cardIds}
              strategy={verticalListSortingStrategy}
            >
              <Stack gap="md">
                {cards.map((card) => (
                  <Box 
                    key={card.id}
                  >
                    <KanbanCard
                      card={card}
                      onClick={handleCardClick}
                      onEdit={handleCardEdit}
                      onDuplicate={handleCardDuplicate}
                      onDelete={handleCardDelete}
                      onView={onCardView}
                      onAddChild={onCardAddChild}
                      onNavigateToChildren={onCardNavigateToChildren}
                      isSelected={selectedCardIds.includes(card.id)}
                    />
                  </Box>
                ))}
              </Stack>
            </SortableContext>
          )}
        </KanbanColumnDropZone>
      </Stack>
    </Card>
  );
};

// Memoize to prevent re-renders when props haven't changed
const KanbanColumnMemoized = React.memo(KanbanColumn, (prevProps, nextProps) => {
  // Return true to SKIP re-render, false to RE-RENDER
  if (prevProps.status.id !== nextProps.status.id) return false;
  if (prevProps.cards.length !== nextProps.cards.length) return false;
  
  const prevSelected = prevProps.selectedCardIds || [];
  const nextSelected = nextProps.selectedCardIds || [];
  if (prevSelected.length !== nextSelected.length) return false;
  
  // Check if card IDs changed (order matters)
  if (prevProps.cards.some((card, i) => card.id !== nextProps.cards[i]?.id)) return false;
  
  // Check if any card's updatedAt changed (indicates content changed)
  if (prevProps.cards.some((card, i) => card.updatedAt !== nextProps.cards[i]?.updatedAt)) return false;
  
  // Props haven't changed, skip re-render
  return true;
});

export default KanbanColumnMemoized;