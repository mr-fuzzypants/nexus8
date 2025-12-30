import { z } from 'zod';

// Kanban Schema Version
export const KANBAN_SCHEMA_VERSION = '1.0.0';

// Aggregate Status Type
export const AggregateStatusType = z.enum(['not-started', 'in-progress', 'finished']);
export type AggregateStatusType = z.infer<typeof AggregateStatusType>;

// Aggregate Status Definition
export const AggregateStatusDefinition = z.object({
  id: AggregateStatusType,
  label: z.string(),
  color: z.string(),
  description: z.string().optional(),
});

export type AggregateStatusDefinition = z.infer<typeof AggregateStatusDefinition>;

// Default Aggregate Statuses
export const defaultAggregateStatuses: AggregateStatusDefinition[] = [
  {
    id: 'not-started',
    label: 'Not Started',
    color: 'gray',
    description: 'Work has not begun',
  },
  {
    id: 'in-progress',
    label: 'In Progress',
    color: 'blue',
    description: 'Work is currently in progress',
  },
  {
    id: 'finished',
    label: 'Finished',
    color: 'green',
    description: 'Work is complete',
  },
];

// Column Status Definition
export const StatusDefinition = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  color: z.string().optional(), // Mantine color or hex
  icon: z.string().optional(), // Tabler icon name
  order: z.number(),
  
  // Aggregate status mapping
  aggregateStatus: AggregateStatusType.default('not-started'),
  
  // Behavior settings
  allowDrop: z.boolean().default(true),
  allowDrag: z.boolean().default(true),
  isInitial: z.boolean().default(false), // Default status for new cards
  isFinal: z.boolean().default(false), // Final status (completed, archived, etc.)
  
  // Visual settings
  maxCards: z.number().optional(), // WIP limit
  showCardCount: z.boolean().default(true),
  collapsible: z.boolean().default(false),
  defaultCollapsed: z.boolean().default(false),
  
  // Mobile settings
  mobileWidth: z.enum(['narrow', 'normal', 'wide']).default('normal'),
  mobileOrder: z.number().optional(), // Different order on mobile
});

export type StatusDefinition = z.infer<typeof StatusDefinition>;

// Column Layout Definition
export const ColumnLayout = z.object({
  type: z.enum(['fixed', 'flexible', 'scrollable']).default('scrollable'),
  minWidth: z.number().default(280),
  maxWidth: z.number().default(400),
  mobileMinWidth: z.number().default(250),
  spacing: z.enum(['xs', 'sm', 'md', 'lg', 'xl']).default('md'),
  
  // Responsive breakpoints
  breakpoints: z.object({
    mobile: z.number().default(768),
    tablet: z.number().default(1024),
    desktop: z.number().default(1200),
  }),
  
  // Mobile behavior
  mobileLayout: z.enum(['horizontal-scroll', 'vertical-stack', 'tabs']).default('horizontal-scroll'),
});

export type ColumnLayout = z.infer<typeof ColumnLayout>;

