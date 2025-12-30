import { z } from 'zod';

// TreeGrid Schema Version
export const TREEGRID_SCHEMA_VERSION = '1.0.0';

// Column Configuration
export const ColumnConfig = z.object({
  fieldId: z.string(),
  visible: z.boolean().default(true),
  width: z.number().optional(),
  minWidth: z.number().default(80),
  maxWidth: z.number().optional(),
  pinned: z.enum(['left', 'right', 'none']).default('none'),
  sortable: z.boolean().optional(),
  filterable: z.boolean().optional(),
  resizable: z.boolean().default(true),
  order: z.number(),
  aggregation: z.enum(['count', 'sum', 'avg', 'min', 'max', 'none']).default('none'),
});

export type ColumnConfig = z.infer<typeof ColumnConfig>;

// Grouping Configuration
export const GroupingConfig = z.object({
  enabled: z.boolean().default(false),
  defaultGroupBy: z.array(z.string()).default([]),
  expandedByDefault: z.boolean().default(false),
  showGroupCount: z.boolean().default(true),
  allowMultipleGroups: z.boolean().default(true),
});

export type GroupingConfig = z.infer<typeof GroupingConfig>;

// Export Configuration
export const ExportConfig = z.object({
  enableCSV: z.boolean().default(true),
  enableExcel: z.boolean().default(true),
  enableJSON: z.boolean().default(false),
  defaultFilename: z.string().default('treegrid-export'),
  includeHiddenColumns: z.boolean().default(false),
});

export type ExportConfig = z.infer<typeof ExportConfig>;

// Virtualization Configuration
export const VirtualizationConfig = z.object({
  enabled: z.boolean().default(true),
  rowHeight: z.number().default(42),
  overscan: z.number().default(5),
  estimatedRowHeight: z.number().default(42),
});

export type VirtualizationConfig = z.infer<typeof VirtualizationConfig>;

// Selection Configuration
export const SelectionConfig = z.object({
  enabled: z.boolean().default(true),
  mode: z.enum(['single', 'multiple']).default('multiple'),
  showCheckboxes: z.boolean().default(true),
  selectOnRowClick: z.boolean().default(false),
});

export type SelectionConfig = z.infer<typeof SelectionConfig>;

// Tree Configuration
export const TreeConfig = z.object({
  enabled: z.boolean().default(true),
  expandedByDefault: z.boolean().default(false),
  indentSize: z.number().default(20),
  showChildCount: z.boolean().default(true),
  showExpandCollapseAll: z.boolean().default(true),
});

export type TreeConfig = z.infer<typeof TreeConfig>;

// Sorting Configuration
export const SortingConfig = z.object({
  enabled: z.boolean().default(true),
  multiColumn: z.boolean().default(true),
  defaultSort: z.array(z.object({
    fieldId: z.string(),
    direction: z.enum(['asc', 'desc']),
  })).default([]),
});

export type SortingConfig = z.infer<typeof SortingConfig>;

// Filtering Configuration
export const FilteringConfig = z.object({
  enabled: z.boolean().default(true),
  globalSearch: z.boolean().default(true),
  columnFilters: z.boolean().default(true),
  debounceMs: z.number().default(300),
});

export type FilteringConfig = z.infer<typeof FilteringConfig>;

// Context Menu Configuration
export const ContextMenuConfig = z.object({
  enabled: z.boolean().default(true),
  showEdit: z.boolean().default(true),
  showDelete: z.boolean().default(true),
  showAddChild: z.boolean().default(true),
  showDuplicate: z.boolean().default(true),
  showNavigateToChildren: z.boolean().default(true),
  customActions: z.array(z.object({
    id: z.string(),
    label: z.string(),
    icon: z.string().optional(),
    enabled: z.boolean().default(true),
  })).default([]),
});

export type ContextMenuConfig = z.infer<typeof ContextMenuConfig>;

// TreeGrid Schema
export const TreeGridSchema = z.object({
  version: z.string().default(TREEGRID_SCHEMA_VERSION),
  name: z.string(),
  description: z.string().optional(),
  
  // Column configurations
  columns: z.array(ColumnConfig).default([]),
  
  // Feature configurations
  grouping: GroupingConfig,
  export: ExportConfig,
  virtualization: VirtualizationConfig,
  selection: SelectionConfig,
  tree: TreeConfig,
  sorting: SortingConfig,
  filtering: FilteringConfig,
  contextMenu: ContextMenuConfig,
  
  // Mobile-specific rendering hints
  mobile: z.object({
    enableHorizontalScroll: z.boolean().default(true),
    stickyFirstColumn: z.boolean().default(true),
    compactMode: z.boolean().default(true),
  }),
});

export type TreeGridSchema = z.infer<typeof TreeGridSchema>;

