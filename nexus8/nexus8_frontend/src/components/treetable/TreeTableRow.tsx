import React from 'react';
import { VirtualItem } from '@tanstack/react-virtual';
import { Box, Text, useMantineTheme, ActionIcon } from '@mantine/core';
import { IconChevronRight, IconChevronDown, IconFile } from '@tabler/icons-react';
import { useTreeGridStore, FlatTreeNode } from '../../state/useTreeGridStore';
import { TreeTableCell } from './TreeTableCell';

interface TreeTableRowProps {
  node: FlatTreeNode;
  virtualRow: VirtualItem;
  totalWidth: number;
}

export const TreeTableRow: React.FC<TreeTableRowProps> = ({ 
  node, 
  virtualRow,
  totalWidth 
}) => {
  const theme = useMantineTheme();
  const { 
    schema, 
    columnOrder, 
    columnWidths, 
    columnVisibility,
    toggleNode,
    selectNode,
    selectedNodeIds
  } = useTreeGridStore();

  const isSelected = selectedNodeIds.has(node.id);
  const indentation = schema.options?.indentation || 20;
  const visibleColumns = columnOrder.filter(colId => columnVisibility[colId] !== false);

  if (node.isGroup) {
    const firstColId = visibleColumns[0];
    const firstColDef = schema.columns.find(c => c.id === firstColId);
    const isPinned = firstColDef?.pinned === 'left';

    return (
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: `${totalWidth}px`,
          height: `${virtualRow.size}px`,
          transform: `translateY(${virtualRow.start}px)`,
          backgroundColor: theme.colors.gray[1],
          borderBottom: `1px solid ${theme.colors.gray[2]}`,
          cursor: 'pointer',
        }}
        onClick={() => toggleNode(node.id)}
      >
        <div
          style={{
            position: isPinned ? 'sticky' : 'relative',
            left: 0,
            display: 'flex',
            alignItems: 'center',
            height: '100%',
            paddingLeft: `${node.depth * indentation + 8}px`,
            width: 'fit-content',
            zIndex: isPinned ? 1 : undefined,
          }}
        >
          <ActionIcon 
            size="xs" 
            variant="subtle" 
            mr={4}
          >
            {node.isExpanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
          </ActionIcon>
          <Text size="sm" fw={600}>
            {node.groupField}: {node.groupValue} ({node.groupCount})
          </Text>
        </div>
      </div>
    );
  }

  let currentLeft = 0;

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: `${totalWidth}px`,
        height: `${virtualRow.size}px`,
        transform: `translateY(${virtualRow.start}px)`,
        display: 'flex',
        backgroundColor: isSelected ? theme.colors.blue[0] : 'white',
        borderBottom: `1px solid ${theme.colors.gray[2]}`,
        cursor: 'pointer',
      }}
      onClick={() => selectNode(node.id)}
    >
      {visibleColumns.map((colId) => {
        const colDef = schema.columns.find(c => c.id === colId);
        if (!colDef) return null;
        
        const width = columnWidths[colId] || colDef.minWidth || 100;
        const value = (node.data as any)[colDef.field];
        const isPinned = colDef.pinned === 'left';
        const stickyLeft = currentLeft;

        if (isPinned) {
          currentLeft += width;
        }
        
        return (
          <Box
            key={colId}
            style={{
              width: `${width}px`,
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              padding: '0 8px',
              borderRight: `1px solid ${theme.colors.gray[2]}`,
              justifyContent: colDef.align === 'right' ? 'flex-end' : 
                             colDef.align === 'center' ? 'center' : 'flex-start',
              position: isPinned ? 'sticky' : 'relative',
              left: isPinned ? `${stickyLeft}px` : undefined,
              zIndex: isPinned ? 2 : 0,
              backgroundColor: isPinned ? (isSelected ? theme.colors.blue[0] : 'white') : undefined,
            }}
          >
            {colDef.isTreeColumn ? (
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                paddingLeft: `${node.depth * indentation}px`,
                width: '100%',
                height: '100%'
              }}>
                {node.hasChildren ? (
                  <ActionIcon 
                    size="xs" 
                    variant="subtle" 
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleNode(node.id);
                    }}
                    mr={4}
                  >
                    {node.isExpanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                  </ActionIcon>
                ) : (
                  <Box w={22} display="flex" style={{ justifyContent: 'center' }}>
                     {/* Spacer or leaf icon */}
                     <IconFile size={12} color={theme.colors.gray[5]} />
                  </Box>
                )}
                <Box style={{ flex: 1, minWidth: 0, height: '100%' }}>
                  <TreeTableCell node={node} column={colDef} value={value} />
                </Box>
              </div>
            ) : (
              <TreeTableCell node={node} column={colDef} value={value} />
            )}
          </Box>
        );
      })}
    </div>
  );
};
