import { create } from 'zustand';
import { TreeTableSchema } from '../schema/treeTableSchema';

// Generic Tree Node Interface
export interface TreeNode<T = any> {
  id: string;
  data: T;
  children?: TreeNode<T>[];
  parentId?: string | null;
  isExpanded?: boolean;
  isSelected?: boolean;
  depth?: number; // Calculated depth
  
  // Grouping
  isGroup?: boolean;
  groupField?: string;
  groupValue?: any;
  groupCount?: number;
}

// Flattened Node for Virtualization
export interface FlatTreeNode<T = any> extends TreeNode<T> {
  depth: number;
  isVisible: boolean;
  hasChildren: boolean;
}

interface TreeGridState<T = any> {
  // Configuration
  schema: TreeTableSchema;
  
  // Data
  rawData: TreeNode<T>[];
  flatData: FlatTreeNode<T>[]; // Processed data for rendering
  
  // State
  expandedNodeIds: Set<string>;
  selectedNodeIds: Set<string>;
  sortConfig: { field: string; direction: 'asc' | 'desc' }[];
  filterConfig: Record<string, any>;
  columnWidths: Record<string, number>;
  columnVisibility: Record<string, boolean>;
  columnOrder: string[];
  groupBy: string[];
  
  // Editing
  editingCell: { nodeId: string; columnId: string } | null;