// Default TreeGrid Schema
export const defaultTreeGridSchema: TreeGridSchema = {
  version: TREEGRID_SCHEMA_VERSION,
  name: 'Default TreeGrid',
  description: 'Default TreeGrid configuration with standard settings',
  
  columns: [
    // Selection column
    {
      fieldId: 'select',
      visible: true,
      width: 50,
      minWidth: 50,
      maxWidth: 50,
      pinned: 'left',
      sortable: false,
      filterable: false,
      resizable: false,
      order: 0,
      aggregation: 'none',
    },
    // Title column (always pinned left)
    {
      fieldId: 'title',
      visible: true,
      width: 300,
      minWidth: 150,
      pinned: 'left',
      sortable: true,
      filterable: true,
      resizable: true,
      order: 1,
      aggregation: 'none',
    },
    // Status column
    {
      fieldId: 'status',
      visible: true,
      width: 120,
      minWidth: 100,
      pinned: 'none',
      sortable: true,
      filterable: true,
      resizable: true,
      order: 2,
      aggregation: 'none',
    },
    // Priority column
    {
      fieldId: 'priority',
      visible: true,
      width: 120,
      minWidth: 100,
      pinned: 'none',
      sortable: true,
      filterable: true,
      resizable: true,
      order: 3,
      aggregation: 'none',
    },
    // Assignee column
    {
      fieldId: 'assignee',
      visible: true,
      width: 140,
      minWidth: 100,
      pinned: 'none',
      sortable: true,
      filterable: true,
      resizable: true,
      order: 4,
      aggregation: 'none',
    },
    // Progress column
    {
      fieldId: 'progress',
      visible: true,
      width: 150,
      minWidth: 120,
      pinned: 'none',
      sortable: true,
      filterable: false,
      resizable: true,
      order: 5,
      aggregation: 'avg',
    },
    // Due Date column
    {
      fieldId: 'dueDate',
      visible: true,
      width: 140,
      minWidth: 120,
      pinned: 'none',
      sortable: true,
      filterable: true,
      resizable: true,
      order: 6,
      aggregation: 'none',
    },
    // Tags column
    {
      fieldId: 'tags',
      visible: true,
      width: 180,
      minWidth: 120,
      pinned: 'none',
      sortable: false,
      filterable: true,
      resizable: true,
      order: 7,
      aggregation: 'none',
    },
    // Story Points column
    {
      fieldId: 'storyPoints',
      visible: false,
      width: 120,
      minWidth: 80,
      pinned: 'none',
      sortable: true,
      filterable: true,
      resizable: true,
      order: 8,
      aggregation: 'sum',
    },
    // Description column (hidden by default - too long)
    {
      fieldId: 'description',
      visible: false,
      width: 250,
      minWidth: 150,
      pinned: 'none',
      sortable: false,
      filterable: true,
      resizable: true,
      order: 9,
      aggregation: 'none',
    },
    // Image URL column
    {
      fieldId: 'imageUrl',
      visible: false,
      width: 100,
      minWidth: 80,
      pinned: 'none',
      sortable: false,
      filterable: false,
      resizable: true,
      order: 10,
      aggregation: 'none',
    },
    // Created At column (hidden by default)
    {
      fieldId: 'createdAt',
      visible: false,
      width: 150,
      minWidth: 120,
      pinned: 'none',
      sortable: true,
      filterable: true,
      resizable: true,
      order: 11,
      aggregation: 'none',
    },
    // Updated At column (hidden by default)
    {
      fieldId: 'updatedAt',
      visible: false,
      width: 150,
      minWidth: 120,
      pinned: 'none',
      sortable: true,
      filterable: true,
      resizable: true,
      order: 12,
      aggregation: 'none',
    },
    // System columns (hidden by default)
    {
      fieldId: 'id',
      visible: false,
      width: 200,
      minWidth: 150,
      pinned: 'none',
      sortable: true,
      filterable: true,
      resizable: true,
      order: 13,
      aggregation: 'none',
    },
    {
      fieldId: 'path',
      visible: false,
      width: 200,
      minWidth: 150,
      pinned: 'none',
      sortable: true,
      filterable: true,
      resizable: true,
      order: 14,
      aggregation: 'none',
    },
    {
      fieldId: 'parentId',
      visible: false,
      width: 200,
      minWidth: 150,
      pinned: 'none',
      sortable: true,
      filterable: true,
      resizable: true,
      order: 15,
      aggregation: 'none',
    },
  ],
  
  grouping: {
    enabled: true,
    defaultGroupBy: [],
    expandedByDefault: false,
    showGroupCount: true,
    allowMultipleGroups: true,
  },
  
  export: {
    enableCSV: true,
    enableExcel: true,
    enableJSON: false,
    defaultFilename: 'treegrid-export',
    includeHiddenColumns: false,
  },
  
  virtualization: {
    enabled: true,
    rowHeight: 42,
    overscan: 5,
    estimatedRowHeight: 42,
  },
  
  selection: {
    enabled: true,
    mode: 'multiple',
    showCheckboxes: true,
    selectOnRowClick: false,
  },
  
  tree: {
    enabled: true,
    expandedByDefault: false,
    indentSize: 20,
    showChildCount: true,
    showExpandCollapseAll: true,
  },
  
  sorting: {
    enabled: true,
    multiColumn: true,
    defaultSort: [],
  },
  
  filtering: {
    enabled: true,
    globalSearch: true,
    columnFilters: true,
    debounceMs: 300,
  },
  
  contextMenu: {
    enabled: true,
    showEdit: true,
    showDelete: true,
    showAddChild: true,
    showDuplicate: true,
    showNavigateToChildren: true,
    customActions: [],
  },
  
  mobile: {
    enableHorizontalScroll: true,
    stickyFirstColumn: true,
    compactMode: true,
  },
};
