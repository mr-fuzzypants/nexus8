import { z } from 'zod';

// Panel Schema Version
export const PANEL_SCHEMA_VERSION = '1.0.0';

// Field Render Type for panels (different from form field types)
export const PanelFieldType = z.enum([
  'text',
  'badge',
  'progress',
  'avatar',
  'date',
  'datetime',
  'tags',
  'link',
  'code',
  'json',
  'markdown',
  'image',
  'chart',
  'list',
  'table',
  'custom',
]);

export type PanelFieldType = z.infer<typeof PanelFieldType>;

// Field Display Configuration
export const FieldDisplay = z.object({
  fieldId: z.string(),
  label: z.string().optional(), // Override field label
  renderType: PanelFieldType.optional(), // Override render type
  
  // Display options
  hideLabel: z.boolean().default(false),
  hideEmpty: z.boolean().default(true),
  inline: z.boolean().default(false),
  span: z.number().min(1).max(12).default(12), // Grid span
  
  // Formatting options
  format: z.string().optional(), // Date format, number format, etc.
  prefix: z.string().optional(),
  suffix: z.string().optional(),
  transform: z.string().optional(), // JS expression for value transformation
  
  // Conditional display
  showIf: z.string().optional(), // JS expression for conditional display
  
  // Custom styling
  color: z.string().optional(),
  size: z.enum(['xs', 'sm', 'md', 'lg', 'xl']).optional(),
  weight: z.enum(['normal', 'bold']).optional(),
  
  // Interactive options
  clickable: z.boolean().default(false),
  copyable: z.boolean().default(false),
  editable: z.boolean().default(false),
});

export type FieldDisplay = z.infer<typeof FieldDisplay>;

// Panel Tab Definition
export const TabDefinition = z.object({
  id: z.string(),
  label: z.string(),
  icon: z.string().optional(), // Tabler icon name
  description: z.string().optional(),
  order: z.number(),
  
  // Content configuration
  fields: z.array(FieldDisplay),
  
  // Layout configuration
  layout: z.enum(['single-column', 'two-column', 'grid', 'sections']).default('single-column'),
  spacing: z.enum(['xs', 'sm', 'md', 'lg', 'xl']).default('md'),
  
  // Sections for organized display
  sections: z.array(z.object({
    id: z.string(),
    title: z.string(),
    description: z.string().optional(),
    fields: z.array(z.string()), // Field IDs
    collapsible: z.boolean().default(false),
    defaultCollapsed: z.boolean().default(false),
    columns: z.number().min(1).max(4).default(1),
  })).optional(),
  
  // Tab behavior
  lazy: z.boolean().default(false), // Load content when first accessed
  refreshable: z.boolean().default(false),
  
  // Access control
  permissions: z.array(z.string()).optional(),
  
  // Mobile settings
  mobile: z.object({
    hideLabel: z.boolean().default(false),
    order: z.number().optional(), // Different order on mobile
    fullWidth: z.boolean().default(true),
  }).optional(),
});

export type TabDefinition = z.infer<typeof TabDefinition>;

// Panel Actions
export const ActionDefinition = z.object({
  id: z.string(),
  label: z.string(),
  icon: z.string().optional(),
  color: z.string().optional(),
  variant: z.enum(['filled', 'light', 'outline', 'subtle', 'default']).default('default'),
  
  // Action configuration
  action: z.enum(['edit', 'delete', 'duplicate', 'export', 'custom']),
  handler: z.string().optional(), // Function name or JS expression
  
  // Confirmation
  requireConfirmation: z.boolean().default(false),
  confirmationTitle: z.string().optional(),
  confirmationMessage: z.string().optional(),
  
  // Visibility
  showIf: z.string().optional(), // JS expression
  permissions: z.array(z.string()).optional(),
  
  // Mobile
  hideOnMobile: z.boolean().default(false),
});

export type ActionDefinition = z.infer<typeof ActionDefinition>;

