import type { 
  CardSchema,
  FieldDefinition,
  FieldType,
  ValidationRule
} from '../schema';

// Schema validation utilities
export const validateSchemaField = (value: any, field: FieldDefinition): { isValid: boolean; errors: string[] } => {
  const errors: string[] = [];
  
  // Check if field is required
  if (field.required && (value == null || value === '')) {
    errors.push(`${field.label} is required`);
    return { isValid: false, errors };
  }
  
  // Skip validation if value is empty and not required
  if (value == null || value === '') {
    return { isValid: true, errors: [] };
  }
  
  // Type-specific validation
  switch (field.type) {
    case 'email':
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(value)) {
        errors.push(`${field.label} must be a valid email address`);
      }
      break;
      
    case 'url':
      try {
        new URL(value);
      } catch {
        errors.push(`${field.label} must be a valid URL`);
      }
      break;
      
    case 'number':
      if (isNaN(Number(value))) {
        errors.push(`${field.label} must be a number`);
      }
      break;
      
    case 'date':
      if (isNaN(Date.parse(value))) {
        errors.push(`${field.label} must be a valid date`);
      }
      break;
      
    case 'select':
    case 'multiselect':
      if (field.options) {
        const validValues = field.options.map(opt => opt.value);
        const valuesToCheck = Array.isArray(value) ? value : [value];
        const invalidValues = valuesToCheck.filter(v => !validValues.includes(v));
        if (invalidValues.length > 0) {
          errors.push(`${field.label} contains invalid options: ${invalidValues.join(', ')}`);
        }
      }
      break;
  }
  
  // Custom validation rules
  for (const rule of field.validation || []) {
    const ruleError = validateRule(value, rule, field.label);
    if (ruleError) {
      errors.push(ruleError);
    }
  }
  
  return { isValid: errors.length === 0, errors };
};

const validateRule = (value: any, rule: ValidationRule, fieldLabel: string): string | null => {
  const message = rule.message || `${fieldLabel} validation failed`;
  
  switch (rule.type) {
    case 'required':
      if (value == null || value === '') {
        return message;
      }
      break;
      
    case 'minLength':
      if (typeof value === 'string' && value.length < Number(rule.value)) {
        return message || `${fieldLabel} must be at least ${rule.value} characters`;
      }
      break;
      
    case 'maxLength':
      if (typeof value === 'string' && value.length > Number(rule.value)) {
        return message || `${fieldLabel} must be no more than ${rule.value} characters`;
      }
      break;
      
    case 'min':
      if (Number(value) < Number(rule.value)) {
        return message || `${fieldLabel} must be at least ${rule.value}`;
      }
      break;
      
    case 'max':
      if (Number(value) > Number(rule.value)) {
        return message || `${fieldLabel} must be no more than ${rule.value}`;
      }
      break;
      
    case 'pattern':
      if (typeof value === 'string' && typeof rule.value === 'string') {
        const regex = new RegExp(rule.value);
        if (!regex.test(value)) {
          return message || `${fieldLabel} format is invalid`;
        }
      }
      break;
      
    case 'email':
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (typeof value === 'string' && !emailRegex.test(value)) {
        return message || `${fieldLabel} must be a valid email address`;
      }
      break;
      
    case 'url':
      try {
        new URL(value);
      } catch {
        return message || `${fieldLabel} must be a valid URL`;
      }
      break;
  }
  
  return null;
};

// Schema transformation utilities
export const getFieldsByType = (schema: CardSchema, type: FieldType): FieldDefinition[] => {
  return schema.metadataFields.filter(field => field.type === type);
};

export const getRequiredFields = (schema: CardSchema): FieldDefinition[] => {
  return schema.metadataFields.filter(field => field.required);
};

export const getFieldsForFormSection = (schema: CardSchema, sectionId: string): FieldDefinition[] => {
  const section = schema.formLayout.sections.find(s => s.title === sectionId);
  if (!section) return [];
  
  return section.fields
    .map(fieldId => schema.metadataFields.find(f => f.id === fieldId))
    .filter(Boolean) as FieldDefinition[];
};

export const getFieldsForPanelDisplay = (schema: CardSchema): FieldDefinition[] => {
  return schema.metadataFields.filter(field => field.showInPanel !== false);
};

export const getFieldsForCardPreview = (schema: CardSchema): FieldDefinition[] => {
  return schema.metadataFields.filter(field => field.showInCard === true);
};

// Schema validation with detailed errors
export const validateCardData = (data: any, schema: CardSchema): { isValid: boolean; errors: Record<string, string[]> } => {
  const errors: Record<string, string[]> = {};
  
  // Validate core fields
  if (!data.title?.trim()) {
    errors.title = ['Title is required'];
  }
  
  if (!data.status?.trim()) {
    errors.status = ['Status is required'];
  }
  
  // Validate metadata fields
  for (const field of schema.metadataFields) {
    const value = data.metadata?.[field.id];
    const result = validateSchemaField(value, field);
    
    if (!result.isValid) {
      errors[field.id] = result.errors;
    }
  }
  
  const isValid = Object.keys(errors).length === 0;
  return { isValid, errors };
};

