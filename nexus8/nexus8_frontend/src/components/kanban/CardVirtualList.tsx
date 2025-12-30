import React, { useRef } from 'react';
import { Box } from '@mantine/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useKanbanStore } from '../../state';
import { KanbanCard } from './KanbanCard';
import { useResponsive } from '../../utils';
import type { KanbanCard as KanbanCardType } from '../../schema';

interface CardVirtualListProps {
  cards: KanbanCardType[];
  selectedCardIds?: string[];
  onCardClick?: (card: KanbanCardType) => void;
  onCardEdit?: (card: KanbanCardType) => void;
  onCardDuplicate?: (card: KanbanCardType) => void;
  onCardDelete?: (card: KanbanCardType) => void;
  onCardView?: (card: KanbanCardType) => void;
  onCardAddChild?: (parentCard: KanbanCardType) => void;
  onCardNavigateToChildren?: (parentCard: KanbanCardType) => void;
  itemSize?: number;
  overscan?: number;
  height?: number;
  className?: string;
  style?: React.CSSProperties;
}

interface CardItemProps {
  index: number;
  card: KanbanCardType;
  selectedCardIds: string[];
  onCardClick?: (card: KanbanCardType) => void;
  onCardEdit?: (card: KanbanCardType) => void;
  onCardDuplicate?: (card: KanbanCardType) => void;
  onCardDelete?: (card: KanbanCardType) => void;
  onCardView?: (card: KanbanCardType) => void;
  onCardAddChild?: (parentCard: KanbanCardType) => void;
  onCardNavigateToChildren?: (parentCard: KanbanCardType) => void;
}

const CardItem = React.memo<CardItemProps>(({ 
  card, 
  selectedCardIds,
  onCardClick,
  onCardEdit,
  onCardDuplicate,
  onCardDelete,
  onCardView,
  onCardAddChild,
  onCardNavigateToChildren,
}) => {
  return (
    <Box px={4} pb={12} mb={4}>
      <KanbanCard
        card={card}
        onClick={onCardClick}
        onEdit={onCardEdit}
        onDuplicate={onCardDuplicate}
        onDelete={onCardDelete}
        onView={onCardView}
        onAddChild={onCardAddChild}
        onNavigateToChildren={onCardNavigateToChildren}
        isSelected={selectedCardIds.includes(card.id)}
      />
    </Box>
  );
});

const CardVirtualListComponent: React.FC<CardVirtualListProps> = ({
  cards,
  selectedCardIds = [],
  onCardClick,
  onCardEdit,
  onCardDuplicate,
  onCardDelete,
  onCardView,
  onCardAddChild,
  onCardNavigateToChildren,
  itemSize = 160,
  overscan = 5,
  height = 400,
  className,
  style,
}) => {
  const screenSize = useResponsive();
  const parentRef = useRef<HTMLDivElement>(null);
  const boardScale = useKanbanStore(state => state.ui.boardScale);
  const scale = typeof boardScale === 'number' && !isNaN(boardScale) ? boardScale : 1.0;
  
  // Adjust height for mobile
  const listHeight = screenSize.isMobile ? Math.min(height, 300) : height;

  // Optimize: Memoize card IDs for SortableContext
  const cardIds = React.useMemo(() => cards.map(c => c.id), [cards]);
  
  // Create virtualizer
  const virtualizer = useVirtualizer({
    count: cards.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => itemSize,
    measureElement:
      typeof window !== 'undefined' && navigator.userAgent.indexOf('Firefox') === -1
        ? (element) => element.getBoundingClientRect().height / scale
        : undefined,
    overscan,
  });
  
  // If we have no cards, render empty state
  if (cards.length === 0) {
    return (
      <Box
        className={className}
        style={style}
        h={listHeight}
      >
        {/* Empty state handled by parent */}
      </Box>
    );
  }
  
  return (
    <Box
      className={className}
      style={{
        marginLeft: 'calc(var(--mantine-spacing-sm) * -1)',
        marginRight: 'calc(var(--mantine-spacing-sm) * -1)',
        ...style,
      }}
    >
      <SortableContext
        items={cardIds}
        strategy={verticalListSortingStrategy}
      >
        <Box
          ref={parentRef}
          h={listHeight}
          style={{
            overflow: 'auto',
            scrollbarWidth: 'thin',
            paddingLeft: 'var(--mantine-spacing-sm)',
            paddingRight: 'var(--mantine-spacing-sm)',
          }}
        >
          <Box
            style={{
              height: virtualizer.getTotalSize(),
              width: '100%',
              position: 'relative',
            }}
          >
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const card = cards[virtualItem.index];
              if (!card) return null;
              
              return (
                <Box
                  key={virtualItem.key}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  <CardItem
                    index={virtualItem.index}
                    card={card}
                    selectedCardIds={selectedCardIds}
                    onCardClick={onCardClick}
                    onCardEdit={onCardEdit}
                    onCardDuplicate={onCardDuplicate}
                    onCardDelete={onCardDelete}
                    onCardView={onCardView}
                    onCardAddChild={onCardAddChild}
                    onCardNavigateToChildren={onCardNavigateToChildren}
                  />
                </Box>
              );
            })}
          </Box>
        </Box>
      </SortableContext>
    </Box>
  );
};

export const CardVirtualList = React.memo(CardVirtualListComponent);

export default CardVirtualList;