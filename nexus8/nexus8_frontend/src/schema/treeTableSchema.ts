import { z } from 'zod';

// Tree Grid Schema Version
export const TREE_TABLE_SCHEMA_VERSION = '1.0.0';

// Column Definition
export const TreeTableColumnDefinition = z.object({
  id: z.string(),
  field: z.string(), // Key in the data object
  header: z.string(),
  width: z.number().optional(), // Pixel width
  minWidth: z.number().default(100),
  maxWidth: z.number().optional(),
  
  // Type and Formatting
  type: z.enum(['text', 'number', 'date', 'boolean', 'select', 'custom']).default('text'),
  format: z.string().optional(), // Format string (e.g., for dates or numbers)
  selectOptions: z.array(z.string().or(z.object({ label: z.string(), value: z.string() }))).optional(),
  
  // Behavior
  sortable: z.boolean().default(true),
  filterable: z.boolean().default(true),
  resizable: z.boolean().default(true),
  editable: z.boolean().default(false),
  hidden: z.boolean().default(false),
  pinned: z.enum(['left', 'right', 'none']).default('none'),
  
  // Tree specific
  isTreeColumn: z.boolean().default(false), // This column will show the expand/collapse toggle
  
  // Styling
  align: z.enum(['left', 'center', 'right']).default('left'),
  headerAlign: z.enum(['left', 'center', 'right']).default('left'),
  cellClass: z.string().optional(),
  headerClass: z.string().optional(),
});

export type TreeTableColumnDefinition = z.infer<typeof TreeTableColumnDefinition>;

// Tree Grid Options
export const TreeTableOptions = z.object({
  // General
  rowHeight: z.number().default(40),
  headerHeight: z.number().default(40),
  
  // Features
  enableVirtualization: z.boolean().default(true),
  enableSorting: z.boolean().default(true),
  enableFiltering: z.boolean().default(true),
  enableColumnResizing: z.boolean().default(true),
  enableColumnReordering: z.boolean().default(true),
  enableGrouping: z.boolean().default(true),
  
  // Initial State
  initialGroupBy: z.array(z.string()).optional(), // Array of column IDs to group by initially
  enableSelection: z.boolean().default(true),
  enableMultiSelection: z.boolean().default(false),
  enablePagination: z.boolean().default(false),
  
  // Tree specific
  autoExpandAll: z.boolean().default(false),
  indentation: z.number().default(20), // Indentation per level in pixels
  
  // Pagination (if enabled)
  pageSize: z.number().default(20),
  pageSizes: z.array(z.number()).default([10, 20, 50, 100]),
});

export type TreeTableOptions = z.infer<typeof TreeTableOptions>;

// Tree Grid Schema
export const TreeTableSchema = z.object({
  version: z.string().default(TREE_TABLE_SCHEMA_VERSION),
  id: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  
  columns: z.array(TreeTableColumnDefinition).min(1),
  options: TreeTableOptions.default({} as any),
});

export type TreeTableSchema = z.infer<typeof TreeTableSchema>;

export type TreeTableSchema = z.infer<typeof TreeTableSchema>;

// Default Schema
export const defaultTreeTableSchema = TreeTableSchema.parse({
  version: TREE_TABLE_SCHEMA_VERSION,
  id: 'default-tree-grid',
  name: 'Default Tree Grid',
  columns: [
    {
      id: 'name',
      field: 'name',
      header: 'Name',
      width: 300,
      isTreeColumn: true,
    },
    {
      id: 'size',
      field: 'size',
      header: 'Size',
      width: 100,
      type: 'number',
      align: 'right',
    },
    {
      id: 'type',
      field: 'type',
      header: 'Type',
      width: 150,
    },
    {
      id: 'modified',
      field: 'modified',
      header: 'Date Modified',
      width: 200,
      type: 'date',
    },
  ],
  options: {
    enableVirtualization: true,
    enableSorting: true,
    enableFiltering: true,
    enableColumnResizing: true,
    rowHeight: 40,
    indentation: 24,
  },
});