// Kanban Board Schema
export const KanbanSchema = z.object({
  version: z.string().default(KANBAN_SCHEMA_VERSION),
  name: z.string(),
  description: z.string().optional(),
  
  // Status/Column definitions
  statuses: z.array(StatusDefinition).min(1),
  
  // Layout configuration
  layout: ColumnLayout.optional().default({
    type: 'scrollable',
    minWidth: 280,
    maxWidth: 400,
    mobileMinWidth: 250,
    spacing: 'md',
    breakpoints: {
      mobile: 768,
      tablet: 1024,
      desktop: 1200,
    },
    mobileLayout: 'horizontal-scroll',
  }),
  
  // Board settings
  settings: z.object({
    // Card settings
    showCardIds: z.boolean().default(false),
    showCardDates: z.boolean().default(true),
    cardSpacing: z.enum(['xs', 'sm', 'md', 'lg']).default('sm'),
    
    // Drag and drop
    enableDragDrop: z.boolean().default(true),
    enableReordering: z.boolean().default(true),
    enableStatusChange: z.boolean().default(true),
    requireConfirmation: z.boolean().default(false), // For status changes
    
    // Virtualization
    enableVirtualization: z.boolean().default(true),
    virtualItemSize: z.number().default(120), // Estimated item height
    overscan: z.number().default(5), // Items to render outside viewport
    
    // Auto-refresh
    autoRefresh: z.boolean().default(false),
    refreshInterval: z.number().default(30000), // ms
    
    // Keyboard navigation
    enableKeyboardNavigation: z.boolean().default(true),
    keyboardShortcuts: z.object({
      navigateUp: z.array(z.string()).default(['ArrowUp']),
      navigateDown: z.array(z.string()).default(['ArrowDown']),
      navigateLeft: z.array(z.string()).default(['ArrowLeft']),
      navigateRight: z.array(z.string()).default(['ArrowRight']),
      openCard: z.array(z.string()).default(['Enter', 'Space']),
      editCard: z.array(z.string()).default(['e']),
      deleteCard: z.array(z.string()).default(['Delete']),
      newCard: z.array(z.string()).default(['n']),
      undo: z.array(z.string()).default(['Meta+z', 'Control+z']),
      redo: z.array(z.string()).default(['Meta+Shift+z', 'Control+Shift+z']),
    }),
  }),
  
  // Filtering and searching
  filters: z.object({
    enableSearch: z.boolean().default(true),
    searchFields: z.array(z.string()).default(['title', 'description']),
    enableStatusFilter: z.boolean().default(true),
    enableDateFilter: z.boolean().default(true),
    enableMetadataFilter: z.boolean().default(true),
    saveFiltersInUrl: z.boolean().default(true),
    
    // Quick filters
    quickFilters: z.array(z.object({
      id: z.string(),
      label: z.string(),
      filter: z.record(z.string(), z.any()), // Filter criteria
      icon: z.string().optional(),
      color: z.string().optional(),
    })).default([]),
  }),
  
  // Theming
  theme: z.object({
    primaryColor: z.string().default('blue'),
    headerStyle: z.enum(['minimal', 'standard', 'prominent']).default('standard'),
    cardStyle: z.enum(['flat', 'bordered', 'elevated']).default('bordered'),
    columnStyle: z.enum(['minimal', 'bordered', 'elevated']).default('bordered'),
    
    // Dark mode
    supportsDarkMode: z.boolean().default(true),
    defaultTheme: z.enum(['light', 'dark', 'auto']).default('auto'),
  }),
  
  // Mobile-specific settings
  mobile: z.object({
    swipeToChangeStatus: z.boolean().default(true),
    longPressToEdit: z.boolean().default(true),
    pullToRefresh: z.boolean().default(true),
    showColumnHeaders: z.boolean().default(true),
    collapsibleColumns: z.boolean().default(true),
    touchScrollSensitivity: z.enum(['low', 'normal', 'high']).default('normal'),
  }),
});

export type KanbanSchema = z.infer<typeof KanbanSchema>;

