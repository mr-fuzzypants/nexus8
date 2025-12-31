import React, { useEffect, useState } from 'react';
import { monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import { Box, Flex, Button, Tooltip, SegmentedControl } from '@mantine/core';
import { IconSettings } from '@tabler/icons-react';
import { shallow } from 'zustand/shallow';
import { useKanbanStore } from '../../state';
import { KanbanColumn } from './KanbanColumn';
import { AddChildCardModal } from './AddChildCardModal';
import { ColumnManagerModal } from './ColumnManagerModal';
import { CardEditorModal } from './CardEditorModal';
import { KanbanCard, defaultAggregateStatuses } from '../../schema';

interface KanbanBoardProps {
  onCardClick?: (card: KanbanCard) => void;
  onNewCard?: (status: string) => void;
  onSettingsClick?: () => void;
  onFilterClick?: () => void;
  onSearchClick?: () => void;
}

export const KanbanBoard: React.FC<KanbanBoardProps> = ({
  onCardClick,
}) => {
  const { kanbanSchema, ui, selection } = useKanbanStore(
    (state) => ({
      kanbanSchema: state.kanbanSchema,
      ui: state.ui,
      selection: state.selection,
    }),
    shallow
  );
  
  const actions = useKanbanStore((state) => state.actions);

  const [childModalOpen, setChildModalOpen] = useState(false);
  const [columnManagerOpen, setColumnManagerOpen] = useState(false);
  const [parentCard, setParentCard] = useState<KanbanCard | null>(null);
  const [viewMode, setViewMode] = useState<'detailed' | 'aggregate'>('detailed');

  const handleAddChild = (card: KanbanCard) => {
    setParentCard(card);
    setChildModalOpen(true);
  };

  useEffect(() => {
    return monitorForElements({
      onDrop({ source, location }) {
        const destination = location.current.dropTargets[0];
        if (!destination) return;

        const sourceData = source.data;
        const destinationData = destination.data;

        if (sourceData.type === 'card') {
          const cardId = sourceData.cardId as string;
          const sourceCard = sourceData.card as any;

          // Dropped on a column
          if (destinationData.type === 'column') {
            const statusId = destinationData.statusId as string;
            const isAggregate = destinationData.isAggregate as boolean;

            if (isAggregate) {
               // Find the first status that maps to this aggregate status
               const firstStatus = useKanbanStore.getState().kanbanSchema.statuses
                 .sort((a, b) => a.order - b.order)
                 .find(s => s.aggregateStatus === statusId);
                 
               if (firstStatus && sourceCard.status !== firstStatus.id) {
                 actions.moveCard(cardId, firstStatus.id);
               }
            } else {
              if (sourceCard.status !== statusId) {
                actions.moveCard(cardId, statusId);
              }
            }
          }
          
          // Dropped on another card
          if (destinationData.type === 'card') {
            const targetCard = destinationData.card as any;
            const targetId = destinationData.cardId as string;
            
            if (cardId === targetId) return;

            // If different status, move to that status first
            if (sourceCard.status !== targetCard.status) {
              actions.moveCard(cardId, targetCard.status);
            }
            
            // Handle reordering
            const edge = extractClosestEdge(destinationData);
            if (edge) {
               // Get current order
               const currentOrder = useKanbanStore.getState().cardOrder[targetCard.path]?.[targetCard.status] || [];
               const targetIndex = currentOrder.indexOf(targetId);
               
               if (targetIndex !== -1) {
                 const newIndex = edge === 'top' ? targetIndex : targetIndex + 1;
                 // Adjust index if moving downwards in same list
                 // This logic is simplified; robust reordering usually requires more checks
                 actions.moveCard(cardId, targetCard.status, newIndex);
               }
            }
          }
        }
      },
    });
  }, [actions]);

  return (
    <>
      <Box h="100%" style={{ overflowX: 'auto' }}>
        <Box p="md" pb={0}>
           <SegmentedControl
             value={viewMode}
             onChange={(value) => setViewMode(value as 'detailed' | 'aggregate')}
             data={[
               { label: 'Detailed View', value: 'detailed' },
               { label: 'Aggregate View', value: 'aggregate' },
             ]}
           />
        </Box>
        <Flex 
          gap="md" 
          h="100%" 
          align="flex-start" 
          p="md" 
          style={{ 
            minWidth: 'fit-content',
            transform: `scale(${ui.boardScale})`,
            transformOrigin: 'top left'
          }}
        >
          {viewMode === 'detailed' ? (
            kanbanSchema.statuses
              .slice()
              .sort((a, b) => a.order - b.order)
              .map((status) => (
              <KanbanColumn 
                key={status.id} 
                status={status} 
                onAddChild={handleAddChild}
                onCardClick={onCardClick}
              />
            ))
          ) : (
            defaultAggregateStatuses.map((agg, index) => (
              <KanbanColumn
                key={agg.id}
                status={{
                  id: agg.id,
                  label: agg.label,
                  color: agg.color,
                  description: agg.description,
                  order: index,
                  aggregateStatus: agg.id as any,
                  allowDrop: true,
                  allowDrag: false,
                  isInitial: false,
                  isFinal: false,
                  collapsible: true,
                  defaultCollapsed: false,
                  limit: 0
                } as any}
                isAggregate={true}
                onAddChild={handleAddChild}
                onCardClick={onCardClick}
              />
            ))
          )}

          <Tooltip label="Manage Columns">
            <Button
              variant="light"
              color="gray"
              h="100%"
              w={50}
              p={0}
              onClick={() => setColumnManagerOpen(true)}
              style={{ 
                minWidth: 50,
                opacity: 0.7,
                borderStyle: 'dashed',
                borderWidth: 2,
              }}
            >
              <IconSettings size={24} />
            </Button>
          </Tooltip>
        </Flex>
      </Box>
      
      <AddChildCardModal 
        opened={childModalOpen} 
        onClose={() => setChildModalOpen(false)} 
        parentCard={parentCard} 
      />

      <ColumnManagerModal
        opened={columnManagerOpen}
        onClose={() => setColumnManagerOpen(false)}
      />

      <CardEditorModal
        opened={ui.cardEditorOpen}
        onClose={() => actions.closeCardEditor()}
        cardId={selection.selectedCardId || null}
      />
    </>
  );
};
