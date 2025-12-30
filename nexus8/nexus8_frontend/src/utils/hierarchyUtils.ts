import type { KanbanCard } from '../schema';

// Tree node representation
export interface TreeNode {
  card: KanbanCard;
  children: TreeNode[];
  parent?: TreeNode;
  depth: number;
  path: string[];
}

// Hierarchy utilities
export class HierarchyUtils {
  // Build tree from flat card array
  static buildTree(cards: KanbanCard[]): TreeNode[] {
    const cardMap = new Map<string, KanbanCard>();
    const nodeMap = new Map<string, TreeNode>();
    const roots: TreeNode[] = [];
    
    // First pass: Create all nodes and map them
    cards.forEach(card => {
      cardMap.set(card.id, card);
      nodeMap.set(card.id, {
        card,
        children: [],
        depth: 0,
        path: [],
      });
    });
    
    // Second pass: Build parent-child relationships
    cards.forEach(card => {
      const node = nodeMap.get(card.id)!;
      
      if (card.parentId && nodeMap.has(card.parentId)) {
        const parentNode = nodeMap.get(card.parentId)!;
        node.parent = parentNode;
        parentNode.children.push(node);
        
        // Update depth and path
        node.depth = parentNode.depth + 1;
        node.path = [...parentNode.path, parentNode.card.id];
      } else {
        // Root node
        roots.push(node);
      }
    });
    
    // Sort children by title or custom order
    const sortChildren = (nodes: TreeNode[]) => {
      nodes.forEach(node => {
        node.children.sort((a, b) => a.card.title.localeCompare(b.card.title));
        sortChildren(node.children);
      });
    };
    
    sortChildren(roots);
    roots.sort((a, b) => a.card.title.localeCompare(b.card.title));
    
    return roots;
  }
  
  // Get all descendants of a card
  static getDescendants(cardId: string, cards: KanbanCard[]): KanbanCard[] {
    const descendants: KanbanCard[] = [];
    const visited = new Set<string>();
    
    const collectDescendants = (id: string) => {
      if (visited.has(id)) return; // Prevent infinite loops
      visited.add(id);
      
      cards.forEach(card => {
        if (card.parentId === id) {
          descendants.push(card);
          collectDescendants(card.id);
        }
      });
    };
    
    collectDescendants(cardId);
    return descendants;
  }
  
  // Get all ancestors of a card
  static getAncestors(cardId: string, cards: KanbanCard[]): KanbanCard[] {
    const ancestors: KanbanCard[] = [];
    const cardMap = new Map(cards.map(card => [card.id, card]));
    
    let currentCard = cardMap.get(cardId);
    
    while (currentCard?.parentId) {
      const parent = cardMap.get(currentCard.parentId);
      if (parent) {
        ancestors.unshift(parent); // Add to beginning for proper order
        currentCard = parent;
      } else {
        break;
      }
    }
    
    return ancestors;
  }
  
  // Get siblings of a card
  static getSiblings(cardId: string, cards: KanbanCard[], includeSelf = false): KanbanCard[] {
    const card = cards.find(c => c.id === cardId);
    if (!card) return [];
    
    const siblings = cards.filter(c => 
      c.parentId === card.parentId && (includeSelf || c.id !== cardId)
    );
    
    return siblings.sort((a, b) => a.title.localeCompare(b.title));
  }
  
  // Get children of a card
  static getChildren(cardId: string, cards: KanbanCard[]): KanbanCard[] {
    const children = cards.filter(card => card.parentId === cardId);
    return children.sort((a, b) => a.title.localeCompare(b.title));
  }
  
  // Get root cards (no parent)
  static getRootCards(cards: KanbanCard[]): KanbanCard[] {
    const roots = cards.filter(card => !card.parentId);
    return roots.sort((a, b) => a.title.localeCompare(b.title));
  }
  
  // Check if one card is ancestor of another
  static isAncestor(ancestorId: string, descendantId: string, cards: KanbanCard[]): boolean {
    if (ancestorId === descendantId) return false;
    
    const cardMap = new Map(cards.map(card => [card.id, card]));
    let current = cardMap.get(descendantId);
    
    while (current?.parentId) {
      if (current.parentId === ancestorId) {
        return true;
      }
      current = cardMap.get(current.parentId);
    }
    
    return false;
  }
  