// Info Panel Schema
export const InfoPanelSchema = z.object({
  version: z.string().default(PANEL_SCHEMA_VERSION),
  name: z.string(),
  description: z.string().optional(),
  
  // Panel configuration
  tabs: z.array(TabDefinition).min(1),
  defaultTab: z.string().optional(), // Default active tab ID
  
  // Panel layout
  layout: z.object({
    width: z.number().default(350),
    minWidth: z.number().default(300),
    maxWidth: z.number().default(500),
    resizable: z.boolean().default(true),
    
    // Position (for desktop)
    position: z.enum(['right', 'left']).default('right'),
    
    // Mobile behavior
    mobile: z.object({
      type: z.enum(['drawer', 'modal', 'overlay']).default('drawer'),
      position: z.enum(['bottom', 'right', 'left']).default('bottom'),
      height: z.string().default('60vh'), // For bottom drawer
      overlay: z.boolean().default(true),
      closeOnOutsideClick: z.boolean().default(true),
    }),
    
    // Animation
    animation: z.object({
      enabled: z.boolean().default(true),
      duration: z.number().default(300),
      easing: z.string().default('ease-out'),
    }),
  }),
  
  // Panel actions (header buttons)
  actions: z.array(ActionDefinition).default([]),
  
  // Auto-behaviors
  behavior: z.object({
    autoOpen: z.boolean().default(false), // Auto-open when card selected
    autoClose: z.boolean().default(false), // Auto-close when card deselected
    keepOpen: z.boolean().default(true), // Keep open when switching cards
    rememberTab: z.boolean().default(true), // Remember active tab per card
    
    // Keyboard navigation
    enableKeyboardNavigation: z.boolean().default(true),
    keyboardShortcuts: z.object({
      close: z.array(z.string()).default(['Escape']),
      nextTab: z.array(z.string()).default(['Tab']),
      prevTab: z.array(z.string()).default(['Shift+Tab']),
      edit: z.array(z.string()).default(['e']),
    }),
    
    // Auto-refresh
    autoRefresh: z.boolean().default(false),
    refreshInterval: z.number().default(30000),
  }),
  
  // Content loading
  loading: z.object({
    showSkeleton: z.boolean().default(true),
    skeletonLines: z.number().default(5),
    emptyStateMessage: z.string().default('Select a card to view details'),
    errorMessage: z.string().default('Failed to load card details'),
  }),
  
  // Theme customization
  theme: z.object({
    headerStyle: z.enum(['minimal', 'bordered', 'filled']).default('bordered'),
    contentPadding: z.enum(['xs', 'sm', 'md', 'lg', 'xl']).default('md'),
    tabsVariant: z.enum(['default', 'pills', 'outline']).default('default'),
    
    // Colors
    headerBackground: z.string().optional(),
    contentBackground: z.string().optional(),
    borderColor: z.string().optional(),
  }),
});

export type InfoPanelSchema = z.infer<typeof InfoPanelSchema>;

// Helper functions for creating field and action definitions
const createFieldDisplay = (partial: Partial<FieldDisplay> & { fieldId: string; span: number }): FieldDisplay => ({
  hideLabel: false,
  hideEmpty: true,
  inline: false,
  clickable: false,
  copyable: false,
  editable: false,
  ...partial,
});

const createActionDefinition = (partial: Partial<ActionDefinition> & { id: string; label: string; action: ActionDefinition['action'] }): ActionDefinition => ({
  variant: 'default',
  requireConfirmation: false,
  hideOnMobile: false,
  ...partial,
});

