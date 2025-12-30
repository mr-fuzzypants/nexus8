import { z } from 'zod';

// Card Schema Version
export const CARD_SCHEMA_VERSION = '1.0.0';

// Field Types
export const FieldType = z.enum([
  'text',
  'textarea',
  'number',
  'date',
  'select',
  'multiselect',
  'boolean',
  'email',
  'url',
  'color',
  'json',
  'tags',
]);

export type FieldType = z.infer<typeof FieldType>;

// Validation Rules
export const ValidationRule = z.object({
  type: z.enum(['required', 'minLength', 'maxLength', 'min', 'max', 'pattern', 'email', 'url']),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  message: z.string().optional(),
});

export type ValidationRule = z.infer<typeof ValidationRule>;

// Field Definition
export const FieldDefinition = z.object({
  id: z.string(),
  label: z.string(),
  type: FieldType,
  required: z.boolean().default(false),
  defaultValue: z.any().optional(),
  placeholder: z.string().optional(),
  helpText: z.string().optional(),
  options: z.array(z.object({
    label: z.string(),
    value: z.string(),
    color: z.string().optional(),
  })).optional(),
  validation: z.array(ValidationRule).default([]),
  gridColumns: z.number().min(1).max(12).default(12), // Mantine Grid columns
  mobileColumns: z.number().min(1).max(12).default(12),
  showInCard: z.boolean().default(false), // Show in card preview
  showInPanel: z.boolean().default(true), // Show in info panel
  editable: z.boolean().default(true),
  sortable: z.boolean().default(false),
  filterable: z.boolean().default(false),
});

export type FieldDefinition = z.infer<typeof FieldDefinition>;

// Card Schema
export const CardSchema = z.object({
  version: z.string().default(CARD_SCHEMA_VERSION),
  name: z.string(),
  description: z.string().optional(),
  
  // Core fields (always present)
  coreFields: z.object({
    id: z.object({
      type: z.literal('text'),
      label: z.string().default('ID'),
      editable: z.boolean().default(false),
    }),
    title: z.object({
      type: z.literal('text'),
      label: z.string().default('Title'),
      required: z.boolean().default(true),
      showInCard: z.boolean().default(true),
    }),
    description: z.object({
      type: z.literal('textarea'),
      label: z.string().default('Description'),
      showInCard: z.boolean().default(true),
    }),
    status: z.object({
      type: z.literal('select'),
      label: z.string().default('Status'),
      required: z.boolean().default(true),
      showInCard: z.boolean().default(true),
    }),
    path: z.object({
      type: z.literal('text'),
      label: z.string().default('Path'),
      editable: z.boolean().default(false),
    }),
    createdAt: z.object({
      type: z.literal('date'),
      label: z.string().default('Created'),
      editable: z.boolean().default(false),
    }),
    updatedAt: z.object({
      type: z.literal('date'),
      label: z.string().default('Updated'),
      editable: z.boolean().default(false),
    }),
    imageUrl: z.object({
      type: z.literal('url'),
      label: z.string().default('Image'),
      required: z.boolean().default(false),
      showInCard: z.boolean().default(true),
      placeholder: z.string().default('https://via.placeholder.com/300x200?text=No+Image'),
    }),
  }),
  
  // Custom metadata fields
  metadataFields: z.array(FieldDefinition).default([]),
  
  // Form layout
  formLayout: z.object({
    sections: z.array(z.object({
      title: z.string(),
      description: z.string().optional(),
      fields: z.array(z.string()), // Field IDs
      collapsible: z.boolean().default(false),
      defaultCollapsed: z.boolean().default(false),
    })).default([]),
    submitLabel: z.string().default('Save'),
    cancelLabel: z.string().default('Cancel'),
  }),
  
  // Mobile-specific rendering hints
  mobile: z.object({
    cardHeight: z.enum(['compact', 'normal', 'expanded']).default('normal'),
    showFieldLabels: z.boolean().default(true),
    maxPreviewFields: z.number().default(3),
  }),
});

export type CardSchema = z.infer<typeof CardSchema>;