  // Check if one card is descendant of another
  static isDescendant(descendantId: string, ancestorId: string, cards: KanbanCard[]): boolean {
    return HierarchyUtils.isAncestor(ancestorId, descendantId, cards);
  }
  
  // Get depth of a card in hierarchy
  static getDepth(cardId: string, cards: KanbanCard[]): number {
    const ancestors = HierarchyUtils.getAncestors(cardId, cards);
    return ancestors.length;
  }
  
  // Find common ancestor of multiple cards
  static findCommonAncestor(cardIds: string[], cards: KanbanCard[]): KanbanCard | null {
    if (cardIds.length === 0) return null;
    if (cardIds.length === 1) {
      const card = cards.find(c => c.id === cardIds[0]);
      return card || null;
    }
    
    // Get ancestor paths for all cards
    const ancestorPaths = cardIds.map(id => {
      const ancestors = HierarchyUtils.getAncestors(id, cards);
      return ancestors.map(a => a.id);
    });
    
    if (ancestorPaths.length === 0) return null;
    
    // Find common prefix
    const minLength = Math.min(...ancestorPaths.map(path => path.length));
    let commonAncestorId: string | null = null;
    
    for (let i = 0; i < minLength; i++) {
      const ancestorId = ancestorPaths[0][i];
      const isCommon = ancestorPaths.every(path => path[i] === ancestorId);
      
      if (isCommon) {
        commonAncestorId = ancestorId;
      } else {
        break;
      }
    }
    
    if (commonAncestorId) {
      return cards.find(c => c.id === commonAncestorId) || null;
    }
    
    return null;
  }
  
  // Flatten tree to array with depth information
  static flattenTree(roots: TreeNode[]): Array<{ card: KanbanCard; depth: number; hasChildren: boolean }> {
    const flattened: Array<{ card: KanbanCard; depth: number; hasChildren: boolean }> = [];
    
    const traverse = (nodes: TreeNode[]) => {
      nodes.forEach(node => {
        flattened.push({
          card: node.card,
          depth: node.depth,
          hasChildren: node.children.length > 0,
        });
        
        if (node.children.length > 0) {
          traverse(node.children);
        }
      });
    };
    
    traverse(roots);
    return flattened;
  }
  
  // Move card to new parent (maintaining hierarchy integrity)
  static moveCard(
    cardId: string, 
    newParentId: string | undefined, 
    cards: KanbanCard[]
  ): { 
    isValid: boolean; 
    error?: string; 
    updatedCards: KanbanCard[]; 
  } {
    const card = cards.find(c => c.id === cardId);
    if (!card) {
      return {
        isValid: false,
        error: 'Card not found',
        updatedCards: cards,
      };
    }
    
    // Check for circular reference
    if (newParentId && HierarchyUtils.isDescendant(newParentId, cardId, cards)) {
      return {
        isValid: false,
        error: 'Cannot move card to its own descendant',
        updatedCards: cards,
      };
    }
    
    // Check if new parent exists
    if (newParentId && !cards.find(c => c.id === newParentId)) {
      return {
        isValid: false,
        error: 'New parent not found',
        updatedCards: cards,
      };
    }
    
    // Update the card's parent
    const updatedCards = cards.map(c =>
      c.id === cardId
        ? { ...c, parentId: newParentId, updatedAt: new Date().toISOString() }
        : c
    );
    
    // Update children arrays in old and new parents
    const finalCards = updatedCards.map(c => {
      // Remove from old parent's children
      if (c.id === card.parentId && c.children) {
        return {
          ...c,
          children: c.children.filter(childId => childId !== cardId),
          updatedAt: new Date().toISOString(),
        };
      }
      
      // Add to new parent's children
      if (c.id === newParentId) {
        const children = c.children || [];
        if (!children.includes(cardId)) {
          return {
            ...c,
            children: [...children, cardId],
            updatedAt: new Date().toISOString(),
          };
        }
      }
      
      return c;
    });
    
    return {
      isValid: true,
      updatedCards: finalCards,
    };
  }
  