// Default Info Panel Schema
export const defaultInfoPanelSchema: InfoPanelSchema = {
  version: PANEL_SCHEMA_VERSION,
  name: 'Standard Info Panel',
  description: 'Standard information panel with common tabs',
  
  tabs: [
    {
      id: 'details',
      label: 'Details',
      icon: 'IconInfoCircle',
      description: 'Card details and metadata',
      order: 1,
      
      fields: [
        createFieldDisplay({ fieldId: 'title', renderType: 'text', span: 12, weight: 'bold', size: 'lg' }),
        createFieldDisplay({ fieldId: 'description', renderType: 'markdown', span: 12 }),
        createFieldDisplay({ fieldId: 'status', renderType: 'badge', span: 6 }),
        createFieldDisplay({ fieldId: 'priority', renderType: 'badge', span: 6 }),
        createFieldDisplay({ fieldId: 'assignee', renderType: 'avatar', span: 6 }),
        createFieldDisplay({ fieldId: 'dueDate', renderType: 'date', span: 6, format: 'MMM d, yyyy' }),
        createFieldDisplay({ fieldId: 'tags', renderType: 'tags', span: 12 }),
        createFieldDisplay({ fieldId: 'storyPoints', renderType: 'text', span: 6, hideEmpty: true }),
      ],
      
      layout: 'grid',
      spacing: 'md',
      lazy: false,
      refreshable: false,
      
      sections: [
        {
          id: 'basic',
          title: 'Basic Information',
          fields: ['title', 'description', 'status'],
          collapsible: false,
          defaultCollapsed: false,
          columns: 1,
        },
        {
          id: 'metadata',
          title: 'Metadata',
          fields: ['priority', 'assignee', 'dueDate', 'storyPoints'],
          collapsible: true,
          defaultCollapsed: false,
          columns: 2,
        },
        {
          id: 'organization',
          title: 'Organization',
          fields: ['tags'],
          collapsible: true,
          defaultCollapsed: false,
          columns: 1,
        },
      ],
    },
    
    {
      id: 'activity',
      label: 'Activity',
      icon: 'IconHistory',
      description: 'Card activity and history',
      order: 2,
      
      fields: [
        createFieldDisplay({ fieldId: 'createdAt', renderType: 'datetime', span: 12, label: 'Created' }),
        createFieldDisplay({ fieldId: 'updatedAt', renderType: 'datetime', span: 12, label: 'Last Updated' }),
      ],
      
      layout: 'single-column',
      spacing: 'sm',
      lazy: true,
      refreshable: false,
    },
    
    {
      id: 'comments',
      label: 'Comments',
      icon: 'IconMessageCircle',
      description: 'Card comments and discussions',
      order: 3,
      
      fields: [],
      layout: 'single-column',
      spacing: 'md',
      lazy: true,
      refreshable: true,
    },
    
    {
      id: 'children',
      label: 'Sub-items',
      icon: 'IconHierarchy',
      description: 'Child cards and hierarchy',
      order: 4,
      
      fields: [],
      layout: 'single-column',
      spacing: 'sm',
      lazy: true,
      refreshable: false,
    },
    
    {
      id: 'stats',
      label: 'Stats',
      icon: 'IconChartBar',
      description: 'Card statistics and metrics',
      order: 5,
      
      fields: [
        createFieldDisplay({ fieldId: 'storyPoints', renderType: 'progress', span: 12, label: 'Completion' }),
      ],
      
      layout: 'grid',
      spacing: 'md',
      lazy: true,
      refreshable: false,
    },
  ],
  
  defaultTab: 'details',
  
  layout: {
    width: 350,
    minWidth: 300,
    maxWidth: 500,
    resizable: true,
    position: 'right',
    
    mobile: {
      type: 'drawer',
      position: 'bottom',
      height: '60vh',
      overlay: true,
      closeOnOutsideClick: true,
    },
    
    animation: {
      enabled: true,
      duration: 300,
      easing: 'ease-out',
    },
  },
  
  actions: [
    createActionDefinition({
      id: 'edit',
      label: 'Edit',
      icon: 'IconEdit',
      color: 'blue',
      action: 'edit',
      variant: 'light',
    }),
    createActionDefinition({
      id: 'duplicate',
      label: 'Duplicate',
      icon: 'IconCopy',
      action: 'duplicate',
      variant: 'subtle',
    }),
    createActionDefinition({
      id: 'delete',
      label: 'Delete',
      icon: 'IconTrash',
      color: 'red',
      action: 'delete',
      variant: 'subtle',
      requireConfirmation: true,
      confirmationTitle: 'Delete Card',
      confirmationMessage: 'Are you sure you want to delete this card? This action cannot be undone.',
    }),
  ],
  
  behavior: {
    autoOpen: true,
    autoClose: false,
    keepOpen: true,
    rememberTab: true,
    enableKeyboardNavigation: true,
    
    keyboardShortcuts: {
      close: ['Escape'],
      nextTab: ['Tab'],
      prevTab: ['Shift+Tab'],
      edit: ['e'],
    },
    
    autoRefresh: false,
    refreshInterval: 30000,
  },
  
  loading: {
    showSkeleton: true,
    skeletonLines: 5,
    emptyStateMessage: 'Select a card to view details',
    errorMessage: 'Failed to load card details',
  },
  
  theme: {
    headerStyle: 'bordered',
    contentPadding: 'md',
    tabsVariant: 'default',
  },
};

// Schema validation functions
export const validateInfoPanelSchema = (schema: unknown): InfoPanelSchema => {
  return InfoPanelSchema.parse(schema);
};

// Helper functions
export const getTabById = (schema: InfoPanelSchema, tabId: string): TabDefinition | undefined => {
  return schema.tabs.find(tab => tab.id === tabId);
};

export const getOrderedTabs = (schema: InfoPanelSchema): TabDefinition[] => {
  return [...schema.tabs].sort((a, b) => a.order - b.order);
};

export const getDefaultTab = (schema: InfoPanelSchema): TabDefinition | undefined => {
  const defaultTabId = schema.defaultTab;
  if (defaultTabId) {
    return getTabById(schema, defaultTabId);
  }
  
  // Return first tab if no default specified
  const orderedTabs = getOrderedTabs(schema);
  return orderedTabs[0];
};