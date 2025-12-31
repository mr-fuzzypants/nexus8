import React from 'react';
import { useTreeGridStore } from '../../state/useTreeGridStore';
import { TreeTableHeaderCell } from './TreeTableHeaderCell';

interface TreeTableHeaderProps {
  totalWidth: number;
}

export const TreeTableHeader: React.FC<TreeTableHeaderProps> = ({ totalWidth }) => {
  const { 
    schema, 
    columnOrder, 
    columnWidths, 
    columnVisibility
  } = useTreeGridStore();

  const reorderEnabled = schema.columnReordering?.enabled ?? true;

  let currentLeft = 0;

  const visibleColumns = columnOrder.filter(colId => columnVisibility[colId] !== false);

  return (
    <div style={{ 
      display: 'flex', 
      width: `${totalWidth}px`,
      height: `${schema.options?.headerHeight || 40}px`,
    }}>
      {visibleColumns.map((colId) => {
        const colDef = schema.columns.find(c => c.id === colId);
        if (!colDef) return null;
        
        const width = columnWidths[colId] || colDef.minWidth || 100;
        const isPinned = colDef.pinned === 'left';
        const stickyLeft = currentLeft;
        
        if (isPinned) {
          currentLeft += width;
        }
        
        return (
          <TreeTableHeaderCell 
            key={colId} 
            colId={colId} 
            currentLeft={stickyLeft} 
          />
        );
      })}
    </div>
  );
};
