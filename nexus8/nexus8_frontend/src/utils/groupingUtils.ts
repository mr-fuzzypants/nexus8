import type { KanbanCard } from '../schema';
import { getNestedValue } from './treeUtils';

/**
 * Group node representing a grouped row or group header
 */
export interface GroupNode {
  id: string;
  type: 'group' | 'row';
  level: number;
  groupValue?: string;
  groupField?: string;
  count?: number;
  children?: GroupNode[];
  card?: KanbanCard;
  isExpanded?: boolean;
}

/**
 * Build grouped tree structure from cards
 */
export function buildGroupedTree(
  cards: KanbanCard[],
  groupByFields: string[],
  expandedGroupIds: Set<string>
): GroupNode[] {
  if (groupByFields.length === 0) {
    // No grouping - return flat list
    return cards.map(card => ({
      id: card.id,
      type: 'row' as const,
      level: 0,
      card,
    }));
  }

  // Recursive function to build tree with grouping
  function buildLevel(
    items: KanbanCard[],
    fieldIndex: number,
    parentId: string = ''
  ): GroupNode[] {
    if (fieldIndex >= groupByFields.length) {
      // No more grouping levels - return rows
      return items.map(card => ({
        id: card.id,
        type: 'row' as const,
        level: fieldIndex,
        card,
      }));
    }

    const field = groupByFields[fieldIndex];
    const groups = new Map<string, KanbanCard[]>();

    // Group items by current field
    for (const item of items) {
      const value = getNestedValue(item, field);
      const key = value !== null && value !== undefined ? String(value) : '(empty)';
      
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(item);
    }

    // Build group nodes
    const result: GroupNode[] = [];
    const sortedKeys = Array.from(groups.keys()).sort();

    for (const key of sortedKeys) {
      const groupItems = groups.get(key)!;
      const groupId = `${parentId}_${field}_${key}`;
      const isExpanded = expandedGroupIds.has(groupId);

      const groupNode: GroupNode = {
        id: groupId,
        type: 'group',
        level: fieldIndex,
        groupValue: key,
        groupField: field,
        count: groupItems.length,
        isExpanded,
        children: buildLevel(groupItems, fieldIndex + 1, groupId),
      };

      result.push(groupNode);
    }

    return result;
  }

  return buildLevel(cards, 0);
}

/**
 * Flatten grouped tree to visible rows based on expansion state
 */
export function flattenGroupedTree(nodes: GroupNode[]): GroupNode[] {
  const result: GroupNode[] = [];

  function traverse(node: GroupNode) {
    result.push(node);

    if (node.type === 'group' && node.isExpanded && node.children) {
      for (const child of node.children) {
        traverse(child);
      }
    }
  }

  for (const node of nodes) {
    traverse(node);
  }

  return result;
}
