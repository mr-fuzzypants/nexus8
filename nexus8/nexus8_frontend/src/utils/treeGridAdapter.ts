import type { ColumnDef, Row } from '@tanstack/react-table';
import type { KanbanCard, CardSchema, FieldDefinition, TreeGridSchema } from '../schema';
import type { VisibilityState } from '@tanstack/react-table';
import { format } from 'date-fns';

/**
 * Generate default column visibility state from card schema
 * Respects showInPanel property from schema
 */
export function getDefaultColumnVisibility(schema: CardSchema): VisibilityState {
  const visibility: VisibilityState = {
    // System columns always hidden by default
    id: false,
    path: false,
    parentId: false,
  };
  
  // Core fields - check showInCard property (using it as proxy for default visibility)
  if (schema.coreFields.description) {
    visibility.description = false; // Usually too long for grid
  }
  
  if (schema.coreFields.imageUrl && 'showInCard' in schema.coreFields.imageUrl) {
    visibility.imageUrl = !!schema.coreFields.imageUrl.showInCard;
  }
  
  if (schema.coreFields.createdAt) {
    visibility.createdAt = false; // Hidden by default
  }
  
  if (schema.coreFields.updatedAt) {
    visibility.updatedAt = false; // Hidden by default
  }
  
  // Metadata fields - respect showInPanel property
  if (schema.metadataFields) {
    schema.metadataFields.forEach((field: FieldDefinition) => {
      // Only explicitly hide fields where showInPanel is false
      if (!field.showInPanel) {
        visibility[field.id] = false;
      }
    });
  }
  
  return visibility;
}

/**
 * Convert flat array of cards with path-based hierarchy to hierarchical structure
 * for TanStack Table tree rendering
 */
export function cardsToTreeRows(cards: KanbanCard[]): KanbanCard[] {
  if (!cards || cards.length === 0) return [];

  // Create a map for quick lookup
  const cardMap = new Map<string, KanbanCard & { subRows?: KanbanCard[] }>();
  
  cards.forEach(card => {
    cardMap.set(card.id, { ...card, subRows: [] });
  });

  const rootRows: KanbanCard[] = [];

  // Build the tree structure
  cards.forEach(card => {
    const cardWithSubRows = cardMap.get(card.id)!;
    
    if (card.parentId && cardMap.has(card.parentId)) {
      // Has parent - add to parent's subRows
      const parent = cardMap.get(card.parentId)!;
      if (!parent.subRows) {
        parent.subRows = [];
      }
      parent.subRows.push(cardWithSubRows);
    } else {
      // No parent or parent not found - add to root
      rootRows.push(cardWithSubRows);
    }
  });

  return rootRows;
}

/**
 * Flatten tree structure back to flat array
 */
export function flattenTreeRows(rows: KanbanCard[]): KanbanCard[] {
  const flattened: KanbanCard[] = [];
  
  function flatten(row: KanbanCard & { subRows?: KanbanCard[] }) {
    const { subRows, ...card } = row;
    flattened.push(card as KanbanCard);
    
    if (subRows && subRows.length > 0) {
      subRows.forEach(flatten);
    }
  }
  
  rows.forEach(flatten);
  return flattened;
}

/**
 * Get all descendant IDs of a card
 */
export function getDescendantIds(cardId: string, cards: KanbanCard[]): string[] {
  const descendants: string[] = [];
  const children = cards.filter(c => c.parentId === cardId);
  
  children.forEach(child => {
    descendants.push(child.id);
    descendants.push(...getDescendantIds(child.id, cards));
  });
  
  return descendants;
}

/**
 * Convert card schema + tree grid schema to TanStack Table column definitions
 * Merges data model from CardSchema with column config from TreeGridSchema
 */
