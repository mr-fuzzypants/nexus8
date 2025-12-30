import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Box,
  ScrollArea,
  Group,
  ActionIcon,
  Tooltip,
  LoadingOverlay,
  Text,
} from '@mantine/core';
import {
  DndContext,
  DragOverlay,
  DragStartEvent,
  DragEndEvent,
  DragOverEvent,
  pointerWithin,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
  IconSettings,
  IconFilter,
  IconSearch,
  IconRefresh,
} from '@tabler/icons-react';
import { useKanbanStore } from '../../state';
import { useResponsive, responsiveUtils } from '../../utils';
import { useScaleKeyboardShortcuts } from '../../hooks/useScaleKeyboardShortcuts';
import { KanbanColumn } from './KanbanColumn';
import { KanbanCard } from './KanbanCard';
import { KanbanDragOverlay } from './KanbanDragOverlay';
import { AddChildCardModal } from './AddChildCardModal';
import { CardEditorModal } from './CardEditorModal';
import { ScaleControls } from './ScaleControls';
import type { KanbanCard as KanbanCardType } from '../../schema';

interface KanbanBoardProps {
  onCardClick?: (card: KanbanCardType) => void;
  onCardEdit?: (card: KanbanCardType) => void;
  onNewCard?: (status: string) => void;
  onSettingsClick?: () => void;
  onFilterClick?: () => void;
  onSearchClick?: () => void;
  className?: string;
  style?: React.CSSProperties;
}

