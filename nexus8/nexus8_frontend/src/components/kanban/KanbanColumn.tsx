import React, { useRef, useState, useEffect } from 'react';
import { Paper, Text, Group, Badge, Box, ActionIcon, Menu } from '@mantine/core';
import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { IconDots, IconPlus, IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { shallow } from 'zustand/shallow';
import { StatusDefinition } from '../../schema/kanbanSchema';
import { useKanbanViewStore } from '../../state';
import { useDataStore } from '../../state/useDataStore';
import { CardVirtualList } from './CardVirtualList';
import { KanbanCard as KanbanCardType } from '../../schema';
import { v4 as uuidv4 } from 'uuid';

interface KanbanColumnProps {
  status: StatusDefinition;
  isAggregate?: boolean;
  onAddChild?: (card: KanbanCardType) => void;
  onCardClick?: (card: KanbanCardType) => void;
}

export const KanbanColumn = React.memo(({ status, isAggregate, onAddChild, onCardClick }: KanbanColumnProps) => {
  const currentPath = useKanbanViewStore((state) => state.ui.currentPath);
  
  const layout = useDataStore(state => state.kanbanSchema.layout);

  const dataActions = useDataStore((state) => state.actions);
  const viewActions = useKanbanViewStore((state) => state.actions);

  const cards = useDataStore(
    (state) => isAggregate 
      ? state.getCardsByAggregateStatus(currentPath, status.id)
      : state.getCardsByStatus(currentPath, status.id),
    shallow
  );

  const ref = useRef<HTMLDivElement>(null);
  const [isOver, setIsOver] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(status.defaultCollapsed && status.collapsible);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    return dropTargetForElements({
      element,
      getData: () => ({ 
        type: 'column', 
        statusId: status.id,
        isAggregate 
      }),
      onDragEnter: () => setIsOver(true),
      onDragLeave: () => setIsOver(false),
      onDrop: () => setIsOver(false),
    });
  }, [status.id, isAggregate]);

  const handleAddCard = () => {
    let targetStatusId = status.id;
    
    if (isAggregate) {
       // Find first status for this aggregate
       const firstStatus = useDataStore.getState().kanbanSchema.statuses
         .sort((a, b) => a.order - b.order)
         .find(s => s.aggregateStatus === status.id);
         
       if (firstStatus) {
         targetStatusId = firstStatus.id;
       } else {
         return; 
       }
    }

    dataActions.addCard({
      id: uuidv4(),
      title: 'New Card',
      description: '',
      status: targetStatusId,
      path: currentPath,
      metadata: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  };

  const handleEdit = (card: KanbanCardType) => {
    viewActions.setSelectedCardId(card.id);
    viewActions.setCardEditorOpen(true);
  };
  
  const handleClick = (card: KanbanCardType) => {
    if (onCardClick) {
      onCardClick(card);
    } else {
      viewActions.setSelectedCardId(card.id);
    }
  };
  
  const handleDuplicate = (card: KanbanCardType) => {
    dataActions.addCard({
      ...card,
      id: uuidv4(),
      title: `${card.title} (Copy)`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  };

  const handleDelete = (card: KanbanCardType) => dataActions.deleteCard(card.id);
  const handleView = (card: KanbanCardType) => {
    viewActions.setSelectedCardId(card.id);
    if (!useKanbanViewStore.getState().ui.infoPanelOpen) {
        viewActions.toggleInfoPanel();
    }
  };
  
  const handleAddChild = (card: KanbanCardType) => {
    if (onAddChild) {
      onAddChild(card);
    } else {
      console.log('Add child to', card.id);
    }
  };

  const handleNavigateToChildren = (card: KanbanCardType) => {
     const childPath = `${card.path}/${card.id}`;
     console.log('Navigating to children:', childPath);
     if (viewActions && typeof viewActions.navigateToPath === 'function') {
       viewActions.navigateToPath(childPath);
     } else {
       console.warn('viewActions.navigateToPath is not available, attempting direct store access');
       useKanbanViewStore.getState().actions.navigateToPath(childPath);
     }
  };

  // Get layout settings from schema
  const columnLayout = layout || {
    type: 'scrollable',
    minWidth: 280,
    maxWidth: 400,
    mobileMinWidth: 250,
    spacing: 'md',
    breakpoints: {
      mobile: 768,
      tablet: 1024,
      desktop: 1200,
    },
    mobileLayout: 'horizontal-scroll',
  };
  const minWidth = columnLayout.minWidth || 280;
  const maxWidth = columnLayout.maxWidth || 400;

  if (isCollapsed) {
    return (
      <Paper
        ref={ref}
        h="100%"
        p={0}
        bg={isOver ? 'gray.2' : 'gray.0'}
        withBorder
        style={{
          width: 60,
          minWidth: 60,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          transition: 'all 0.2s',
          overflow: 'hidden'
        }}
      >
        {status.color && <Box h={4} w="100%" bg={status.color} />}
        
        <Box p="xs" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', flex: 1 }}>
          <ActionIcon 
            variant="subtle" 
            size="sm" 
            onClick={() => setIsCollapsed(false)}
            mb="sm"
          >
            <IconChevronRight size={16} />
          </ActionIcon>

          <Badge size="xs" variant="light" color="gray" mb="sm">
            {cards.length}
          </Badge>

          <Box style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', overflow: 'hidden' }}>
             <Text 
               fw={700} 
               size="sm" 
               truncate
               c={status.color}
               style={{ 
                 width: '100%',
                 textAlign: 'center'
               }}
             >
               {status.label.substring(0, 3)}
             </Text>
          </Box>
        </Box>
      </Paper>
    );
  }

  return (
    <Paper
      ref={ref}
      w={300} // Default width, but constrained by min/max
      h="100%"
      p={0}
      bg={isOver ? 'gray.2' : 'gray.1'}
      withBorder
      style={{ 
        display: 'flex', 
        flexDirection: 'column',
        minWidth: minWidth,
        maxWidth: maxWidth,
        flex: columnLayout.type === 'flexible' ? 1 : '0 0 auto',
        transition: 'background-color 0.2s',
        overflow: 'hidden'
      }}
    >
      {status.color && <Box h={4} w="100%" bg={status.color} />}
      
      <Box p="sm" style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
        <Group justify="space-between" mb="sm">
          <Group gap="xs">
            <Text fw={700} size="sm" c={status.color}>{status.label}</Text>
            {status.showCardCount && (
              <Badge size="sm" variant="light" color="gray">
                {cards.length}
              </Badge>
            )}
          </Group>
          <Group gap={4}>
            {status.collapsible && (
              <ActionIcon variant="subtle" size="sm" onClick={() => setIsCollapsed(true)}>
                <IconChevronLeft size={16} />
              </ActionIcon>
            )}
            <ActionIcon variant="subtle" size="sm" onClick={handleAddCard}>
              <IconPlus size={16} />
            </ActionIcon>
            <Menu position="bottom-end">
              <Menu.Target>
                <ActionIcon variant="subtle" size="sm">
                  <IconDots size={16} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                {status.collapsible && (
                  <Menu.Item onClick={() => setIsCollapsed(true)}>Collapse</Menu.Item>
                )}
                <Menu.Item color="red">Clear All</Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>
        
        <Box style={{ flex: 1, overflow: 'hidden' }}>
          <CardVirtualList 
            cards={cards} 
            onEdit={handleEdit}
            onClick={handleClick}
            onDuplicate={handleDuplicate}
            onDelete={handleDelete}
            onView={handleView}
            onAddChild={handleAddChild}
            onNavigateToChildren={handleNavigateToChildren}
          />
        </Box>
      </Box>
    </Paper>
  );
});