export function cardSchemaToColumns(
  cardSchema: CardSchema,
  treeGridSchema: TreeGridSchema
): ColumnDef<KanbanCard>[] {
  const columns: ColumnDef<KanbanCard>[] = [];
  
  // Create a map of tree grid column configs for quick lookup
  const columnConfigMap = new Map(
    treeGridSchema.columns.map(col => [col.fieldId, col])
  );

  // Core fields from cardSchema
  const coreFieldsOrder = ['title', 'status', 'description', 'imageUrl', 'createdAt', 'updatedAt'];
  
  coreFieldsOrder.forEach((fieldKey) => {
    const coreField = cardSchema.coreFields[fieldKey as keyof typeof cardSchema.coreFields];
    const columnConfig = columnConfigMap.get(fieldKey);
    
    if (coreField) {
      const isTitle = fieldKey === 'title';
      const isDescription = fieldKey === 'description';
      
      columns.push({
        id: fieldKey,
        accessorKey: fieldKey,
        header: coreField.label,
        size: columnConfig?.width ?? (isTitle ? 300 : isDescription ? 200 : 150),
        minSize: columnConfig?.minWidth ?? (isTitle ? 150 : 80),
        maxSize: columnConfig?.maxWidth,
        enableSorting: columnConfig?.sortable ?? !isDescription,
        enableColumnFilter: columnConfig?.filterable ?? true,
        enableHiding: fieldKey !== 'title',
        enableResizing: columnConfig?.resizable ?? true,
        meta: {
          type: coreField.type,
          editable: 'editable' in coreField ? coreField.editable : true,
          required: 'required' in coreField ? coreField.required : false,
          showInPanel: 'showInCard' in coreField ? coreField.showInCard : true,
          aggregation: columnConfig?.aggregation ?? 'none',
        },
      });
    }
  });

  // Metadata fields from cardSchema (only if showInPanel is true)
  if (cardSchema.metadataFields) {
    cardSchema.metadataFields.forEach((field: FieldDefinition) => {
      if (field.showInPanel) {
        const columnConfig = columnConfigMap.get(field.id);
        columns.push(createColumnFromField(field, columnConfig));
      }
    });
  }

  // System/utility columns
  const systemColumns = [
    { id: 'id', label: 'ID', type: 'text' },
    { id: 'path', label: 'Path', type: 'text' },
    { id: 'parentId', label: 'Parent ID', type: 'text' },
  ];
  
  systemColumns.forEach(col => {
    const schemaField = cardSchema.coreFields[col.id as keyof typeof cardSchema.coreFields];
    const columnConfig = columnConfigMap.get(col.id);
    
    columns.push({
      id: col.id,
      accessorKey: col.id,
      header: schemaField?.label || col.label,
      size: columnConfig?.width ?? 200,
      minSize: columnConfig?.minWidth ?? 100,
      maxSize: columnConfig?.maxWidth,
      enableHiding: true,
      enableSorting: columnConfig?.sortable ?? true,
      enableResizing: columnConfig?.resizable ?? true,
      meta: {
        type: col.type,
        editable: false,
        aggregation: columnConfig?.aggregation ?? 'none',
      },
    });
  });

  return columns;
}

/**
 * Create a column definition from a field definition with optional TreeGrid config override
 */
function createColumnFromField(
  field: FieldDefinition,
  columnConfig?: { 
    width?: number;
    minWidth?: number;
    maxWidth?: number;
    sortable?: boolean;
    filterable?: boolean;
    resizable?: boolean;
    aggregation?: string;
  }
): ColumnDef<KanbanCard> {
  const defaultSize = field.type === 'text' ? 150 : field.type === 'number' ? 100 : 120;
  
  const column: ColumnDef<KanbanCard> = {
    id: field.id,
    accessorFn: (row) => row.metadata?.[field.id],
    header: field.label,
    size: columnConfig?.width ?? defaultSize,
    minSize: columnConfig?.minWidth ?? 80,
    maxSize: columnConfig?.maxWidth,
    enableSorting: columnConfig?.sortable ?? field.sortable,
    enableColumnFilter: columnConfig?.filterable ?? field.filterable,
    enableResizing: columnConfig?.resizable ?? true,
    meta: {
      type: field.type,
      editable: field.editable,
      options: field.options,
      validation: field.validation,
      aggregation: columnConfig?.aggregation ?? 'none',
    },
  };

  return column;
}

/**
 * Format cell value based on type
 */
export function formatCellValue(value: any, type: string): string {
  if (value === null || value === undefined) {
    return '';
  }

  switch (type) {
    case 'date':
      try {
        return format(new Date(value), 'MMM d, yyyy');
      } catch {
        return String(value);
      }
    case 'boolean':
      return value ? 'Yes' : 'No';
    case 'tags':
    case 'multiselect':
      return Array.isArray(value) ? value.join(', ') : String(value);
    case 'number':
      return typeof value === 'number' ? value.toLocaleString() : String(value);
    default:
      return String(value);
  }
}