  // Actions
  setSchema: (schema: TreeTableSchema) => void;
  setData: (data: TreeNode<T>[]) => void;
  toggleNode: (nodeId: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
  selectNode: (nodeId: string, multiSelect?: boolean) => void;
  setSort: (field: string, direction: 'asc' | 'desc' | null, multi?: boolean) => void;
  setFilter: (field: string, value: any) => void;
  resizeColumn: (columnId: string, width: number) => void;
  toggleColumnVisibility: (columnId: string) => void;
  reorderColumns: (startIndex: number, endIndex: number) => void;
  
  // Grouping Actions
  addGroup: (field: string) => void;
  removeGroup: (field: string) => void;
  moveGroup: (fromIndex: number, toIndex: number) => void;

  // Editing Actions
  setEditingCell: (cell: { nodeId: string; columnId: string } | null) => void;
  updateNodeData: (nodeId: string, field: string, value: any) => void;
}

// Helper to sort tree
const sortTree = <T>(nodes: TreeNode<T>[], sortConfig: { field: string; direction: 'asc' | 'desc' }[]): TreeNode<T>[] => {
  if (!sortConfig || sortConfig.length === 0) return nodes;

  const sorted = [...nodes].sort((a, b) => {
    if (a.isGroup && b.isGroup) {
      // Check if the group field is in sortConfig
      const groupSort = sortConfig.find(s => s.field === a.groupField);
      if (groupSort) {
        const dir = groupSort.direction === 'asc' ? 1 : -1;
        if (a.groupValue < b.groupValue) return -1 * dir;
        if (a.groupValue > b.groupValue) return 1 * dir;
      }
      // Default sort for groups
      return String(a.groupValue).localeCompare(String(b.groupValue));
    } else if (!a.isGroup && !b.isGroup) {
      // Data nodes
      for (const sort of sortConfig) {
        const valA = (a.data as any)[sort.field];
        const valB = (b.data as any)[sort.field];
        const dir = sort.direction === 'asc' ? 1 : -1;
        
        if (valA < valB) return -1 * dir;
        if (valA > valB) return 1 * dir;
      }
    }
    return 0;
  });

  // Recurse
  for (const node of sorted) {
    if (node.children && node.children.length > 0) {
      node.children = sortTree(node.children, sortConfig);
    }
  }

  return sorted;
};

// Helper to group roots
const groupRoots = <T>(nodes: TreeNode<T>[], groupBy: string[], parentIdPrefix: string = 'group'): TreeNode<T>[] => {
  if (!groupBy || groupBy.length === 0) return nodes;

  const groupField = groupBy[0];
  const remainingGroups = groupBy.slice(1);
  
  const groups: Record<string, TreeNode<T>[]> = {};
  
  for (const node of nodes) {
    const value = (node.data as any)[groupField];
    const key = String(value); // Simple string conversion for key
    if (!groups[key]) groups[key] = [];
    groups[key].push(node);
  }
  
  const result: TreeNode<T>[] = [];
  
  for (const [key, groupNodes] of Object.entries(groups)) {
    const currentId = `${parentIdPrefix}-${groupField}-${key}`;
    
    // Recursively group the children
    const children = groupRoots(groupNodes, remainingGroups, currentId);
    
    // Create a group node
    const groupNode: TreeNode<T> = {
      id: currentId,
      data: { [groupField]: key } as any, // Partial data for the group column
      children: children,
      isExpanded: true, // Default to expanded for now, or check state?
      // Custom properties for group
      isGroup: true,
      groupField,
      groupValue: key,
      groupCount: groupNodes.length // Count of immediate items in this group (before recursive grouping)
    };
    result.push(groupNode);
  }
  
  return result;
};

// Helper to flatten tree
const flattenTree = <T>(
  nodes: TreeNode<T>[], 
  expandedIds: Set<string>, 
  depth = 0, 
  parentId: string | null = null
): FlatTreeNode<T>[] => {
  let result: FlatTreeNode<T>[] = [];
  
  for (const node of nodes) {
    const isExpanded = expandedIds.has(node.id);
    const hasChildren = !!node.children && node.children.length > 0;
    
    const flatNode: FlatTreeNode<T> = {
      ...node,
      parentId,
      depth,
      isExpanded,
      isVisible: true, // Top level or parent expanded
      hasChildren,
    };
    
    result.push(flatNode);
    
    if (hasChildren && isExpanded) {
      result = [
        ...result,
        ...flattenTree(node.children!, expandedIds, depth + 1, node.id)
      ];
    }
  }
  
  return result;
};

// Helper to update node in tree
const updateNodeInTree = <T>(nodes: TreeNode<T>[], nodeId: string, field: string, value: any): TreeNode<T>[] => {
  return nodes.map(node => {
    if (node.id === nodeId) {
      return { ...node, data: { ...node.data, [field]: value } };
    }
    if (node.children) {
      return { ...node, children: updateNodeInTree(node.children, nodeId, field, value) };
    }
    return node;
  });
};

export const useTreeGridStore = create<TreeGridState>((set, get) => ({
  // Initial State
  schema: {
    version: '1.0.0',
    id: 'init',
    columns: [],
    options: {},
  } as any, // Placeholder, should be initialized
  rawData: [],
  flatData: [],
  expandedNodeIds: new Set(),
  selectedNodeIds: new Set(),
  sortConfig: [],
  filterConfig: {},
  columnWidths: {},
  columnVisibility: {},
  columnOrder: [],
  groupBy: [],
  editingCell: null,
  
  // Actions
  setSchema: (schema) => {
    const columnOrder = schema.columns.map(c => c.id);
    const columnWidths = schema.columns.reduce((acc, col) => {
      acc[col.id] = col.width || col.minWidth || 100;
      return acc;
    }, {} as Record<string, number>);
    
    const columnVisibility = schema.columns.reduce((acc, col) => {
      acc[col.id] = col.visible !== false;
      return acc;
    }, {} as Record<string, boolean>);
    
    const groupBy = schema.options?.initialGroupBy || [];
    
    set({ 
      schema, 
      columnOrder, 
      columnWidths,
      columnVisibility,
      groupBy
    });
  },
  
  setData: (data) => {
    const { expandedNodeIds, groupBy, sortConfig } = get();
    const groupedData = groupRoots(data, groupBy);
    const sortedData = sortTree(groupedData, sortConfig);
    const flatData = flattenTree(sortedData, expandedNodeIds);
    set({ rawData: data, flatData });
  },
  
  toggleNode: (nodeId) => {
    const { expandedNodeIds, rawData, groupBy, sortConfig } = get();
    const newExpanded = new Set(expandedNodeIds);
    
    if (newExpanded.has(nodeId)) {
      newExpanded.delete(nodeId);
    } else {
      newExpanded.add(nodeId);
    }
    
    const groupedData = groupRoots(rawData, groupBy);
    const sortedData = sortTree(groupedData, sortConfig);
    const flatData = flattenTree(sortedData, newExpanded);
    set({ expandedNodeIds: newExpanded, flatData });
  },
  
  expandAll: () => {
    // This is a simplified version. For real expand all, we'd need to traverse all nodes to get IDs
    // Or change logic to support 'all' flag
    // For now, let's just implement a basic recursive collector
    const { rawData, groupBy, sortConfig } = get();
    const groupedData = groupRoots(rawData, groupBy);
    const sortedData = sortTree(groupedData, sortConfig);
    
    const collectIds = (nodes: TreeNode[]): string[] => {
      let ids: string[] = [];
      for (const node of nodes) {
        if (node.children && node.children.length > 0) {
          ids.push(node.id);
          ids = [...ids, ...collectIds(node.children)];
        }
      }
      return ids;
    };
    
    const allIds = collectIds(sortedData);
    const newExpanded = new Set(allIds);
    const flatData = flattenTree(sortedData, newExpanded);
    
    set({ expandedNodeIds: newExpanded, flatData });
  },

  collapseAll: () => {
    const { rawData, groupBy, sortConfig } = get();
    const groupedData = groupRoots(rawData, groupBy);
    const sortedData = sortTree(groupedData, sortConfig);
    const newExpanded = new Set<string>();
    const flatData = flattenTree(sortedData, newExpanded);
    set({ expandedNodeIds: newExpanded, flatData });
  },  selectNode: (nodeId, multiSelect = false) => {
    const { selectedNodeIds } = get();
    let newSelected = new Set(multiSelect ? selectedNodeIds : []);
    
    if (multiSelect && newSelected.has(nodeId)) {
      newSelected.delete(nodeId);
    } else {
      newSelected.add(nodeId);
    }
    
    set({ selectedNodeIds: newSelected });
  },
  
  setSort: (field, direction, multi = false) => {
    const { rawData, groupBy, expandedNodeIds, sortConfig } = get();
    let newSortConfig = [...(sortConfig || [])];

    if (!direction) {
      // Remove from sort
      newSortConfig = newSortConfig.filter(s => s.field !== field);
    } else {
      const existingIndex = newSortConfig.findIndex(s => s.field === field);
      
      if (multi) {
        if (existingIndex >= 0) {
          newSortConfig[existingIndex] = { field, direction };
        } else {
          newSortConfig.push({ field, direction });
        }
      } else {
        newSortConfig = [{ field, direction }];
      }
    }

    const groupedData = groupRoots(rawData, groupBy);
    const sortedData = sortTree(groupedData, newSortConfig);
    const flatData = flattenTree(sortedData, expandedNodeIds);
    
    set({ sortConfig: newSortConfig, flatData });
  },
  
  setFilter: (field, value) => {
    const { filterConfig } = get();
    set({ filterConfig: { ...filterConfig, [field]: value } });
    // TODO: Implement actual filtering logic
  },
  
  resizeColumn: (columnId, width) => {
    const { columnWidths } = get();
    set({ columnWidths: { ...columnWidths, [columnId]: width } });
  },
  
  toggleColumnVisibility: (columnId) => {
    const { columnVisibility } = get();
    set({ columnVisibility: { ...columnVisibility, [columnId]: !columnVisibility[columnId] } });
  },

  reorderColumns: (startIndex, endIndex) => {
    const { columnOrder } = get();
    const newOrder = [...columnOrder];
    const [removed] = newOrder.splice(startIndex, 1);
    newOrder.splice(endIndex, 0, removed);
    set({ columnOrder: newOrder });
  },

  addGroup: (field) => {
    const { groupBy, rawData, expandedNodeIds, sortConfig } = get();
    if (groupBy.includes(field)) return;
    
    const newGroupBy = [...groupBy, field];
    const groupedData = groupRoots(rawData, newGroupBy);
    const sortedData = sortTree(groupedData, sortConfig);
    const flatData = flattenTree(sortedData, expandedNodeIds);
    
    set({ groupBy: newGroupBy, flatData });
  },

  removeGroup: (field) => {
    const { groupBy, rawData, expandedNodeIds, sortConfig } = get();
    const newGroupBy = groupBy.filter(g => g !== field);
    
    const groupedData = groupRoots(rawData, newGroupBy);
    const sortedData = sortTree(groupedData, sortConfig);
    const flatData = flattenTree(sortedData, expandedNodeIds);
    
    set({ groupBy: newGroupBy, flatData });
  },

  moveGroup: (fromIndex, toIndex) => {
    const { groupBy, rawData, expandedNodeIds, sortConfig } = get();
    const newGroupBy = [...groupBy];
    const [removed] = newGroupBy.splice(fromIndex, 1);
    newGroupBy.splice(toIndex, 0, removed);
    
    const groupedData = groupRoots(rawData, newGroupBy);
    const sortedData = sortTree(groupedData, sortConfig);
    const flatData = flattenTree(sortedData, expandedNodeIds);
    
    set({ groupBy: newGroupBy, flatData });
  },

  setEditingCell: (cell) => set({ editingCell: cell }),

  updateNodeData: (nodeId, field, value) => {
    const { rawData, groupBy, expandedNodeIds, sortConfig } = get();
    
    const newRawData = updateNodeInTree(rawData, nodeId, field, value);
    
    // Re-process data
    const groupedData = groupRoots(newRawData, groupBy);
    const sortedData = sortTree(groupedData, sortConfig);
    const flatData = flattenTree(sortedData, expandedNodeIds);
    
    set({ rawData: newRawData, flatData });
  },
}));
