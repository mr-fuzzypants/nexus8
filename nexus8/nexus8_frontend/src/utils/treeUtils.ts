import type { KanbanCard } from '../schema';

/**
 * Tree node for flat rendering
 */
export interface TreeNode {
  id: string;
  parentId: string | null;
  level: number;
  hasChildren: boolean;
  data: KanbanCard;
}

/**
 * Build tree nodes from cards array
 */
export function buildTreeNodes(cards: KanbanCard[]): TreeNode[] {
  const nodes: TreeNode[] = [];
  const childrenMap = new Map<string, string[]>();

  // Build children map
  for (const card of cards) {
    const parentId = getParentIdFromPath(card.path);
    if (!childrenMap.has(parentId || 'root')) {
      childrenMap.set(parentId || 'root', []);
    }
    childrenMap.get(parentId || 'root')!.push(card.id);
  }

  // Build nodes with level info
  for (const card of cards) {
    const parentId = getParentIdFromPath(card.path);
    const level = card.path.split('/').length - 1;
    const hasChildren = childrenMap.has(card.id) && childrenMap.get(card.id)!.length > 0;

    nodes.push({
      id: card.id,
      parentId,
      level,
      hasChildren,
      data: card,
    });
  }

  return nodes;
}

/**
 * Extract parent ID from materialized path
 * Path format:
 *   'root' -> no parent (root level card)
 *   'root/parent_id' -> parent is the card with id 'parent_id'
 *   'root/grandparent_id/parent_id' -> parent is the card with id 'parent_id'
 */
function getParentIdFromPath(path: string): string | null {
  if (path === 'root') return null; // Root level cards have no parent
  
  const parts = path.split('/');
  // parts[0] is always 'root'
  // The last part is always a parent card's ID (not the current card's ID)
  // Because createChildCard does: childPath = `${parentCard.path}/${parentId}`
  
  // Return the last part (which is the parent's ID)
  return parts[parts.length - 1];
}

/**
 * Get visible rows based on expansion state, in tree order
 * Note: This preserves the order of nodes in the input array
 */
export function getVisibleRows(
  nodes: TreeNode[],
  expandedIds: Set<string>
): TreeNode[] {
  const visibleRows: TreeNode[] = [];
  const nodeMap = new Map(nodes.map(node => [node.id, node]));
  const childrenMap = new Map<string | null, TreeNode[]>();

  // Build children map - preserving order from nodes array
  for (const node of nodes) {
    const parentId = node.parentId;
    if (!childrenMap.has(parentId)) {
      childrenMap.set(parentId, []);
    }
    childrenMap.get(parentId)!.push(node);
  }

  // Recursively traverse tree in order
  function traverse(parentId: string | null) {
    const children = childrenMap.get(parentId);
    if (!children) return;

    // Children are already in the order from the nodes array
    for (const child of children) {
      // Add this node to visible rows
      visibleRows.push(child);
      
      // If this node is expanded, recursively add its children
      if (expandedIds.has(child.id) && child.hasChildren) {
        traverse(child.id);
      }
    }
  }

  // Start with root nodes (parentId === null)
  traverse(null);

  return visibleRows;
}

/**
 * Get value from object using dot notation path
 */
export function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}
