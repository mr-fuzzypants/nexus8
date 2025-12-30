import React from 'react';
import { Popover, Button, Checkbox, Stack, Text, ScrollArea } from '@mantine/core';
import { IconColumns } from '@tabler/icons-react';
import { useTreeGridStore } from '../../state/useTreeGridStore';

export const ColumnVisibilityControl: React.FC = () => {
  const { schema, columnVisibility, toggleColumnVisibility } = useTreeGridStore();

  return (
    <Popover width={200} position="bottom-end" withArrow shadow="md">
      <Popover.Target>
        <Button variant="light" leftSection={<IconColumns size={16} />}>
          Columns
        </Button>
      </Popover.Target>
      <Popover.Dropdown>
        <Text size="xs" fw={500} mb="xs" c="dimmed">
          Show/Hide Columns
        </Text>
        <ScrollArea.Autosize mah={300}>
          <Stack gap="xs">
            {schema.columns.map((col) => {
              const isPinned = col.pinned === 'left' || col.pinned === 'right';
              return (
                <Checkbox
                  key={col.id}
                  label={
                    isPinned ? (
                      <Text span size="sm" c="dimmed">
                        {col.header} (Pinned)
                      </Text>
                    ) : (
                      col.header
                    )
                  }
                  checked={columnVisibility[col.id] !== false}
                  onChange={() => !isPinned && toggleColumnVisibility(col.id)}
                  disabled={isPinned}
                />
              );
            })}
          </Stack>
        </ScrollArea.Autosize>
      </Popover.Dropdown>
    </Popover>
  );
};