export const KanbanBoard: React.FC<KanbanBoardProps> = ({
  onCardClick,
  onCardEdit,
  onNewCard,
  onSettingsClick,
  onFilterClick,
  onSearchClick,
  className,
  style,
}) => {
  // Hooks
  const screenSize = useResponsive();
  const boardRef = useRef<HTMLDivElement>(null);
  
  // Modal state
  const [isAddChildModalOpen, setIsAddChildModalOpen] = useState(false);
  const [parentCardForChild, setParentCardForChild] = useState<KanbanCardType | null>(null);
  
  // Store state - use specific selectors for better reactivity
  // Don't subscribe to cards object - use getState() for direct access to avoid re-renders
  const cardOrder = useKanbanStore(state => state.cardOrder);
  const kanbanSchema = useKanbanStore(state => state.kanbanSchema);
  const ui = useKanbanStore(state => state.ui);
  const selection = useKanbanStore(state => state.selection);
  const getFilteredCards = useKanbanStore(state => state.getFilteredCards);
  const actions = useKanbanStore(state => state.actions);
  
  // Enable keyboard shortcuts for scaling
  useScaleKeyboardShortcuts();
  
  // Drag and drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 0, // Optimize: Instant start (was 3)
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );
  
  // Status definitions from schema
  const statuses = useMemo(() => 
    kanbanSchema.statuses || [],
    [kanbanSchema.statuses]
  );
  
  // Get filtered cards for current path - use cardOrder to detect changes
  const filteredCardsArray = useMemo(() => {
    return getFilteredCards(ui.currentPath);
  }, [getFilteredCards, ui.currentPath, cardOrder]); // Use cardOrder instead of cards
  
  // Group cards by status
  const cardsByStatus = useMemo(() => {
    const grouped: Record<string, KanbanCardType[]> = {};
    
    // Initialize groups
    statuses.forEach((status) => {
      grouped[status.id] = [];
    });
    
    // Group cards by status
    filteredCardsArray.forEach((card) => {
      if (grouped[card.status]) {
        grouped[card.status].push(card);
      }
    });
    
    // Sort cards within each status using the cardOrder from the store
    const currentPath = ui.currentPath;
    const pathCardOrder = useKanbanStore.getState().cardOrder[currentPath] || {};
    
    // Pre-create all orderMaps at once to avoid repeated map creation during sort
    const orderMaps = new Map<string, Map<string, number>>();
    Object.keys(grouped).forEach(statusId => {
      const statusCardOrder = pathCardOrder[statusId] || [];
      orderMaps.set(statusId, new Map(statusCardOrder.map((id, index) => [id, index])));
    });
    
    // Sort each status group
    Object.keys(grouped).forEach(statusId => {
      const statusCards = grouped[statusId];
      const orderMap = orderMaps.get(statusId)!;
      
      // Sort by the explicit order from cardOrder, then by position/date as fallback
      statusCards.sort((a, b) => {
        const aOrderIndex = orderMap.get(a.id) ?? -1;
        const bOrderIndex = orderMap.get(b.id) ?? -1;
        
        // If both cards are in the explicit order, use that
        if (aOrderIndex !== -1 && bOrderIndex !== -1) {
          return aOrderIndex - bOrderIndex;
        }
        
        // If only one is in the explicit order, it comes first
        if (aOrderIndex !== -1) return -1;
        if (bOrderIndex !== -1) return 1;
        
        // If neither is in explicit order, fall back to position or creation date
        const aPos = a.metadata?.position || 0;
        const bPos = b.metadata?.position || 0;
        if (aPos !== bPos) return aPos - bPos;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      });
    });
    
    return grouped;
  }, [filteredCardsArray, statuses, ui.currentPath]);
  
  // Calculate responsive column widths
  const columnWidths = useMemo(() => {
    if (!boardRef.current) return [];
    const containerWidth = boardRef.current.offsetWidth || 1200;
    return responsiveUtils.getColumnWidths(screenSize, statuses.length, containerWidth);
  }, [screenSize, statuses.length]);
  
  // Get responsive props
  const responsiveProps = useMemo(() => ({
    spacing: screenSize.isMobile ? 'xs' : 'sm',
    columnWidth: screenSize.isMobile ? 280 : 320,
  }), [screenSize]);
  
  // Handle drag start
  const handleDragStart = useCallback((event: DragStartEvent) => {
    // No need to set active card state here as it's handled in KanbanDragOverlay
  }, []);
  
  // Handle drag over
  const handleDragOver = useCallback((event: DragOverEvent) => {
    // Optional: Add visual feedback during drag
  }, []);
  
  // Handle drag end
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    
    if (!over) {
      return;
    }
    
    const cardId = active.id as string;
    const overId = over.id as string;
    
    // Get current state directly to avoid stale closures
    const state = useKanbanStore.getState();
    const cards = state.cards;
    
    // Check if dropping on a column (format: 'column-{statusId}')
    if (overId.startsWith('column-')) {
      const statusId = overId.replace('column-', '');
      const card = cards[cardId];
      
      if (card && card.status !== statusId) {
        actions.moveCard(cardId, statusId);
      }
      return;
    }
    
    // Check if dropping on another card
    const targetCard = cards[overId];
    const sourceCard = cards[cardId];
    
    if (targetCard && sourceCard) {
      // If cards are in the same status, handle reordering
      if (sourceCard.status === targetCard.status) {
        // Optimize: Use cardOrder directly instead of sorting objects
        const currentPath = state.ui.currentPath;
        const statusCardOrder = state.cardOrder[currentPath]?.[sourceCard.status] || [];
        
        const sourceIndex = statusCardOrder.indexOf(sourceCard.id);
        const targetIndex = statusCardOrder.indexOf(targetCard.id);
        
        // Only reorder if positions are different
        if (sourceIndex !== -1 && targetIndex !== -1 && sourceIndex !== targetIndex) {
          actions.moveCard(cardId, sourceCard.status, targetIndex);
        }
      } else {
        // Moving between different statuses
        actions.moveCard(cardId, targetCard.status);
      }
    }
  }, [actions]);
  
  // Handle card operations
  const handleCardClick = useCallback((card: KanbanCardType) => {
    actions.selectCard(card.id);
    onCardClick?.(card);
  }, [actions, onCardClick]);
  
  const handleCardEdit = useCallback((card: KanbanCardType) => {
    actions.openCardEditor(card.id);
  }, [actions]);
  
  const handleCardDuplicate = useCallback((card: KanbanCardType) => {
    actions.duplicateCard(card.id);
  }, [actions]);
  
  const handleCardDelete = useCallback((card: KanbanCardType) => {
    actions.deleteCard(card.id);
  }, [actions]);
  
  const handleCardAddChild = useCallback((parentCard: KanbanCardType) => {
    setParentCardForChild(parentCard);
    setIsAddChildModalOpen(true);
  }, []);
  
  const handleCardNavigateToChildren = useCallback((parentCard: KanbanCardType) => {
    // Navigate to the children's path, which is currentPath/parentId
    const childrenPath = `${ui.currentPath}/${parentCard.id}`;
    actions.navigateToPath(childrenPath);
  }, [actions, ui.currentPath]);
  
  const handleCloseAddChildModal = useCallback(() => {
    setIsAddChildModalOpen(false);
    setParentCardForChild(null);
  }, []);
  
  const handleNewCard = useCallback((statusId: string) => {
    onNewCard?.(statusId);
  }, [onNewCard]);
  
  const handleRefresh = useCallback(() => {
    // Refresh data if needed
    window.location.reload();
  }, []);
  
  return (
    <Box
      ref={boardRef}
      className={className}
      style={{
        height: '100%',
        width: '100%',
        position: 'relative',
        ...style,
      }}
    >
      <LoadingOverlay visible={ui.loading} />
      
      {/* Board Header */}
      <Box
        p={responsiveProps.spacing}
        style={{
          borderBottom: '1px solid var(--mantine-color-gray-3)',
          backgroundColor: 'var(--mantine-color-white)',
        }}
      >
        <Group justify="space-between">
          <Text size="lg" fw={600}>
            {kanbanSchema.name || 'Kanban Board'}
          </Text>
          
          <Group gap="xs">
            <ScaleControls />
            
            <Tooltip label="Search">
              <ActionIcon
                variant="subtle"
                onClick={onSearchClick}
              >
                <IconSearch size={18} />
              </ActionIcon>
            </Tooltip>
            
            <Tooltip label="Filter">
              <ActionIcon
                variant="subtle"
                onClick={onFilterClick}
              >
                <IconFilter size={18} />
              </ActionIcon>
            </Tooltip>
            
            <Tooltip label="Settings">
              <ActionIcon
                variant="subtle"
                onClick={onSettingsClick}
              >
                <IconSettings size={18} />
              </ActionIcon>
            </Tooltip>
            
            <Tooltip label="Refresh">
              <ActionIcon
                variant="subtle"
                onClick={handleRefresh}
              >
                <IconRefresh size={18} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      </Box>
      
      {/* Board Content */}
      <Box style={{ flex: 1, overflow: 'hidden' }}>
        <DndContext
          sensors={sensors}
          collisionDetection={pointerWithin}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <ScrollArea
            h="100%"
            type="auto"
            scrollbars="xy"
          >
            <Box
              p={responsiveProps.spacing}
              style={{
                minWidth: 'fit-content',
                height: '100%',
                transform: `scale(${typeof ui.boardScale === 'number' && !isNaN(ui.boardScale) ? ui.boardScale : 1.0})`,
                transformOrigin: 'top left',
                transition: 'transform 0.1s ease-in-out',
              }}
            >
              <SortableContext
                items={statuses.map((status) => status.id)}
                strategy={horizontalListSortingStrategy}
              >
                <Group
                  gap={responsiveProps.spacing}
                  align="flex-start"
                  wrap="nowrap"
                >
                  {statuses.map((status, index) => (
                    <KanbanColumn
                      key={status.id}
                      status={status}
                      cards={cardsByStatus[status.id] || []}
                      selectedCardIds={selection.multiSelection}
                      onCardClick={handleCardClick}
                      onCardEdit={handleCardEdit}
                      onCardDuplicate={handleCardDuplicate}
                      onCardDelete={handleCardDelete}
                      onCardAddChild={handleCardAddChild}
                      onCardNavigateToChildren={handleCardNavigateToChildren}
                      onNewCard={handleNewCard}
                      style={{
                        width: columnWidths[index] || responsiveProps.columnWidth,
                      }}
                    />
                  ))}
                </Group>
              </SortableContext>
            </Box>
          </ScrollArea>
          
          {/* Drag Overlay */}
          <KanbanDragOverlay />
        </DndContext>
        
        {/* Add Child Card Modal */}
        <AddChildCardModal
          opened={isAddChildModalOpen}
          onClose={handleCloseAddChildModal}
          parentCard={parentCardForChild}
        />
        
        {/* Card Editor Modal */}
        <CardEditorModal
          opened={ui.cardEditorOpen}
          onClose={() => actions.closeCardEditor()}
          cardId={selection.selectedCardId || null}
        />
      </Box>
    </Box>
  );
};

export default KanbanBoard;