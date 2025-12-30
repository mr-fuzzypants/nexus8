import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Box, Group, Text, useMantineTheme } from '@mantine/core';
import { IconChevronDown, IconChevronUp, IconSelector, IconGripVertical } from '@tabler/icons-react';
import { useTreeGridStore } from '../../state/useTreeGridStore';

interface TreeTableHeaderCellProps {
  colId: string;
  currentLeft: number;
}

export const TreeTableHeaderCell: React.FC<TreeTableHeaderCellProps> = ({ colId, currentLeft }) => {
  const theme = useMantineTheme();
  const { 
    schema, 
    columnWidths, 
    sortConfig, 
    resizeColumn,
    setSort
  } = useTreeGridStore();

  const colDef = schema.columns.find(c => c.id === colId);
  
  const { 
    attributes, 
    listeners, 
    setNodeRef, 
    transform, 
    transition, 
    isDragging 
  } = useSortable({
    id: colId,
    data: { field: colDef?.field, type: 'column', title: colDef?.header },
    disabled: !colDef,
  });

  if (!colDef) return null;

  const width = columnWidths[colId] || colDef.minWidth || 100;
  const sortItem = sortConfig?.find(s => s.field === colDef.field);
  const isSorted = !!sortItem;
  const sortIndex = sortConfig?.findIndex(s => s.field === colDef.field);
  const isPinned = colDef.pinned === 'left';
  
  const handleSort = (e: React.MouseEvent, field: string) => {
    const multi = e.shiftKey || e.metaKey || e.ctrlKey;
    if (sortItem) {
      if (sortItem.direction === 'asc') {
        setSort(field, 'desc', multi);
      } else {
        setSort(field, null, multi);
      }
    } else {
      setSort(field, 'asc', multi);
    }
  };

  return (
    <Box
      ref={setNodeRef}
      style={{
        width: `${width}px`,
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        padding: '0 8px',
        borderRight: `1px solid ${theme.colors.gray[3]}`,
        position: isPinned ? 'sticky' : 'relative',
        left: isPinned ? `${currentLeft}px` : undefined,
        zIndex: isPinned ? 3 : 1,
        userSelect: 'none',
        backgroundColor: theme.colors.gray[0],
        opacity: isDragging ? 0.5 : 1,
        transform: CSS.Translate.toString(transform),
        transition,
      }}
    >
      <Group 
        gap={4} 
        style={{ 
          width: '100%', 
          cursor: 'grab' 
        }}
        wrap="nowrap"
      >
        <div {...attributes} {...listeners} style={{ display: 'flex', alignItems: 'center', cursor: 'grab' }}>
           <IconGripVertical size={14} color={theme.colors.gray[5]} />
        </div>

        <Box 
          style={{ flex: 1, display: 'flex', alignItems: 'center', overflow: 'hidden', cursor: colDef.sortable ? 'pointer' : 'default' }}
          onClick={(e) => colDef.sortable && handleSort(e, colDef.field)}
        >
          <Text 
            fw={600} 
            size="sm" 
            style={{ 
              flex: 1,
              textAlign: colDef.headerAlign || 'left',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {colDef.header}
          </Text>
          
          {colDef.sortable && (
            <Box style={{ display: 'flex', alignItems: 'center', color: theme.colors.gray[6], marginLeft: 4 }}>
              {isSorted ? (
                <>
                  {sortItem?.direction === 'asc' ? 
                    <IconChevronUp size={14} /> : 
                    <IconChevronDown size={14} />
                  }
                  {sortConfig && sortConfig.length > 1 && (
                    <Text size="xs" style={{ marginLeft: 2 }}>{(sortIndex ?? 0) + 1}</Text>
                  )}
                </>
              ) : (
                <IconSelector size={14} style={{ opacity: 0.3 }} />
              )}
            </Box>
          )}
        </Box>
      </Group>
      
      {/* Resizer Handle */}
      {colDef.resizable && (
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            bottom: 0,
            width: 4,
            cursor: 'col-resize',
            zIndex: 10,
          }}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const startX = e.pageX;
            const startWidth = width;
            
            const handleMouseMove = (moveEvent: MouseEvent) => {
              const newWidth = Math.max(colDef.minWidth || 50, startWidth + moveEvent.pageX - startX);
              resizeColumn(colId, newWidth);
            };
            
            const handleMouseUp = () => {
              document.removeEventListener('mousemove', handleMouseMove);
              document.removeEventListener('mouseup', handleMouseUp);
            };
            
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
          }}
        />
      )}
    </Box>
  );
};
