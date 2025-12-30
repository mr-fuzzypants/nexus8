import React from 'react';
import { DragOverlay, useDndContext } from '@dnd-kit/core';
import { KanbanCard } from './KanbanCard';
import { useKanbanStore } from '../../state';

export const KanbanDragOverlay: React.FC = React.memo(() => {
  const { active } = useDndContext();
  const cardId = active?.id as string;
  
  // Select specific card from store to avoid re-renders on other store changes
  const card = useKanbanStore(state => cardId ? state.cards[cardId] : null);

  if (!active || !card) return null;
  
  return (
    <DragOverlay dropAnimation={null}>
      <KanbanCard
        card={card}
        isSelected={false}
        isDragging={true}
        style={{ 
          opacity: 0.8,
          transform: 'rotate(3deg)',
          cursor: 'grabbing',
        }}
      />
    </DragOverlay>
  );
});