  // Get hierarchy statistics
  static getHierarchyStats(cards: KanbanCard[]): {
    totalCards: number;
    maxDepth: number;
    rootCards: number;
    leafCards: number;
    averageChildren: number;
  } {
    const roots = HierarchyUtils.getRootCards(cards);
    
    let maxDepth = 0;
    let leafCount = 0;
    let totalChildren = 0;
    let nodesWithChildren = 0;
    
    cards.forEach(card => {
      const depth = HierarchyUtils.getDepth(card.id, cards);
      maxDepth = Math.max(maxDepth, depth);
      
      const children = HierarchyUtils.getChildren(card.id, cards);
      if (children.length === 0) {
        leafCount++;
      } else {
        totalChildren += children.length;
        nodesWithChildren++;
      }
    });
    
    return {
      totalCards: cards.length,
      maxDepth,
      rootCards: roots.length,
      leafCards: leafCount,
      averageChildren: nodesWithChildren > 0 ? totalChildren / nodesWithChildren : 0,
    };
  }
  
  // Search within hierarchy
  static searchHierarchy(
    query: string, 
    cards: KanbanCard[], 
    options: {
      searchInTitle?: boolean;
      searchInDescription?: boolean;
      searchInMetadata?: boolean;
      caseSensitive?: boolean;
      includeAncestors?: boolean;
      includeDescendants?: boolean;
    } = {}
  ): KanbanCard[] {
    const {
      searchInTitle = true,
      searchInDescription = true,
      searchInMetadata = true,
      caseSensitive = false,
      includeAncestors = false,
      includeDescendants = false,
    } = options;
    
    const normalizedQuery = caseSensitive ? query : query.toLowerCase();
    const matches = new Set<string>();
    
    // Find direct matches
    cards.forEach(card => {
      let isMatch = false;
      
      if (searchInTitle) {
        const title = caseSensitive ? card.title : card.title.toLowerCase();
        if (title.includes(normalizedQuery)) {
          isMatch = true;
        }
      }
      
      if (searchInDescription && !isMatch) {
        const description = caseSensitive ? card.description : card.description.toLowerCase();
        if (description.includes(normalizedQuery)) {
          isMatch = true;
        }
      }
      
      if (searchInMetadata && !isMatch) {
        const metadataText = Object.values(card.metadata || {})
          .join(' ');
        const normalizedMetadata = caseSensitive ? metadataText : metadataText.toLowerCase();
        if (normalizedMetadata.includes(normalizedQuery)) {
          isMatch = true;
        }
      }
      
      if (isMatch) {
        matches.add(card.id);
        
        // Add ancestors if requested
        if (includeAncestors) {
          const ancestors = HierarchyUtils.getAncestors(card.id, cards);
          ancestors.forEach(ancestor => matches.add(ancestor.id));
        }
        
        // Add descendants if requested
        if (includeDescendants) {
          const descendants = HierarchyUtils.getDescendants(card.id, cards);
          descendants.forEach(descendant => matches.add(descendant.id));
        }
      }
    });
    
    return cards.filter(card => matches.has(card.id));
  }
  
  // Validate hierarchy integrity
  static validateHierarchy(cards: KanbanCard[]): {
    isValid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];
    const cardIds = new Set(cards.map(c => c.id));
    
    // Check for missing parents
    cards.forEach(card => {
      if (card.parentId && !cardIds.has(card.parentId)) {
        errors.push(`Card "${card.title}" references non-existent parent ID: ${card.parentId}`);
      }
    });
    
    // Check for circular references
    cards.forEach(card => {
      const visited = new Set<string>();
      let current: KanbanCard | undefined = card;
      
      while (current?.parentId) {
        if (visited.has(current.id)) {
          errors.push(`Circular reference detected involving card "${card.title}"`);
          break;
        }
        
        visited.add(current.id);
        current = cards.find(c => c.id === current!.parentId);
      }
    });
    
    // Check children array consistency
    cards.forEach(card => {
      if (card.children) {
        card.children.forEach(childId => {
          const child = cards.find(c => c.id === childId);
          if (!child) {
            errors.push(`Card "${card.title}" references non-existent child ID: ${childId}`);
          } else if (child.parentId !== card.id) {
            errors.push(`Inconsistent parent-child relationship: "${card.title}" claims "${child.title}" as child, but child doesn't reference it as parent`);
          }
        });
      }
    });
    
    return {
      isValid: errors.length === 0,
      errors,
    };
  }
}

// Export utility functions
export const hierarchyUtils = HierarchyUtils;