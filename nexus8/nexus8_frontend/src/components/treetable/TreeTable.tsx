import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { 
  DndContext, 
  DragOverlay, 
  useSensor, 
  useSensors, 
  PointerSensor, 
  DragEndEvent, 
  DragStartEvent, 
  closestCenter,
  pointerWithin,
  CollisionDetection
} from '@dnd-kit/core';
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
}

export const TreeTable: React.FC<TreeTableProps> = ({ 
  schema, 
  data,
  className,
  style 
}) => {
  const theme = useMantineTheme();
  const parentRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [activeDragItem, setActiveDragItem] = useState<{ id: string; title: string } | null>(null);
  
  const { 
    setSchema, 
    setData, 
    flatData, 
    columnOrder,
    columnWidths,
    columnVisibility,
    schema: currentSchema,
    addGroup,
    reorderColumns
  } = useTreeGridStore();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    setActiveDragItem({
      id: active.id as string,
      title: active.data.current?.title || '',
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragItem(null);
    
    if (!over) return;

    if (over.id === 'group-panel') {
      const field = active.data.current?.field;
      if (field) {
        addGroup(field);
      }
    } else if (active.id !== over.id) {
      const oldIndex = columnOrder.indexOf(active.id as string);
      const newIndex = columnOrder.indexOf(over.id as string);
      
      if (oldIndex !== -1 && newIndex !== -1) {
        reorderColumns(oldIndex, newIndex);
      }
    }
  };

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

  const customCollisionDetection: CollisionDetection = useCallback((args) => {
    // First, check if we are over the group panel using pointerWithin
    const pointerCollisions = pointerWithin(args);
    const groupPanel = pointerCollisions.find(c => c.id === 'group-panel');
    
    if (groupPanel) {
      return [groupPanel];
    }

    // Fallback to closestCenter for column reordering
    return closestCenter(args);
  }, []);

  return (
    <DndContext 
      sensors={sensors} 
      collisionDetection={customCollisionDetection}
      onDragStart={handleDragStart} 
      onDragEnd={handleDragEnd}
    >
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
      
      <DragOverlay>
        {activeDragItem ? (
          <Badge size="lg" variant="filled" style={{ cursor: 'grabbing' }}>
            {activeDragItem.title}
          </Badge>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
};
