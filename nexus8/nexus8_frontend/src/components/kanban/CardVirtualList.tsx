import React, { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Box } from '@mantine/core';
import { shallow } from 'zustand/shallow';
import { KanbanCard } from './KanbanCard';
import { KanbanCard as KanbanCardType } from '../../schema';
import { useDataStore, useKanbanViewStore } from '../../state';

interface CardVirtualListProps {
  cards: KanbanCardType[];
  onEdit?: (card: KanbanCardType) => void;
  onClick?: (card: KanbanCardType) => void;
  onDuplicate?: (card: KanbanCardType) => void;
  onDelete?: (card: KanbanCardType) => void;
  onView?: (card: KanbanCardType) => void;
  onAddChild?: (parentCard: KanbanCardType) => void;
  onNavigateToChildren?: (parentCard: KanbanCardType) => void;
}

export const CardVirtualList: React.FC<CardVirtualListProps> = ({ 
  cards,
  onEdit,
  onClick,
  onDuplicate,
  onDelete,
  onView,
  onAddChild,
  onNavigateToChildren
}) => {
  const parentRef = useRef<HTMLDivElement>(null);
  
  const kanbanSchema = useDataStore(state => state.kanbanSchema);
  const selectedCardId = useKanbanViewStore(state => state.selection.selectedCardId);
  
  const virtualItemSize = kanbanSchema.settings?.virtualItemSize || 120;
  const overscan = kanbanSchema.settings?.overscan || 5;

  const rowVirtualizer = useVirtualizer({
    count: cards.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => virtualItemSize,
    overscan: overscan,
  });

  return (
    <Box
      ref={parentRef}
      style={{
        height: '100%',
        overflowY: 'auto',
        paddingRight: '4px', // Space for scrollbar
      }}
    >
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const card = cards[virtualRow.index];
          return (
            <div
              key={card.id}
              data-index={virtualRow.index}
              ref={(node) => rowVirtualizer.measureElement(node)}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
                paddingBottom: '8px',
              }}
            >
              <KanbanCard 
                card={card} 
                isSelected={selectedCardId === card.id}
                onEdit={onEdit}
                onClick={onClick}
                onDuplicate={onDuplicate}
                onDelete={onDelete}
                onView={onView}
                onAddChild={onAddChild}
                onNavigateToChildren={onNavigateToChildren}
              />
            </div>
          );
        })}
      </div>
    </Box>
  );
};
