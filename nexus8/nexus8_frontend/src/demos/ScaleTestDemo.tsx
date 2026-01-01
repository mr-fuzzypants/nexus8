import React from 'react';
import { Box, Stack, Text } from '@mantine/core';
import { KanbanBoard, ScaleControls } from '../components/kanban';
import { useKanbanViewStore } from '../state';

const ScaleTestDemo: React.FC = () => {
  const { boardScale, cardScale } = useKanbanViewStore(state => state.ui);
  
  return (
    <Box p="md">
      <Stack gap="md">
        <Text size="xl" fw={600}>Scale Controls Demo</Text>
        
        <Box p="md" style={{ border: '1px solid #e0e0e0', borderRadius: '8px' }}>
          <Stack gap="sm">
            <Text size="sm" c="dimmed">
              Current scales: Board {Math.round(boardScale * 100)}%, Cards {Math.round(cardScale * 100)}%
            </Text>
            <ScaleControls />
            <Text size="xs" c="dimmed">
              Try the zoom controls above, use Cmd/Ctrl + Plus/Minus for keyboard shortcuts, or Cmd/Ctrl + 0 to reset.
            </Text>
          </Stack>
        </Box>
        
        <Box style={{ height: '400px', border: '2px dashed #ccc', borderRadius: '8px' }}>
          <KanbanBoard
            onCardClick={(card) => console.log('Card clicked:', card)}
            onNewCard={(status) => console.log('New card for status:', status)}
            onSettingsClick={() => console.log('Settings clicked')}
          />
        </Box>
      </Stack>
    </Box>
  );
};

export default ScaleTestDemo;