// Default Kanban Schema
export const defaultKanbanSchema: KanbanSchema = {
  version: KANBAN_SCHEMA_VERSION,
  name: 'Standard Kanban Board',
  description: 'A standard Kanban board with common workflow statuses',
  
  statuses: [
    {
      id: 'backlog',
      label: 'Backlog',
      description: 'Items waiting to be started',
      color: 'gray',
      icon: 'IconInbox',
      order: 1,
      aggregateStatus: 'not-started',
      allowDrop: true,
      allowDrag: true,
      isInitial: true,
      isFinal: false,
      showCardCount: true,
      collapsible: false,
      defaultCollapsed: false,
      mobileWidth: 'normal',
    },
    {
      id: 'todo',
      label: 'To Do',
      description: 'Items ready to be worked on',
      color: 'blue',
      icon: 'IconListCheck',
      order: 2,
      aggregateStatus: 'not-started',
      allowDrop: true,
      allowDrag: true,
      isInitial: false,
      isFinal: false,
      showCardCount: true,
      collapsible: false,
      defaultCollapsed: false,
      mobileWidth: 'normal',
    },
    {
      id: 'inprogress',
      label: 'In Progress',
      description: 'Items currently being worked on',
      color: 'yellow',
      icon: 'IconLoader',
      order: 3,
      aggregateStatus: 'in-progress',
      allowDrop: true,
      allowDrag: true,
      isInitial: false,
      isFinal: false,
      maxCards: 5, // WIP limit
      showCardCount: true,
      collapsible: false,
      defaultCollapsed: false,
      mobileWidth: 'normal',
    },
    {
      id: 'review',
      label: 'Review',
      description: 'Items pending review',
      color: 'orange',
      icon: 'IconEye',
      order: 4,
      aggregateStatus: 'in-progress',
      allowDrop: true,
      allowDrag: true,
      isInitial: false,
      isFinal: false,
      showCardCount: true,
      collapsible: false,
      defaultCollapsed: false,
      mobileWidth: 'normal',
    },
    {
      id: 'done',
      label: 'Done',
      description: 'Completed items',
      color: 'green',
      icon: 'IconCheck',
      order: 5,
      aggregateStatus: 'finished',
      allowDrop: true,
      allowDrag: false, // Can't drag from done
      isInitial: false,
      isFinal: true,
      showCardCount: true,
      collapsible: true,
      defaultCollapsed: false,
      mobileWidth: 'narrow',
    },
  ],
  
  layout: {
    type: 'scrollable',
    minWidth: 280,
    maxWidth: 400,
    mobileMinWidth: 250,
    spacing: 'md',
    breakpoints: {
      mobile: 768,
      tablet: 1024,
      desktop: 1200,
    },
    mobileLayout: 'horizontal-scroll',
  },
  
  settings: {
    showCardIds: false,
    showCardDates: true,
    cardSpacing: 'sm',
    enableDragDrop: true,
    enableReordering: true,
    enableStatusChange: true,
    requireConfirmation: false,
    enableVirtualization: true,
    virtualItemSize: 120,
    overscan: 5,
    autoRefresh: false,
    refreshInterval: 30000,
    enableKeyboardNavigation: true,
    keyboardShortcuts: {
      navigateUp: ['ArrowUp'],
      navigateDown: ['ArrowDown'],
      navigateLeft: ['ArrowLeft'],
      navigateRight: ['ArrowRight'],
      openCard: ['Enter', 'Space'],
      editCard: ['e'],
      deleteCard: ['Delete'],
      newCard: ['n'],
      undo: ['Meta+z', 'Control+z'],
      redo: ['Meta+Shift+z', 'Control+Shift+z'],
    },
  },
  
  filters: {
    enableSearch: true,
    searchFields: ['title', 'description'],
    enableStatusFilter: true,
    enableDateFilter: true,
    enableMetadataFilter: true,
    saveFiltersInUrl: true,
    quickFilters: [
      {
        id: 'my-cards',
        label: 'My Cards',
        filter: { assignee: 'current-user' },
        icon: 'IconUser',
        color: 'blue',
      },
      {
        id: 'high-priority',
        label: 'High Priority',
        filter: { priority: ['high', 'critical'] },
        icon: 'IconAlert',
        color: 'red',
      },
      {
        id: 'due-soon',
        label: 'Due Soon',
        filter: { dueDate: { $lte: '7d' } },
        icon: 'IconClock',
        color: 'orange',
      },
    ],
  },
  
  theme: {
    primaryColor: 'blue',
    headerStyle: 'standard',
    cardStyle: 'bordered',
    columnStyle: 'bordered',
    supportsDarkMode: true,
    defaultTheme: 'auto',
  },
  
  mobile: {
    swipeToChangeStatus: true,
    longPressToEdit: true,
    pullToRefresh: true,
    showColumnHeaders: true,
    collapsibleColumns: true,
    touchScrollSensitivity: 'normal',
  },
};

// Schema validation functions
export const validateKanbanSchema = (schema: unknown): KanbanSchema => {
  return KanbanSchema.parse(schema);
};

// Helper functions
export const getStatusById = (schema: KanbanSchema, statusId: string): StatusDefinition | undefined => {
  return schema.statuses.find(status => status.id === statusId);
};

export const getInitialStatus = (schema: KanbanSchema): StatusDefinition | undefined => {
  return schema.statuses.find(status => status.isInitial);
};

export const getFinalStatuses = (schema: KanbanSchema): StatusDefinition[] => {
  return schema.statuses.filter(status => status.isFinal);
};

export const getNextStatus = (schema: KanbanSchema, currentStatusId: string): StatusDefinition | undefined => {
  const current = getStatusById(schema, currentStatusId);
  if (!current) return undefined;
  
  const nextOrder = current.order + 1;
  return schema.statuses.find(status => status.order === nextOrder);
};

export const getPreviousStatus = (schema: KanbanSchema, currentStatusId: string): StatusDefinition | undefined => {
  const current = getStatusById(schema, currentStatusId);
  if (!current) return undefined;
  
  const prevOrder = current.order - 1;
  return schema.statuses.find(status => status.order === prevOrder);
};

export const getOrderedStatuses = (schema: KanbanSchema): StatusDefinition[] => {
  return [...schema.statuses].sort((a, b) => a.order - b.order);
};