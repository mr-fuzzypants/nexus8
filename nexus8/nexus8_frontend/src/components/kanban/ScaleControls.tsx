import React from 'react';
import {
  Group,
  Button,
  Slider,
  Text,
  Popover,
  Stack,
  ActionIcon,
  Divider,
  NumberInput,
} from '@mantine/core';
import {
  IconZoomIn,
  IconZoomOut,
  IconResize,
  IconSettings,
  IconRefresh,
} from '@tabler/icons-react';
import { useKanbanStore } from '../../state/useKanbanStore';

export const ScaleControls: React.FC = () => {
  const ui = useKanbanStore(state => state.ui);
  const {
    setBoardScale,
    setCardScale,
    setScale,
    resetScale,
    zoomIn,
    zoomOut,
  } = useKanbanStore(state => state.actions);
  
  // Ensure we have valid scale values with fallbacks
  const boardScale = typeof ui.boardScale === 'number' && !isNaN(ui.boardScale) ? ui.boardScale : 1.0;
  const cardScale = typeof ui.cardScale === 'number' && !isNaN(ui.cardScale) ? ui.cardScale : 1.0;
  const minScale = typeof ui.minScale === 'number' && !isNaN(ui.minScale) ? ui.minScale : 0.5;
  const maxScale = typeof ui.maxScale === 'number' && !isNaN(ui.maxScale) ? ui.maxScale : 2.0;

  const presets = [
    { label: 'Small', boardScale: 0.8, cardScale: 0.8 },
    { label: 'Normal', boardScale: 1.0, cardScale: 1.0 },
    { label: 'Large', boardScale: 1.2, cardScale: 1.2 },
    { label: 'Extra Large', boardScale: 1.5, cardScale: 1.5 },
  ];

  const formatPercentage = (value: number) => `${Math.round(value * 100)}%`;

  return (
    <Group gap="xs">
      {/* Quick zoom buttons */}
      <ActionIcon
        variant="light"
        size="md"
        onClick={zoomOut}
        disabled={boardScale <= minScale && cardScale <= minScale}
        title="Zoom out"
      >
        <IconZoomOut size={16} />
      </ActionIcon>

      <ActionIcon
        variant="light"
        size="md"
        onClick={zoomIn}
        disabled={boardScale >= maxScale && cardScale >= maxScale}
        title="Zoom in"
      >
        <IconZoomIn size={16} />
      </ActionIcon>

      {/* Scale indicator and advanced controls */}
      <Popover width={300} position="bottom" withArrow shadow="md">
        <Popover.Target>
          <Button
            variant="light"
            size="xs"
            leftSection={<IconResize size={14} />}
            rightSection={<IconSettings size={12} />}
          >
            {formatPercentage(Math.max(boardScale, cardScale))}
          </Button>
        </Popover.Target>
        
        <Popover.Dropdown>
          <Stack gap="md">
            <Text size="sm" fw={600}>Scale Controls</Text>
            
            {/* Board Scale */}
            <Stack gap="xs">
              <Group justify="space-between">
                <Text size="xs" c="dimmed">Board Scale</Text>
                <Text size="xs" fw={500}>{formatPercentage(boardScale)}</Text>
              </Group>
              <Slider
                value={boardScale}
                onChange={setBoardScale}
                min={minScale}
                max={maxScale}
                step={0.1}
                marks={[
                  { value: 0.5, label: '50%' },
                  { value: 1, label: '100%' },
                  { value: 1.5, label: '150%' },
                  { value: 2, label: '200%' },
                ]}
              />
            </Stack>

            {/* Card Scale */}
            <Stack gap="xs">
              <Group justify="space-between">
                <Text size="xs" c="dimmed">Card Scale</Text>
                <Text size="xs" fw={500}>{formatPercentage(cardScale)}</Text>
              </Group>
              <Slider
                value={cardScale}
                onChange={setCardScale}
                min={minScale}
                max={maxScale}
                step={0.1}
                marks={[
                  { value: 0.5, label: '50%' },
                  { value: 1, label: '100%' },
                  { value: 1.5, label: '150%' },
                  { value: 2, label: '200%' },
                ]}
              />
            </Stack>

            <Divider />

            {/* Preset buttons */}
            <Stack gap="xs">
              <Text size="xs" c="dimmed">Presets</Text>
              <Group gap="xs">
                {presets.map((preset) => (
                  <Button
                    key={preset.label}
                    variant={
                      boardScale === preset.boardScale && cardScale === preset.cardScale
                        ? 'filled'
                        : 'light'
                    }
                    size="xs"
                    onClick={() => setScale(preset.boardScale, preset.cardScale)}
                  >
                    {preset.label}
                  </Button>
                ))}
              </Group>
            </Stack>

            {/* Reset button */}
            <Button
              variant="light"
              size="xs"
              leftSection={<IconRefresh size={14} />}
              onClick={resetScale}
              fullWidth
            >
              Reset to 100%
            </Button>

            {/* Custom inputs */}
            <Group grow>
              <NumberInput
                label="Board %"
                value={Math.round(boardScale * 100)}
                onChange={(value) => setBoardScale((typeof value === 'number' ? value : 100) / 100)}
                min={minScale * 100}
                max={maxScale * 100}
                step={10}
                size="xs"
                suffix="%"
              />
              <NumberInput
                label="Card %"
                value={Math.round(cardScale * 100)}
                onChange={(value) => setCardScale((typeof value === 'number' ? value : 100) / 100)}
                min={minScale * 100}
                max={maxScale * 100}
                step={10}
                size="xs"
                suffix="%"
              />
            </Group>
          </Stack>
        </Popover.Dropdown>
      </Popover>
    </Group>
  );
};