import type { KanbanCard, CardSchema, FieldDefinition } from '../schema';
import { PathUtils } from './pathUtils';

// Default path utils instance
const defaultPathUtils = new PathUtils({
  maxDepth: 10,
  pathSeparator: '/',
  rootPath: '/',
  pathCaseSensitive: false,
  allowedCharacters: 'a-zA-Z0-9-_',
  maxSegmentLength: 100,
  autoGeneratePath: true,
  pathFromTitle: true,
  slugify: true,
});

// Card creation and manipulation utilities
export class CardOperations {
  // Generate unique card ID
  static generateCardId(prefix = 'card'): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    return `${prefix}_${timestamp}_${random}`;
  }
  
  // Create new card with default values
  static createCard(
    data: Partial<KanbanCard> & { title: string },
    schema: CardSchema
  ): KanbanCard {
    const now = new Date().toISOString();
    
    // Apply default values from schema metadata fields
    const metadata: Record<string, any> = {};
    
    schema.metadataFields.forEach(field => {
      if (field.defaultValue !== undefined) {
        metadata[field.id] = field.defaultValue;
      }
    });
    
    // Override with provided data
    if (data.metadata) {
      Object.assign(metadata, data.metadata);
    }
    
    return {
      id: data.id || CardOperations.generateCardId(),
      title: data.title,
      description: data.description || '',
      status: data.status || 'backlog',
      parentId: data.parentId,
      children: data.children || [],
      imageUrl: data.imageUrl || metadata.imageUrl,
      metadata,
      createdAt: data.createdAt || now,
      updatedAt: data.updatedAt || now,
      path: data.path || defaultPathUtils.buildPath([]),
    };
  }
  
  // Clone card (with new ID)
  static cloneCard(
    card: KanbanCard,
    options: {
      includeChildren?: boolean;
      newTitle?: string;
      newStatus?: string;
      newParentId?: string;
    } = {}
  ): KanbanCard {
    const {
      includeChildren = false,
      newTitle,
      newStatus,
      newParentId,
    } = options;
    
    const now = new Date().toISOString();
    
    const clonedCard: KanbanCard = {
      ...card,
      id: CardOperations.generateCardId(),
      title: newTitle || `${card.title} (Copy)`,
      status: newStatus || card.status,
      parentId: newParentId || card.parentId,
      children: includeChildren ? [...(card.children || [])] : [],
      createdAt: now,
      updatedAt: now,
    };
    
    return clonedCard;
  }
  
  // Update card fields
  static updateCard(
    card: KanbanCard,
    updates: Partial<KanbanCard>
  ): KanbanCard {
    const now = new Date().toISOString();
    
    return {
      ...card,
      ...updates,
      updatedAt: now,
      metadata: {
        ...card.metadata,
        ...(updates.metadata || {}),
      },
    };
  }
  
  // Merge multiple cards (combining metadata, etc.)
  static mergeCards(cards: KanbanCard[], primaryCard?: KanbanCard): KanbanCard {
    if (cards.length === 0) {
      throw new Error('Cannot merge empty card array');
    }

    const primary = primaryCard || cards[0];
    const now = new Date().toISOString();
    
    // Merge metadata (later cards override earlier ones)
    const mergedMetadata: Record<string, any> = {};
    cards.forEach(card => {
      Object.assign(mergedMetadata, card.metadata);
    });
    
    // Merge children (unique)
    const allChildren = new Set<string>();
    cards.forEach(card => {
      (card.children || []).forEach(child => allChildren.add(child));
    });
    
    // Combine descriptions
    const descriptions = cards
      .filter(card => card.description.trim())
      .map(card => card.description);
    
    const mergedDescription = descriptions.length > 1
      ? descriptions.join('\n\n---\n\n')
      : descriptions[0] || primary.description;
    
    return {
      ...primary,
      description: mergedDescription,
      children: Array.from(allChildren),
      metadata: mergedMetadata,
      updatedAt: now,
    };
  }
  
  // Validate card against schema
  static validateCard(card: KanbanCard, schema: CardSchema): {
    isValid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    // Check required fields
    if (!card.title?.trim()) {
      errors.push('Title is required');
    }
    
    if (!card.id?.trim()) {
      errors.push('ID is required');
    }
    
    // Validate schema metadata fields
    schema.metadataFields.forEach(field => {
      const value = card.metadata?.[field.id];
      const validationResult = CardOperations.validateFieldValue(value, field);
      
      if (!validationResult.isValid) {
        if (field.required) {
          errors.push(`${field.label}: ${validationResult.error}`);
        } else {
          warnings.push(`${field.label}: ${validationResult.error}`);
        }
      }
    });
    
    // Check position is valid (if exists in metadata)
    const position = card.metadata?.position;
    if (position !== undefined && (typeof position !== 'number' || position < 0)) {
      errors.push('Position must be a non-negative number');
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }
  
  // Validate individual field value
  static validateFieldValue(value: any, field: FieldDefinition): {
    isValid: boolean;
    error?: string;
  } {
    // Check required
    if (field.required && (value === undefined || value === null || value === '')) {
      return {
        isValid: false,
        error: 'Field is required',
      };
    }
    
    // If not required and empty, it's valid
    if (!field.required && (value === undefined || value === null || value === '')) {
      return { isValid: true };
    }
    
    // Type-specific validation
    switch (field.type) {
      case 'text':
        if (typeof value !== 'string') {
          return { isValid: false, error: 'Must be text' };
        }
        // Check validation rules
        const minLengthRule = field.validation.find(rule => rule.type === 'minLength');
        const maxLengthRule = field.validation.find(rule => rule.type === 'maxLength');
        if (minLengthRule && value.length < Number(minLengthRule.value)) {
          return { isValid: false, error: `Must be at least ${minLengthRule.value} characters` };
        }
        if (maxLengthRule && value.length > Number(maxLengthRule.value)) {
          return { isValid: false, error: `Must be no more than ${maxLengthRule.value} characters` };
        }
        break;
        
      case 'number':
        if (typeof value !== 'number' || isNaN(value)) {
          return { isValid: false, error: 'Must be a number' };
        }
        const minRule = field.validation.find(rule => rule.type === 'min');
        const maxRule = field.validation.find(rule => rule.type === 'max');
        if (minRule && value < Number(minRule.value)) {
          return { isValid: false, error: `Must be at least ${minRule.value}` };
        }
        if (maxRule && value > Number(maxRule.value)) {
          return { isValid: false, error: `Must be no more than ${maxRule.value}` };
        }
        break;
        
      case 'boolean':
        if (typeof value !== 'boolean') {
          return { isValid: false, error: 'Must be true or false' };
        }
        break;
        
      case 'select':
        const selectOptions = field.options?.map(opt => opt.value) || [];
        if (!selectOptions.includes(value)) {
          return { isValid: false, error: `Must be one of: ${selectOptions.join(', ')}` };
        }
        break;
        
      case 'multiselect':
        if (!Array.isArray(value)) {
          return { isValid: false, error: 'Must be an array' };
        }
        const multiOptions = field.options?.map(opt => opt.value) || [];
        if (multiOptions.length > 0) {
          const invalidOptions = value.filter(v => !multiOptions.includes(v));
          if (invalidOptions.length > 0) {
            return { isValid: false, error: `Invalid options: ${invalidOptions.join(', ')}` };
          }
        }
        break;
        
      case 'date':
        if (!value || isNaN(new Date(value).getTime())) {
          return { isValid: false, error: 'Must be a valid date' };
        }
        break;
        
      default:
        // Unknown type, assume valid
        break;
    }
    
    return { isValid: true };
  }
  
  // Sort cards by various criteria
  static sortCards(
    cards: KanbanCard[],
    sortBy: 'title' | 'createdAt' | 'updatedAt' | 'metadata',
    direction: 'asc' | 'desc' = 'asc',
    metadataKey?: string
  ): KanbanCard[] {
    const sortedCards = [...cards];
    
    sortedCards.sort((a, b) => {
      let aValue: any;
      let bValue: any;
      
      switch (sortBy) {
        case 'title':
          aValue = a.title.toLowerCase();
          bValue = b.title.toLowerCase();
          break;
          
        case 'createdAt':
          aValue = new Date(a.createdAt).getTime();
          bValue = new Date(b.createdAt).getTime();
          break;
          
        case 'updatedAt':
          aValue = new Date(a.updatedAt).getTime();
          bValue = new Date(b.updatedAt).getTime();
          break;
          
        case 'metadata':
          if (!metadataKey) {
            throw new Error('metadataKey required for metadata sorting');
          }
          aValue = a.metadata?.[metadataKey];
          bValue = b.metadata?.[metadataKey];
          break;
          
        default:
          return 0;
      }
      
      // Handle undefined values
      if (aValue === undefined && bValue === undefined) return 0;
      if (aValue === undefined) return 1;
      if (bValue === undefined) return -1;
      
      // Compare values
      let comparison = 0;
      if (aValue < bValue) comparison = -1;
      else if (aValue > bValue) comparison = 1;
      
      return direction === 'asc' ? comparison : -comparison;
    });
    
    return sortedCards;
  }
  
  // Filter cards by various criteria
  static filterCards(
    cards: KanbanCard[],
    filters: {
      status?: string[];
      hasParent?: boolean;
      hasChildren?: boolean;
      createdAfter?: string;
      createdBefore?: string;
      updatedAfter?: string;
      updatedBefore?: string;
      metadata?: { [key: string]: any };
      search?: string;
    }
  ): KanbanCard[] {
    return cards.filter(card => {
      // Status filter
      if (filters.status && !filters.status.includes(card.status)) {
        return false;
      }
      
      // Parent filter
      if (filters.hasParent !== undefined) {
        const hasParent = !!card.parentId;
        if (hasParent !== filters.hasParent) return false;
      }
      
      // Children filter
      if (filters.hasChildren !== undefined) {
        const hasChildren = (card.children || []).length > 0;
        if (hasChildren !== filters.hasChildren) return false;
      }
      
      // Date filters
      if (filters.createdAfter) {
        const createdDate = new Date(card.createdAt);
        const afterDate = new Date(filters.createdAfter);
        if (createdDate <= afterDate) return false;
      }
      
      if (filters.createdBefore) {
        const createdDate = new Date(card.createdAt);
        const beforeDate = new Date(filters.createdBefore);
        if (createdDate >= beforeDate) return false;
      }
      
      if (filters.updatedAfter) {
        const updatedDate = new Date(card.updatedAt);
        const afterDate = new Date(filters.updatedAfter);
        if (updatedDate <= afterDate) return false;
      }
      
      if (filters.updatedBefore) {
        const updatedDate = new Date(card.updatedAt);
        const beforeDate = new Date(filters.updatedBefore);
        if (updatedDate >= beforeDate) return false;
      }
      
      // Metadata filters
      if (filters.metadata) {
        for (const [key, value] of Object.entries(filters.metadata)) {
          if (card.metadata?.[key] !== value) {
            return false;
          }
        }
      }
      
      // Search filter
      if (filters.search) {
        const searchTerm = filters.search.toLowerCase();
        const titleMatch = card.title.toLowerCase().includes(searchTerm);
        const descriptionMatch = card.description.toLowerCase().includes(searchTerm);
        const metadataMatch = Object.values(card.metadata || {}).some(value =>
          String(value).toLowerCase().includes(searchTerm)
        );
        
        if (!titleMatch && !descriptionMatch && !metadataMatch) {
          return false;
        }
      }
      
      return true;
    });
  }
  
  // Calculate card statistics
  static getCardStats(cards: KanbanCard[]): {
    total: number;
    byStatus: Record<string, number>;
    avgDescriptionLength: number;
    avgChildrenCount: number;
    oldestCard: KanbanCard | null;
    newestCard: KanbanCard | null;
    recentlyUpdated: KanbanCard[];
  } {
    if (cards.length === 0) {
      return {
        total: 0,
        byStatus: {},
        avgDescriptionLength: 0,
        avgChildrenCount: 0,
        oldestCard: null,
        newestCard: null,
        recentlyUpdated: [],
      };
    }
    
    // Status distribution
    const byStatus: Record<string, number> = {};
    cards.forEach(card => {
      byStatus[card.status] = (byStatus[card.status] || 0) + 1;
    });
    
    // Average description length
    const totalDescLength = cards.reduce((sum, card) => sum + card.description.length, 0);
    const avgDescriptionLength = totalDescLength / cards.length;
    
    // Average children count
    const totalChildren = cards.reduce((sum, card) => sum + (card.children || []).length, 0);
    const avgChildrenCount = totalChildren / cards.length;
    
    // Oldest and newest cards
    const sortedByCreated = [...cards].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    const oldestCard = sortedByCreated[0];
    const newestCard = sortedByCreated[sortedByCreated.length - 1];
    
    // Recently updated (last 7 days)
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const recentlyUpdated = cards.filter(card => 
      new Date(card.updatedAt) > weekAgo
    );
    
    return {
      total: cards.length,
      byStatus,
      avgDescriptionLength,
      avgChildrenCount,
      oldestCard,
      newestCard,
      recentlyUpdated,
    };
  }
  
  // Bulk operations
  static bulkUpdateCards(
    cards: KanbanCard[],
    updates: Partial<KanbanCard>
  ): KanbanCard[] {
    const now = new Date().toISOString();
    
    return cards.map(card => ({
      ...card,
      ...updates,
      updatedAt: now,
      metadata: {
        ...card.metadata,
        ...(updates.metadata || {}),
      },
    }));
  }
  
  // Export cards to various formats
  static exportCards(
    cards: KanbanCard[],
    format: 'json' | 'csv' | 'markdown'
  ): string {
    switch (format) {
      case 'json':
        return JSON.stringify(cards, null, 2);
        
      case 'csv':
        if (cards.length === 0) return '';
        
        const headers = ['ID', 'Title', 'Description', 'Status', 'Parent ID', 'Created At', 'Updated At'];
        const rows = cards.map(card => [
          card.id,
          card.title,
          card.description.replace(/\n/g, ' '),
          card.status,
          card.parentId || '',
          card.createdAt,
          card.updatedAt,
        ]);
        
        return [headers, ...rows]
          .map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(','))
          .join('\n');
        
      case 'markdown':
        if (cards.length === 0) return '# No Cards';
        
        return cards.map(card => {
          const metadata = Object.entries(card.metadata || {})
            .map(([key, value]) => `- **${key}**: ${value}`)
            .join('\n');
          
          return [
            `## ${card.title}`,
            `**Status**: ${card.status}`,
            card.parentId ? `**Parent**: ${card.parentId}` : '',
            (card.children || []).length > 0 ? `**Children**: ${(card.children || []).length}` : '',
            '',
            card.description,
            metadata ? '\n### Metadata\n' + metadata : '',
            `\n---\n`,
          ]
            .filter(Boolean)
            .join('\n');
        }).join('\n');
        
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
  }
}

// Export utility functions
export const cardOps = CardOperations;