import { Paper, Text, Group, Badge, Stack, Progress } from '@mantine/core';
import { useUndoRedoPerformance } from '../state/useUndoRedo';

/**
 * Component that displays undo/redo performance metrics
 * Useful for debugging and monitoring memory usage
 */
export const UndoPerformanceMonitor = () => {
  const {
    memoryUsage,
    totalActionsRecorded,
    totalMemorySaved,
    stackSize,
    averageActionSize,
    memoryEfficiency,
  } = useUndoRedoPerformance();

  return (
    <Paper
      p="md"
      withBorder
      shadow="sm"
      style={{
        position: 'fixed',
        bottom: 20,
        right: 20,
        width: 300,
        zIndex: 1000,
      }}
    >
      <Stack gap="sm">
        <Text size="sm" fw={600}>Undo System Performance</Text>
        
        <div>
          <Group justify="space-between" mb="xs">
            <Text size="xs" c="dimmed">Memory Usage</Text>
            <Text size="xs" fw={500}>
              {(memoryUsage.current / 1024).toFixed(2)} KB / {(memoryUsage.max / 1024).toFixed(0)} KB
            </Text>
          </Group>
          <Progress
            value={memoryUsage.percentage}
            color={
              memoryUsage.percentage > 80 
                ? 'red' 
                : memoryUsage.percentage > 50 
                ? 'yellow' 
                : 'green'
            }
            size="sm"
          />
        </div>
        
        <Group justify="space-between">
          <Text size="xs" c="dimmed">Actions in Stack</Text>
          <Badge size="sm" variant="light">{stackSize}</Badge>
        </Group>
        
        <Group justify="space-between">
          <Text size="xs" c="dimmed">Total Recorded</Text>
          <Badge size="sm" variant="light">{totalActionsRecorded}</Badge>
        </Group>
        
        <Group justify="space-between">
          <Text size="xs" c="dimmed">Avg Action Size</Text>
          <Text size="xs">{(averageActionSize / 1024).toFixed(2)} KB</Text>
        </Group>
        
        <Group justify="space-between">
          <Text size="xs" c="dimmed">Memory Efficiency</Text>
          <Badge size="sm" color="green">{memoryEfficiency}</Badge>
        </Group>
        
        <Group justify="space-between">
          <Text size="xs" c="dimmed">Memory Saved</Text>
          <Text size="xs" c="green">{(totalMemorySaved / 1024).toFixed(0)} KB</Text>
        </Group>
      </Stack>
    </Paper>
  );
};
