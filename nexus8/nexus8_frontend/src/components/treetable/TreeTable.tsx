import React, { useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import { Box, ScrollArea, Text, useMantineTheme, Badge } from '@mantine/core';
import { useTreeGridStore } from '../../state/useTreeGridStore';
import { TreeTableSchema } from '../../schema/treeTableSchema';
import { TreeNode } from '../../state/useTreeGridStore';
import { TreeTableHeader } from './TreeTableHeader';
import { TreeTableRow } from './TreeTableRow';
import { TreeTableGroupPanel } from './TreeTableGroupPanel';

interface TreeTableProps {
  schema: TreeTableSchema;
  data: TreeNode[];
  className?: string;
  style?: React.CSSProperties;
  onNodeMove?: (nodeId: string, targetNodeId: string, position: 'before' | 'after' | 'inside') => void;
  onNodeUpdate?: (nodeId: string, field: string, value: any) => void;
}

export const TreeTable: React.FC<TreeTableProps> = ({ 
  schema, 
  data,
  className,
  style,
  onNodeMove,
  onNodeUpdate
}) => {
  const theme = useMantineTheme();
  const parentRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  
  const { 
    setSchema, 
    setData, 
    flatData, 
    columnOrder,
    columnWidths,
    columnVisibility,
    schema: currentSchema,
    addGroup,
    reorderColumns,
    moveNode
  } = useTreeGridStore();

  useEffect(() => {
    return monitorForElements({
      onDrop({ source, location }) {
        const destination = location.current.dropTargets[0];
        if (!destination) return;

        const sourceData = source.data;
        const destinationData = destination.data;

        // Handle grouping
        if (destinationData.type === 'group-panel' && sourceData.type === 'column') {
          const field = sourceData.field as string;
          if (field) {
            addGroup(field);
          }
          return;
        }

        // Handle row reordering
        if (sourceData.type === 'row' && destinationData.type === 'row') {
          const sourceId = sourceData.id as string;
          const destinationId = destinationData.id as string;

          if (sourceId === destinationId) return;

          const edge = extractClosestEdge(destinationData);
          
          if (edge === 'top') {
            moveNode(sourceId, destinationId, 'before');
            onNodeMove?.(sourceId, destinationId, 'before');
          } else if (edge === 'bottom') {
            moveNode(sourceId, destinationId, 'after');
            onNodeMove?.(sourceId, destinationId, 'after');
          }
          return;
        }

        // Handle column reordering
        if (sourceData.type === 'column' && destinationData.type === 'column') {
          const sourceId = sourceData.id as string;
          const destinationId = destinationData.id as string;

          if (sourceId === destinationId) return;

          const oldIndex = columnOrder.indexOf(sourceId);
          const newIndex = columnOrder.indexOf(destinationId);
          
          if (oldIndex !== -1 && newIndex !== -1) {
            // Adjust index based on edge
            const edge = extractClosestEdge(destinationData);
            let finalIndex = newIndex;
            
            if (edge === 'right') {
                finalIndex += 1;
            }
            
            // If moving forward, we need to account for the item being removed
            if (oldIndex < finalIndex) {
                finalIndex -= 1;
            }

            reorderColumns(oldIndex, finalIndex);
          }
        }
      }
    });
  }, [columnOrder, addGroup, reorderColumns]);

  // Initialize store
  useEffect(() => {
    setSchema(schema);
  }, [schema, setSchema]);

  useEffect(() => {
    setData(data);
  }, [data, setData]);

  // Sync header scroll with body scroll
  useEffect(() => {
    const scrollElement = parentRef.current;
    if (!scrollElement) return;

    const handleScroll = () => {
      if (headerRef.current) {
        headerRef.current.scrollLeft = scrollElement.scrollLeft;
      }
    };

    scrollElement.addEventListener('scroll', handleScroll);
    return () => scrollElement.removeEventListener('scroll', handleScroll);
  }, []);

  // Virtualizer
  const rowVirtualizer = useVirtualizer({
    count: flatData.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => currentSchema.options?.rowHeight || 40,
    overscan: 5,
  });

  const totalWidth = columnOrder.reduce((acc, colId) => {
    if (columnVisibility[colId] === false) return acc;
    return acc + (columnWidths[colId] || 100);
  }, 0);

  return (
      <Box 
        className={className} 
        style={{ 
          height: '100%', 
          display: 'flex', 
          flexDirection: 'column',
          border: `1px solid ${theme.colors.gray[3]}`,
          borderRadius: theme.radius.sm,
          overflow: 'hidden',
          ...style 
        }}
      >
        {/* Group Panel */}
        {currentSchema.options?.enableGrouping && (
          <TreeTableGroupPanel />
        )}

        {/* Header */}
        <Box 
          ref={headerRef}
          style={{ 
            overflow: 'hidden', // Hide scrollbar for header
            borderBottom: `1px solid ${theme.colors.gray[3]}`,
            backgroundColor: theme.colors.gray[0],
            zIndex: 1,
            width: '100%'
          }}
        >
          <TreeTableHeader totalWidth={totalWidth} />
        </Box>

        {/* Body */}
        <ScrollArea 
          viewportRef={parentRef}
          style={{ flex: 1 }}
          type="auto"
        >
          <Box style={{ 
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: `${Math.max(totalWidth, 100)}px`, // Ensure min width
            position: 'relative',
          }}>
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const node = flatData[virtualRow.index];
              return (
                <TreeTableRow
                  key={node.id}
                  node={node}
                  virtualRow={virtualRow}
                  totalWidth={totalWidth}
                  onNodeUpdate={onNodeUpdate}
                />
              );
            })}
          </Box>
        </ScrollArea>
        
        {/* Footer / Status Bar could go here */}
        <Box p="xs" style={{ borderTop: `1px solid ${theme.colors.gray[3]}`, fontSize: '0.8rem' }}>
          <Text size="xs" c="dimmed">
            {flatData.length} rows visible ({data.length} total roots)
          </Text>
        </Box>
      </Box>
  );
};
