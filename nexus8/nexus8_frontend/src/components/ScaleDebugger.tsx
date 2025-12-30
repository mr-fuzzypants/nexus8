import React from 'react';
import { Box, Text, Code, Button, Group } from '@mantine/core';
import { useKanbanStore } from '../state/useKanbanStore';
import { clearKanbanStore, debugKanbanStore } from '../utils/storeDebug';

export const ScaleDebugger: React.FC = () => {
  const ui = useKanbanStore(state => state.ui);
  const actions = useKanbanStore(state => state.actions);
  
  const handleClearStore = () => {
    clearKanbanStore();
    window.location.reload();
  };
  
  const handleDebugStore = () => {
    debugKanbanStore();
  };
  
  const handleResetScale = () => {
    actions.resetScale();
  };
  
  return (
    <Box p="md" bg="yellow.1" mb="md">
      <Text size="lg" fw={600} mb="md">Scale Values Debug</Text>
      
      <Group mb="md">
        <Button size="xs" onClick={handleResetScale}>Reset Scale</Button>
        <Button size="xs" onClick={handleDebugStore}>Log Store</Button>
        <Button size="xs" color="red" onClick={handleClearStore}>Clear Store & Reload</Button>
      </Group>
      
      <Code block>
        {JSON.stringify({
          boardScale: ui.boardScale,
          cardScale: ui.cardScale,
          minScale: ui.minScale,
          maxScale: ui.maxScale,
          boardScaleType: typeof ui.boardScale,
          cardScaleType: typeof ui.cardScale,
          uiKeys: Object.keys(ui),
        }, null, 2)}
      </Code>
    </Box>
  );
};