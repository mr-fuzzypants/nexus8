import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { Box, Text, Group, Badge, ActionIcon, useMantineTheme } from '@mantine/core';
import { IconX } from '@tabler/icons-react';
import { useTreeGridStore } from '../../state/useTreeGridStore';

export const TreeTableGroupPanel: React.FC = () => {
  const theme = useMantineTheme();
  const { groupBy, removeGroup, schema } = useTreeGridStore();
  const { setNodeRef, isOver } = useDroppable({
    id: 'group-panel',
  });

  return (
    <Box
      ref={setNodeRef}
      p="xs"
      style={{
        borderBottom: `1px solid ${theme.colors.gray[3]}`,
        backgroundColor: isOver ? theme.colors.blue[0] : theme.colors.gray[0],
        minHeight: 42,
        display: 'flex',
        alignItems: 'center',
        transition: 'background-color 0.2s',
      }}
    >
      {groupBy.length === 0 ? (
        <Text size="sm" c="dimmed" style={{ pointerEvents: 'none', userSelect: 'none' }}>
          Drag column headers here to group
        </Text>
      ) : (
        <Group gap="xs">
          {groupBy.map((field) => {
            const colDef = schema.columns.find(c => c.field === field);
            return (
              <Badge
                key={field}
                size="lg"
                variant="filled"
                rightSection={
                  <ActionIcon 
                    size="xs" 
                    color="blue" 
                    variant="transparent" 
                    onClick={() => removeGroup(field)}
                    style={{ color: 'white' }}
                  >
                    <IconX size={12} />
                  </ActionIcon>
                }
              >
                {colDef?.header || field}
              </Badge>
            );
          })}
        </Group>
      )}
    </Box>
  );
};
