import React, { useMemo } from 'react';
import { Box, Title, Text, Paper, Button, Group } from '@mantine/core';
import { TreeTable } from '../components/treetable';
import { ColumnVisibilityControl } from '../components/treetable/ColumnVisibilityControl';
import { TreeTableSchema } from '../schema/treeTableSchema';
import { TreeNode, useTreeGridStore } from '../state/useTreeGridStore';

interface TreeTableDemoProps {
  data?: TreeNode[];
}

export const TreeTableDemo: React.FC<TreeTableDemoProps> = ({ data = [] }) => {
  const { expandAll, collapseAll } = useTreeGridStore();

  const schema = useMemo(() => TreeTableSchema.parse({
    version: '1.0.0',
    id: 'demo-tree',
    name: 'Project Tasks',
    columns: [
      {
        id: 'title',
        field: 'title',
        header: 'Task Name',
        width: 300,
        isTreeColumn: true,
        sortable: true,
        resizable: true,
        pinned: 'left',
        editable: true,
      },
      {
        id: 'status',
        field: 'status',
        header: 'Status',
        width: 120,
        align: 'center',
        sortable: true,
        resizable: true,
        editable: true,
        type: 'select',
        selectOptions: ['backlog', 'todo', 'inprogress', 'review', 'done'],
      },
      {
        id: 'priority',
        field: 'priority',
        header: 'Priority',
        width: 100,
        align: 'center',
        sortable: true,
        resizable: true,
        editable: true,
        type: 'select',
        selectOptions: ['low', 'medium', 'high', 'urgent'],
      },
      {
        id: 'assignee',
        field: 'assignee',
        header: 'Assignee',
        width: 120,
        sortable: true,
        resizable: true,
        editable: true,
        type: 'select',
        selectOptions: [
          'john', 'jane', 'bob', 
          'Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace', 'Henry'
        ],
      },
      {
        id: 'tags',
        field: 'tags',
        header: 'Tags',
        width: 200,
        type: 'tags',
        editable: true,
        selectOptions: ['frontend', 'backend', 'ui', 'bug', 'feature', 'design', 'database'],
      },
      {
        id: 'description',
        field: 'description',
        header: 'Description',
        width: 300,
        editable: true,
      },
      {
        id: 'progress',
        field: 'progress',
        header: 'Progress',
        width: 100,
        type: 'number',
        align: 'right',
        sortable: true,
        resizable: true,
        editable: true,
      },
      {
        id: 'dueDate',
        field: 'dueDate',
        header: 'Due Date',
        width: 150,
        type: 'date',
        sortable: true,
        resizable: true,
        editable: true,
      },
    ],
    options: {
      rowHeight: 40,
      headerHeight: 40,
      enableVirtualization: true,
      enableColumnResizing: true,
      indentation: 24,
    },
  }), []);

  return (
    <Box p="md" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box mb="md">
        <Title order={2}>Tree Table Component</Title>
        <Text c="dimmed">
          High-performance tree grid with virtualization, sorting, and column resizing.
        </Text>
      </Box>

      <Group mb="md" justify="space-between">
        <Group>
          <Button onClick={expandAll} variant="light">Expand All</Button>
          <Button onClick={collapseAll} variant="light">Collapse All</Button>
        </Group>
        <ColumnVisibilityControl />
      </Group>

      <Paper style={{ flex: 1, overflow: 'hidden' }} withBorder>
        <TreeTable 
          data={data} 
          schema={schema} 
        />
      </Paper>
    </Box>
  );
};