/**
 * Get color for status badge
 */
export function getStatusColor(status: string): string {
  const statusColors: Record<string, string> = {
    backlog: 'gray',
    todo: 'blue',
    inprogress: 'orange',
    review: 'yellow',
    done: 'green',
  };
  
  return statusColors[status] || 'gray';
}

/**
 * Get color for priority badge
 */
export function getPriorityColor(priority: string): string {
  const priorityColors: Record<string, string> = {
    low: 'gray',
    medium: 'blue',
    high: 'orange',
    urgent: 'red',
  };
  
  return priorityColors[priority] || 'gray';
}

/**
 * Calculate aggregations for grouped rows
 */
export function calculateAggregation(
  rows: Row<KanbanCard>[],
  columnId: string,
  aggregationType: 'count' | 'sum' | 'avg' | 'min' | 'max'
): number | string {
  if (rows.length === 0) return aggregationType === 'count' ? 0 : '-';

  switch (aggregationType) {
    case 'count':
      return rows.length;
      
    case 'sum': {
      const sum = rows.reduce((acc, row) => {
        const value = row.getValue(columnId);
        return acc + (typeof value === 'number' ? value : 0);
      }, 0);
      return sum;
    }
      
    case 'avg': {
      const sum = rows.reduce((acc, row) => {
        const value = row.getValue(columnId);
        return acc + (typeof value === 'number' ? value : 0);
      }, 0);
      return rows.length > 0 ? Math.round(sum / rows.length) : 0;
    }
      
    case 'min': {
      const values = rows
        .map(row => row.getValue(columnId))
        .filter(v => typeof v === 'number') as number[];
      return values.length > 0 ? Math.min(...values) : '-';
    }
      
    case 'max': {
      const values = rows
        .map(row => row.getValue(columnId))
        .filter(v => typeof v === 'number') as number[];
      return values.length > 0 ? Math.max(...values) : '-';
    }
      
    default:
      return '-';
  }
}

/**
 * Filter cards by global search term
 */
export function filterCardsByGlobalSearch(cards: KanbanCard[], searchTerm: string): KanbanCard[] {
  if (!searchTerm || searchTerm.trim() === '') {
    return cards;
  }

  const term = searchTerm.toLowerCase();
  
  return cards.filter(card => {
    // Search in core fields
    if (card.title?.toLowerCase().includes(term)) return true;
    if (card.description?.toLowerCase().includes(term)) return true;
    if (card.status?.toLowerCase().includes(term)) return true;
    
    // Search in metadata
    if (card.metadata) {
      const metadataStr = JSON.stringify(card.metadata).toLowerCase();
      if (metadataStr.includes(term)) return true;
    }
    
    return false;
  });
}

/**
 * Sort cards by multiple criteria
 */
export function sortCards(
  cards: KanbanCard[],
  sorting: Array<{ id: string; desc: boolean }>
): KanbanCard[] {
  if (sorting.length === 0) return cards;

  return [...cards].sort((a, b) => {
    for (const sort of sorting) {
      let aValue: any;
      let bValue: any;

      // Get values based on column ID
      if (sort.id in a) {
        aValue = a[sort.id as keyof KanbanCard];
        bValue = b[sort.id as keyof KanbanCard];
      } else {
        aValue = a.metadata?.[sort.id];
        bValue = b.metadata?.[sort.id];
      }

      // Handle null/undefined
      if (aValue == null && bValue == null) continue;
      if (aValue == null) return sort.desc ? 1 : -1;
      if (bValue == null) return sort.desc ? -1 : 1;

      // Compare values
      let comparison = 0;
      if (typeof aValue === 'string' && typeof bValue === 'string') {
        comparison = aValue.localeCompare(bValue);
      } else if (typeof aValue === 'number' && typeof bValue === 'number') {
        comparison = aValue - bValue;
      } else if (aValue instanceof Date && bValue instanceof Date) {
        comparison = aValue.getTime() - bValue.getTime();
      } else {
        comparison = String(aValue).localeCompare(String(bValue));
      }

      if (comparison !== 0) {
        return sort.desc ? -comparison : comparison;
      }
    }

    return 0;
  });
}