// Default Card Schema
export const defaultCardSchema: CardSchema = {
  version: CARD_SCHEMA_VERSION,
  name: 'Standard Card',
  description: 'Standard Kanban card with basic fields',
  
  coreFields: {
    id: { type: 'text', label: 'ID', editable: false },
    title: { type: 'text', label: 'Title', required: true, showInCard: true },
    description: { type: 'textarea', label: 'Description', showInCard: true },
    status: { type: 'select', label: 'Status', required: true, showInCard: true },
    path: { type: 'text', label: 'Path', editable: false },
    createdAt: { type: 'date', label: 'Created', editable: false },
    updatedAt: { type: 'date', label: 'Updated', editable: false },
    imageUrl: { type: 'url', label: 'Image', required: false, showInCard: true, placeholder: 'https://via.placeholder.com/300x160?text=No+Image' },
  },
  
  metadataFields: [
    {
      id: 'imageUrl',
      label: 'Image URL',
      type: 'url',
      required: false,
      showInCard: true,
      showInPanel: true,
      editable: true,
      sortable: false,
      filterable: false,
      placeholder: 'https://example.com/image.jpg',
      helpText: 'URL of the image to display on the card',
      validation: [
        { type: 'url', message: 'Must be a valid URL' },
      ],
      gridColumns: 12,
      mobileColumns: 12,
    },
    {
      id: 'priority',
      label: 'Priority',
      type: 'select',
      required: false,
      showInCard: true,
      showInPanel: true,
      editable: true,
      sortable: true,
      filterable: true,
      validation: [],
      options: [
        { label: 'Low', value: 'low', color: 'blue' },
        { label: 'Medium', value: 'medium', color: 'yellow' },
        { label: 'High', value: 'high', color: 'orange' },
        { label: 'Critical', value: 'critical', color: 'red' },
      ],
      gridColumns: 6,
      mobileColumns: 12,
    },
    {
      id: 'assignee',
      label: 'Assignee',
      type: 'select',
      required: false,
      showInCard: true,
      showInPanel: true,
      editable: true,
      sortable: true,
      filterable: true,
      validation: [],
      options: [
        { label: 'John Doe', value: 'john', color: 'blue' },
        { label: 'Jane Smith', value: 'jane', color: 'green' },
        { label: 'Bob Wilson', value: 'bob', color: 'purple' },
      ],
      gridColumns: 6,
      mobileColumns: 12,
    },
    {
      id: 'dueDate',
      label: 'Due Date',
      type: 'date',
      required: false,
      showInCard: true,
      showInPanel: true,
      editable: true,
      sortable: true,
      filterable: true,
      validation: [],
      gridColumns: 6,
      mobileColumns: 12,
    },
    {
      id: 'tags',
      label: 'Tags',
      type: 'tags',
      required: false,
      showInCard: true,
      showInPanel: true,
      editable: true,
      sortable: false,
      filterable: true,
      validation: [],
      gridColumns: 6,
      mobileColumns: 12,
    },
    {
      id: 'storyPoints',
      label: 'Story Points',
      type: 'number',
      required: false,
      showInCard: false,
      showInPanel: true,
      editable: true,
      sortable: true,
      filterable: true,
      validation: [
        { type: 'min', value: 0, message: 'Story points must be positive' },
        { type: 'max', value: 100, message: 'Story points must be less than 100' },
      ],
      gridColumns: 4,
      mobileColumns: 12,
    },
  ],
  
  formLayout: {
    sections: [
      {
        title: 'Basic Information',
        fields: ['title', 'description', 'status'],
        collapsible: false,
        defaultCollapsed: false,
      },
      {
        title: 'Details',
        fields: ['priority', 'assignee', 'dueDate', 'storyPoints'],
        collapsible: false,
        defaultCollapsed: false,
      },
      {
        title: 'Organization',
        fields: ['tags'],
        collapsible: true,
        defaultCollapsed: false,
      },
    ],
    submitLabel: 'Save Card',
    cancelLabel: 'Cancel',
  },
  
  mobile: {
    cardHeight: 'normal',
    showFieldLabels: true,
    maxPreviewFields: 3,
  },
};

// Card Data Interface
export interface KanbanCard {
  id: string;
  title: string;
  description: string;
  path: string;
  parentId?: string;
  children?: string[];
  status: string;
  aggregateStatus?: string; // Computed from status based on kanban schema
  imageUrl?: string; // Optional image URL for the card
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, any>;
}

// Schema validation functions
export const validateCardSchema = (schema: unknown): CardSchema => {
  return CardSchema.parse(schema);
};

export const validateCard = (card: unknown, _schema: CardSchema): KanbanCard => {
  // Basic card structure
  const baseSchema = z.object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    path: z.string(),
    parentId: z.string().optional(),
    children: z.array(z.string()).optional(),
    status: z.string(),
    imageUrl: z.string().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
    metadata: z.record(z.string(), z.any()),
  });
  
  return baseSchema.parse(card);
};