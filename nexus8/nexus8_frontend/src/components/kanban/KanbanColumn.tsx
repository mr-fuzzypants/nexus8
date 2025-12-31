import React, { useRef, useState, useEffect } from 'react';
import { Paper, Text, Group, Badge, Box, ActionIcon, Menu } from '@mantine/core';
import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { IconDots, IconPlus, IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { shallow } from 'zustand/shallow';
import { StatusDefinition } from '../../schema/kanbanSchema';
import { useKanbanStore } from '../../state';
import { CardVirtualList } from './CardVirtualList';
import { KanbanCard as KanbanCardType } from '../../schema';

interface KanbanColumnProps {
  status: StatusDefinition;
  onAddChild?: (card: KanbanCardType) => void;
  onCardClick?: (card: KanbanCardType) => void;
}

export const KanbanColumn = React.memo(({ status, onAddChild, onCardClick }: KanbanColumnProps) => {
  const { currentPath, layout } = useKanbanStore(
    (state) => ({
      currentPath: state.ui.currentPath,
      layout: state.kanbanSchema.layout,
    }),
    shallow
  );

  const actions = useKanbanStore((state) => state.actions);

  const cards = useKanbanStore(
    (state) => state.getCardsByStatus(currentPath, status.id),
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
      getData: () => ({ type: 'column', statusId: status.id }),
      onDragEnter: () => setIsOver(true),
      onDragLeave: () => setIsOver(false),
      onDrop: () => setIsOver(false),
    });
  }, [status.id]);

  const handleAddCard = () => {
    actions.createCard({
      title: 'New Card',
      description: '',
      status: status.id,
      path: currentPath,
      metadata: {},
    });
  };

  const handleEdit = (card: KanbanCardType) => actions.openCardEditor(card.id);
  
  const handleClick = (card: KanbanCardType) => {
    if (onCardClick) {
      onCardClick(card);
    } else {
      actions.selectCard(card.id);
    }
  };
  
  const handleDuplicate = (card: KanbanCardType) => actions.duplicateCard(card.id);
  const handleDelete = (card: KanbanCardType) => actions.deleteCard(card.id);
  const handleView = (card: KanbanCardType) => {
    actions.selectCard(card.id);
    actions.setInfoPanelOpen(true);
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
     actions.navigateToPath(childPath);
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
