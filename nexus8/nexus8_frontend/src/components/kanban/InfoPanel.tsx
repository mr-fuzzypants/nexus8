import React from 'react';
import { Paper, Text, Title, Group, CloseButton, Stack, Divider } from '@mantine/core';
import { useDataStore, useKanbanViewStore } from '../../state';

export const InfoPanel: React.FC = () => {
  const ui = useKanbanViewStore(state => state.ui);
  const selection = useKanbanViewStore(state => state.selection);
  const viewActions = useKanbanViewStore(state => state.actions);
  const cards = useDataStore(state => state.cards);
  
  if (!ui.infoPanelOpen) return null;
  
  const selectedCard = selection.selectedCardId ? cards[selection.selectedCardId] : null;

  return (
    <Paper 
      w={ui.infoPanelWidth} 
      h="100%" 
      p="md" 
      withBorder 
      style={{ borderLeft: '1px solid var(--mantine-color-gray-3)' }}
    >
      <Group justify="space-between" mb="md">
        <Title order={4}>Details</Title>
        <CloseButton onClick={() => viewActions.toggleInfoPanel()} />
      </Group>
      
      {selectedCard ? (
        <Stack>
          <Title order={3}>{selectedCard.title}</Title>
          <Text c="dimmed" size="sm">ID: {selectedCard.id}</Text>
          <Divider />
          <Text>{selectedCard.description || 'No description'}</Text>
          
          <Group>
            <Text fw={500}>Status:</Text>
            <Text>{selectedCard.status}</Text>
          </Group>
        </Stack>
      ) : (
        <Text c="dimmed" ta="center" mt="xl">Select a card to view details</Text>
      )}
    </Paper>
  );
};
