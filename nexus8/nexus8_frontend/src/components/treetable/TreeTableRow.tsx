import React, { useRef, useState, useEffect } from 'react';
import { VirtualItem } from '@tanstack/react-virtual';
import { Box, Text, useMantineTheme, ActionIcon } from '@mantine/core';
import { IconChevronRight, IconChevronDown, IconFile } from '@tabler/icons-react';
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { attachClosestEdge, Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import { useTreeGridStore, FlatTreeNode } from '../../state/useTreeGridStore';
import { TreeTableCell } from './TreeTableCell';

interface TreeTableRowProps {
  node: FlatTreeNode;
  virtualRow: VirtualItem;
  totalWidth: number;
  onNodeUpdate?: (nodeId: string, field: string, value: any) => void;
}

export const TreeTableRow: React.FC<TreeTableRowProps> = ({ 
  node, 
  virtualRow,
  totalWidth,
  onNodeUpdate
}) => {
  const theme = useMantineTheme();
  const rowRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [closestEdge, setClosestEdge] = useState<Edge | null>(null);

  const { 
    schema, 
    columnOrder, 
    columnWidths, 
    columnVisibility,
    toggleNode,
    selectNode,
    selectedNodeIds
  } = useTreeGridStore();

  useEffect(() => {
    const element = rowRef.current;
    if (!element || node.isGroup) return;

    return combine(
      draggable({
        element,
        getInitialData: () => ({ type: 'row', id: node.id, node }),
        onDragStart: () => setIsDragging(true),
        onDrop: () => setIsDragging(false),
      }),
      dropTargetForElements({
        element,
        getData: ({ input }) => attachClosestEdge(
          { type: 'row', id: node.id, node },
          { element, input, allowedEdges: ['top', 'bottom', 'left', 'right'] } // 'left'/'right' might be used for nesting?
          // Actually, usually top/bottom for reorder, and maybe center or specific zone for nesting.
          // But attachClosestEdge only supports top/bottom/left/right.
          // We can use 'bottom' of a parent to mean "insert after" or "insert inside"?
          // Let's stick to standard edges. We might need a custom hitbox for "inside".
          // For now, let's just use top/bottom and maybe we can infer nesting if hovering over the middle?
          // attachClosestEdge divides the element.
        ),
        onDragEnter: ({ self }) => {
            // We can extract edge here for local state
        },
        onDrag: ({ self }) => {
            setClosestEdge(self.data.edge as Edge);
        },
        onDragLeave: () => setClosestEdge(null),
        onDrop: () => {
            setIsDragging(false);
            setClosestEdge(null);
        },
      })
    );
  }, [node]);

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
      ref={rowRef}
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
        cursor: 'grab',
        opacity: isDragging ? 0.5 : 1,
        // Visual feedback for drop
        boxShadow: closestEdge === 'top' 
          ? `inset 0 2px 0 ${theme.colors.blue[5]}` 
          : closestEdge === 'bottom' 
            ? `inset 0 -2px 0 ${theme.colors.blue[5]}` 
            : undefined,
        zIndex: isDragging ? 100 : undefined,
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
                  <TreeTableCell node={node} column={colDef} value={value} onUpdate={onNodeUpdate} />
                </Box>
              </div>
            ) : (
              <TreeTableCell node={node} column={colDef} value={value} onUpdate={onNodeUpdate} />
            )}
          </Box>
        );
      })}
    </div>
  );
};