// Form field creation utilities
export const createFormField = (field: FieldDefinition, value: any): {
  id: string;
  label: string;
  type: string;
  value: any;
  placeholder?: string;
  options?: Array<{ label: string; value: string; color?: string }>;
  required: boolean;
  disabled: boolean;
  gridColumns: number;
  mobileColumns: number;
  validation: ValidationRule[];
} => {
  return {
    id: field.id,
    label: field.label,
    type: field.type,
    value: value ?? field.defaultValue,
    placeholder: field.placeholder,
    options: field.options,
    required: field.required,
    disabled: !field.editable,
    gridColumns: field.gridColumns,
    mobileColumns: field.mobileColumns,
    validation: field.validation,
  };
};

// Schema merging utilities
export const mergeSchemas = <T>(baseSchema: T, updates: Partial<T>): T => {
  return {
    ...baseSchema,
    ...updates,
  };
};

export const updateSchemaField = (schema: CardSchema, fieldId: string, updates: Partial<FieldDefinition>): CardSchema => {
  return {
    ...schema,
    metadataFields: schema.metadataFields.map(field =>
      field.id === fieldId ? { ...field, ...updates } : field
    ),
  };
};

export const addSchemaField = (schema: CardSchema, field: FieldDefinition): CardSchema => {
  return {
    ...schema,
    metadataFields: [...schema.metadataFields, field],
  };
};

export const removeSchemaField = (schema: CardSchema, fieldId: string): CardSchema => {
  return {
    ...schema,
    metadataFields: schema.metadataFields.filter(field => field.id !== fieldId),
  };
};

// Schema migration utilities
export const migrateSchema = <T>(schema: any, fromVersion: string, toVersion: string): T => {
  // Basic schema migration logic
  // In a real app, this would contain specific migration rules
  
  if (fromVersion === toVersion) {
    return schema;
  }
  
  // Add version update
  const migrated = {
    ...schema,
    version: toVersion,
  };
  
  // Add migration-specific transformations here
  // For example:
  // if (fromVersion === '1.0.0' && toVersion === '1.1.0') {
  //   migrated.newField = 'defaultValue';
  // }
  
  return migrated;
};

// Schema comparison utilities
export const compareSchemas = <T>(schema1: T, schema2: T): {
  isEqual: boolean;
  differences: Array<{
    path: string;
    type: 'added' | 'removed' | 'changed';
    oldValue?: any;
    newValue?: any;
  }>;
} => {
  // Simple deep comparison (in a real app, you might use a library like deep-diff)
  const isEqual = JSON.stringify(schema1) === JSON.stringify(schema2);
  
  if (isEqual) {
    return { isEqual: true, differences: [] };
  }
  
  // For now, return a simple difference indication
  // In a real app, you would implement detailed diff logic
  return {
    isEqual: false,
    differences: [{
      path: 'root',
      type: 'changed',
      oldValue: schema1,
      newValue: schema2,
    }],
  };
};

// Dynamic field value transformers
export const transformFieldValue = (value: any, field: FieldDefinition, direction: 'display' | 'storage'): any => {
  if (value == null) return value;
  
  switch (field.type) {
    case 'tags':
      if (direction === 'display') {
        return Array.isArray(value) ? value : value.split(',').map((s: string) => s.trim());
      } else {
        return Array.isArray(value) ? value.join(', ') : value;
      }
      
    case 'json':
      if (direction === 'display') {
        return typeof value === 'string' ? JSON.parse(value) : value;
      } else {
        return typeof value === 'object' ? JSON.stringify(value) : value;
      }
      
    case 'number':
      return direction === 'storage' ? Number(value) : value;
      
    case 'boolean':
      return direction === 'storage' ? Boolean(value) : value;
      
    case 'date':
      if (direction === 'display' && typeof value === 'string') {
        return new Date(value);
      } else if (direction === 'storage' && value instanceof Date) {
        return value.toISOString();
      }
      return value;
      
    default:
      return value;
  }
};

// Field option utilities
export const getFieldOptions = (field: FieldDefinition): Array<{ label: string; value: string; color?: string }> => {
  return field.options || [];
};

export const getFieldOptionByValue = (field: FieldDefinition, value: string): { label: string; value: string; color?: string } | undefined => {
  return field.options?.find(option => option.value === value);
};

export const addFieldOption = (field: FieldDefinition, option: { label: string; value: string; color?: string }): FieldDefinition => {
  return {
    ...field,
    options: [...(field.options || []), option],
  };
};

export const removeFieldOption = (field: FieldDefinition, value: string): FieldDefinition => {
  return {
    ...field,
    options: field.options?.filter(option => option.value !== value),
  };
};

// Schema generation utilities
export const generateFieldId = (label: string): string => {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/^[0-9]/, 'field$&') // Ensure it doesn't start with a number
    .substring(0, 50); // Limit length
};

export const createDefaultField = (type: FieldType, label: string): FieldDefinition => {
  return {
    id: generateFieldId(label),
    label,
    type,
    required: false,
    validation: [],
    gridColumns: 12,
    mobileColumns: 12,
    showInCard: false,
    showInPanel: true,
    editable: true,
    sortable: false,
    filterable: false,
  };
};