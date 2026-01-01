import React from 'react';
import { Box, Group, Text, Button, Slider, Stack } from '@mantine/core';
import { shallow } from 'zustand/shallow';
import { useKanbanStore } from '../../state';

export const ScaleControls: React.FC = () => {
  const { boardScale, cardScale } = useKanbanStore(
    (state) => ({
      boardScale: state.ui.boardScale,
      cardScale: state.ui.cardScale,
    }),
    shallow
  );

  const actions = useKanbanStore((state) => state.actions);

  return (
    <Stack gap="sm">
      <Box>
        <Group justify="space-between" mb={5}>
          <Text size="xs">Board Scale: {Math.round(boardScale * 100)}%</Text>
          <Button 
            variant="subtle" 
            size="xs" 
            onClick={() => actions.setBoardScale(1.0)}
            disabled={boardScale === 1.0}
          >
            Reset
          </Button>
        </Group>
        <Slider
          value={boardScale}
          onChange={actions.setBoardScale}
          min={0.5}
          max={2.0}
          step={0.1}
          label={(value) => `${Math.round(value * 100)}%`}
        />
      </Box>

      <Box>
        <Group justify="space-between" mb={5}>
          <Text size="xs">Card Scale: {Math.round(cardScale * 100)}%</Text>
          <Button 
            variant="subtle" 
            size="xs" 
            onClick={() => actions.setCardScale(1.0)}
            disabled={cardScale === 1.0}
          >
            Reset
          </Button>
        </Group>
        <Slider
          value={cardScale}
          onChange={actions.setCardScale}
          min={0.5}
          max={2.0}
          step={0.1}
          label={(value) => `${Math.round(value * 100)}%`}
        />
      </Box>
    </Stack>
  );
};
