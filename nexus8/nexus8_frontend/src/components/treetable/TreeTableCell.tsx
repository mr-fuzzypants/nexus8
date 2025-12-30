import React, { useState, useEffect } from 'react';
import { TextInput, NumberInput, Checkbox, Box, Select } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { useTreeGridStore, FlatTreeNode } from '../../state/useTreeGridStore';
import { TreeTableColumnDefinition } from '../../schema/treeTableSchema';

interface TreeTableCellProps {
  node: FlatTreeNode;
  column: TreeTableColumnDefinition;
  value: any;
}

export const TreeTableCell: React.FC<TreeTableCellProps> = ({ node, column, value }) => {
  const { editingCell, setEditingCell, updateNodeData } = useTreeGridStore();
  const isEditing = editingCell?.nodeId === node.id && editingCell?.columnId === column.id;
  const [editValue, setEditValue] = useState(value);

  useEffect(() => {
    if (isEditing) {
      setEditValue(value);
    }
  }, [isEditing, value]);

  const handleSave = () => {
    if (editValue !== value) {
      updateNodeData(node.id, column.field, editValue);
    }
    setEditingCell(null);
  };

  const handleCancel = () => {
    setEditingCell(null);
    setEditValue(value);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent row selection
    if (column.editable) {
      setEditingCell({ nodeId: node.id, columnId: column.id });
    }
  };

  if (isEditing) {
    switch (column.type) {
      case 'number':
        return (
          <NumberInput
            value={editValue}
            onChange={(val) => setEditValue(val)}
            onBlur={handleSave}
            onKeyDown={handleKeyDown}
            autoFocus
            size="xs"
            styles={{ input: { height: 24, minHeight: 24, padding: '0 4px' } }}
            hideControls
          />
        );
      case 'boolean':
        return (
          <Checkbox
            checked={!!editValue}
            onChange={(e) => {
                const newVal = e.currentTarget.checked;
                setEditValue(newVal);
                updateNodeData(node.id, column.field, newVal);
                setEditingCell(null);
            }}
            autoFocus
          />
        );
      case 'date':
        return (
            <DateInput
                value={editValue ? new Date(editValue) : null}
                onChange={(date) => {
                    setEditValue(date?.toISOString());
                }}
                onBlur={handleSave}
                onKeyDown={handleKeyDown}
                autoFocus
                size="xs"
                styles={{ input: { height: 24, minHeight: 24, padding: '0 4px' } }}
            />
        );
      case 'select':
        return (
          <Select
            data={column.selectOptions as any}
            value={editValue}
            onChange={(val) => setEditValue(val)}
            onBlur={handleSave}
            onKeyDown={handleKeyDown}
            autoFocus
            defaultDropdownOpened
            size="xs"
            styles={{ input: { height: 24, minHeight: 24, padding: '0 4px' } }}
            allowDeselect={false}
          />
        );
      default:
        return (
          <TextInput
            value={editValue}
            onChange={(e) => setEditValue(e.currentTarget.value)}
            onBlur={handleSave}
            onKeyDown={handleKeyDown}
            autoFocus
            size="xs"
            styles={{ input: { height: 24, minHeight: 24, padding: '0 4px' } }}
          />
        );
    }
  }

  // Render display value
  let displayValue = value;
  if (column.type === 'date' && value) {
    try {
        displayValue = new Date(value).toLocaleDateString();
    } catch (e) {
        displayValue = value;
    }
  } else if (column.type === 'select' && column.selectOptions) {
    const option = column.selectOptions.find((opt: any) => 
       (typeof opt === 'string' ? opt === value : opt.value === value)
    );
    if (option) {
       displayValue = typeof option === 'string' ? option : option.label;
    }
  } else if (column.type === 'boolean') {
    return (
        <Box 
            onDoubleClick={handleDoubleClick}
            style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center' }}
        >
            <Checkbox checked={!!value} readOnly style={{ pointerEvents: 'none' }} />
        </Box>
    );
  }

  return (
    <Box 
        onDoubleClick={handleDoubleClick} 
        style={{ 
            width: '100%', 
            height: '100%', 
            display: 'flex', 
            alignItems: 'center',
            cursor: column.editable ? 'text' : 'inherit',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
        }}
        title={typeof displayValue === 'string' ? displayValue : undefined}
    >
      {displayValue}
    </Box>
  );
};
