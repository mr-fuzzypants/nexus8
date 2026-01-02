import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type { KanbanCard } from '../schema';

// Action Types
export type UndoableActionType = 
  | 'CREATE_CARD'
  | 'UPDATE_CARD'
  | 'DELETE_CARD'
  | 'MOVE_CARD'
  | 'MOVE_CARD_TO_PATH'
  | 'BULK_UPDATE'
  | 'BULK_DELETE'
  | 'BULK_MOVE'
  | 'NAVIGATE'
  | 'FILTER_CHANGE'
  | 'SCHEMA_UPDATE'
  | 'ADD_COLUMN'
  | 'DELETE_COLUMN'
  | 'MOVE_COLUMN';

// State Diff - stores only what changed
export interface StateDiff {
  // Card field changes (stores only modified fields)
  cardChanges?: {
    [cardId: string]: Array<{
      field: string;
      oldValue: any;
      newValue: any;
    }>;
  },
     // Add schema changes specifically for columns
  columnChanges?: {
    added?: any[];   // Array of column definitions
    deleted?: any[]; // Array of column definitions
    moved?: {        // For reordering
      oldIndex: number;
      newIndex: number;
    };
  };
  // Card order changes
  orderChanges?: Array<{
    path: string;
    status?: string; // Added status to support per-status ordering
    oldIndex?: number;
    newIndex?: number;
    oldOrder?: string[];
    newOrder?: string[];
  }>;
  // Cards created (store minimal data)
  created?: Array<{
    id: string;
    data: Partial<KanbanCard>;
  }>;
  // Cards deleted (store for restoration)
  deleted?: Array<{
    id: string;
    data: KanbanCard;
  }>;
}

// Action Metadata (optimized)
export interface UndoableAction {
  id: string;
  type: UndoableActionType;
  timestamp: number;
  description: string;
  
  // Efficient state diff instead of full snapshots
  diff: StateDiff;
  
  // Additional context (minimal)
  cardIds?: string[];
  path?: string;
  metadata?: Record<string, any>;
  
  // Memory tracking
  estimatedSize?: number;
}

// Undo/Redo State
export interface UndoRedoState {
  undoStack: UndoableAction[];
  redoStack: UndoableAction[];
  maxStackSize: number;
  maxMemoryBytes: number;
  currentMemoryBytes: number;
  canUndo: boolean;
  canRedo: boolean;
  isUndoing: boolean;
  isRedoing: boolean;
  
  // Configuration
  enabledActions: Set<UndoableActionType>;
  groupingTimeWindow: number; // ms to group similar actions
  lastActionTime: number;
  
  // Performance metrics
  totalActionsRecorded: number;
  totalMemorySaved: number; // vs storing full snapshots
  
  // Actions
  recordAction: (action: Omit<UndoableAction, 'id' | 'timestamp' | 'estimatedSize'>) => void;
  undo: () => UndoableAction | null;
  redo: () => UndoableAction | null;
  clearHistory: () => void;
  setMaxStackSize: (size: number) => void;
  setMaxMemoryBytes: (bytes: number) => void;
  enableAction: (actionType: UndoableActionType) => void;
  disableAction: (actionType: UndoableActionType) => void;
  getUndoDescription: () => string | null;
  getRedoDescription: () => string | null;
  getHistory: () => UndoableAction[];
  canGroupWithPrevious: (actionType: UndoableActionType) => boolean;
  getMemoryUsage: () => { current: number; max: number; percentage: number };
  performCleanup: () => number; // Returns bytes freed
}

// Helper functions
const generateActionId = (): string => {
  return `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

// Estimate memory size of an action (rough approximation in bytes)
const estimateActionSize = (action: Partial<UndoableAction>): number => {
  const jsonString = JSON.stringify(action);
  return jsonString.length * 2; // UTF-16 characters = 2 bytes each
};

// Estimate size of a diff object
const estimateDiffSize = (diff: StateDiff): number => {
  let size = 0;
  
  if (diff.cardChanges) {
    size += Object.keys(diff.cardChanges).length * 50; // Key overhead
    Object.values(diff.cardChanges).forEach(changes => {
      size += changes.length * 100; // Rough estimate per change
    });
  }
  
  if (diff.orderChanges) {
    size += diff.orderChanges.length * 200;
  }
  
  if (diff.created) {
    size += diff.created.length * 500; // Rough card size
  }
  
  if (diff.deleted) {
    size += diff.deleted.length * 2000; // Full card size
  }
  
  return size;
};

// Create optimized diff from card changes
const createCardDiff = (
  cardId: string, 
  before: Partial<KanbanCard>, 
  after: Partial<KanbanCard>
): StateDiff => {
  const changes: Array<{ field: string; oldValue: any; newValue: any }> = [];
  
  const allFields = new Set([...Object.keys(before), ...Object.keys(after)]);
  
  allFields.forEach(field => {
    const oldValue = before[field as keyof KanbanCard];
    const newValue = after[field as keyof KanbanCard];
    
    // Only store if actually changed
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      changes.push({ field, oldValue, newValue });
    }
  });
  
  return changes.length > 0 ? {
    cardChanges: { [cardId]: changes }
  } : {};
};

// Merge diffs for grouping
const mergeDiffs = (diff1: StateDiff, diff2: StateDiff): StateDiff => {
  const merged: StateDiff = { ...diff1 };
  
  // Merge card changes
  if (diff2.cardChanges) {
    merged.cardChanges = merged.cardChanges || {};
    Object.entries(diff2.cardChanges).forEach(([cardId, changes]) => {
      if (merged.cardChanges![cardId]) {
        // Merge changes for the same card, keeping oldest 'before' and newest 'after'
        const existingChanges = merged.cardChanges![cardId];
        const mergedChanges = [...existingChanges];
        
        changes.forEach(newChange => {
          const existingIndex = mergedChanges.findIndex(c => c.field === newChange.field);
          if (existingIndex >= 0) {
            // Keep old value from existing, new value from new
            mergedChanges[existingIndex].newValue = newChange.newValue;
          } else {
            mergedChanges.push(newChange);
          }
        });
        
        merged.cardChanges![cardId] = mergedChanges;
      } else {
        merged.cardChanges![cardId] = changes;
      }
    });
  }
  
  // Merge other diff types
  if (diff2.orderChanges) {
    merged.orderChanges = [...(merged.orderChanges || []), ...diff2.orderChanges];
  }
  
  if (diff2.created) {
    merged.created = [...(merged.created || []), ...diff2.created];
  }
  
  if (diff2.deleted) {
    merged.deleted = [...(merged.deleted || []), ...diff2.deleted];
  }
  
  return merged;
};

const getActionDescription = (type: UndoableActionType, metadata?: Record<string, any>): string => {
  switch (type) {
    case 'CREATE_CARD':
      return `Create card: ${metadata?.title || 'Untitled'}`;
    case 'UPDATE_CARD':
      return `Update card: ${metadata?.title || 'Unknown'}`;
    case 'DELETE_CARD':
      return `Delete card: ${metadata?.title || 'Unknown'}`;
    case 'MOVE_CARD':
      return `Move card to ${metadata?.newStatus || 'Unknown status'}`;
    case 'MOVE_CARD_TO_PATH':
      return `Move card to ${metadata?.newPath || 'Unknown path'}`;
    case 'BULK_UPDATE':
      return `Update ${metadata?.count || 0} cards`;
    case 'BULK_DELETE':
      return `Delete ${metadata?.count || 0} cards`;
    case 'BULK_MOVE':
      return `Move ${metadata?.count || 0} cards`;
    case 'NAVIGATE':
      return `Navigate to ${metadata?.path || 'Unknown'}`;
    case 'FILTER_CHANGE':
      return `Change filters`;
    case 'SCHEMA_UPDATE':
      return `Update ${metadata?.schemaType || 'schema'}`;
    case 'ADD_COLUMN':
      // this might be return `Add column: ${metadata?.title}`;
      return `Add column: ${metadata?.columnName || 'Unknown'}`;
    case 'DELETE_COLUMN':
      return `Delete column: ${metadata?.columnName || 'Unknown'}`;
    default:
      return 'Unknown action';
  }
};

const shouldGroupActions = (
  currentType: UndoableActionType,
  previousType: UndoableActionType,
  timeDiff: number,
  groupingWindow: number
): boolean => {
  if (timeDiff > groupingWindow) return false;
  
  // Group consecutive updates to the same card
  if (currentType === 'UPDATE_CARD' && previousType === 'UPDATE_CARD') {
    return true;
  }
  
  // Group consecutive filter changes
  if (currentType === 'FILTER_CHANGE' && previousType === 'FILTER_CHANGE') {
    return true;
  }
  
  // Group consecutive navigation actions
  if (currentType === 'NAVIGATE' && previousType === 'NAVIGATE') {
    return true;
  }
  
  return false;
};

// Create the undo/redo store
export const useUndoRedoStore = create<UndoRedoState>()(
  subscribeWithSelector(
    immer((set, get) => ({
      undoStack: [],
      redoStack: [],
      maxStackSize: 50,
      maxMemoryBytes: 5 * 1024 * 1024, // 5MB default limit
      currentMemoryBytes: 0,
      canUndo: false,
      canRedo: false,
      isUndoing: false,
      isRedoing: false,
      
      totalActionsRecorded: 0,
      totalMemorySaved: 0,
      
      enabledActions: new Set([
        'CREATE_CARD',
        'UPDATE_CARD',
        'DELETE_CARD',
        'MOVE_CARD',
        'MOVE_CARD_TO_PATH',
        'BULK_UPDATE',
        'BULK_DELETE',
        'BULK_MOVE',
        'SCHEMA_UPDATE',
        'ADD_COLUMN',
        'DELETE_COLUMN',
        'MOVE_COLUMN',
      ]),
      
      groupingTimeWindow: 1000, // 1 second
      lastActionTime: 0,
      
      recordAction: (actionData) => {
        const state = get();
        
        // Don't record if action type is disabled
        if (!state.enabledActions.has(actionData.type)) {
          return;
        }
        
        // Don't record during undo/redo operations
        if (state.isUndoing || state.isRedoing) {
          return;
        }
        
        const now = Date.now();
        const timeDiff = now - state.lastActionTime;
        
        set((draft) => {
          // Estimate size of this action
          const estimatedSize = estimateDiffSize(actionData.diff);
          
          const action: UndoableAction = {
            ...actionData,
            id: generateActionId(),
            timestamp: now,
            description: actionData.description || getActionDescription(actionData.type, actionData.metadata),
            estimatedSize,
          };
          
          // Check if we should group with the previous action
          const shouldGroup = draft.undoStack.length > 0 && 
            shouldGroupActions(
              action.type, 
              draft.undoStack[draft.undoStack.length - 1].type,
              timeDiff,
              draft.groupingTimeWindow
            ) &&
            // Only group if it's the same card for card operations
            (actionData.cardIds?.[0] === draft.undoStack[draft.undoStack.length - 1].cardIds?.[0] ||
             !actionData.cardIds || !draft.undoStack[draft.undoStack.length - 1].cardIds);
          
          if (shouldGroup) {
            // Merge diffs instead of replacing
            const lastAction = draft.undoStack[draft.undoStack.length - 1];
            const oldSize = lastAction.estimatedSize || 0;
            
            lastAction.diff = mergeDiffs(lastAction.diff, action.diff);
            lastAction.timestamp = now;
            lastAction.estimatedSize = estimateDiffSize(lastAction.diff);
            
            // Update memory tracking
            draft.currentMemoryBytes = draft.currentMemoryBytes - oldSize + (lastAction.estimatedSize || 0);
          } else {
            // Check memory limit before adding
            if (draft.currentMemoryBytes + estimatedSize > draft.maxMemoryBytes) {
              // Perform cleanup to make room
              const freedBytes = get().performCleanup();
              console.log(`Undo system cleanup: freed ${(freedBytes / 1024).toFixed(2)}KB`);
            }
            
            // Add new action to undo stack
            draft.undoStack.push(action);
            draft.currentMemoryBytes += estimatedSize;
            
            // Limit stack size
            if (draft.undoStack.length > draft.maxStackSize) {
              const removed = draft.undoStack.shift();
              if (removed?.estimatedSize) {
                draft.currentMemoryBytes -= removed.estimatedSize;
              }
            }
          }
          
          // Clear redo stack when new action is recorded
          draft.redoStack.forEach(action => {
            if (action.estimatedSize) {
              draft.currentMemoryBytes -= action.estimatedSize;
            }
          });
          draft.redoStack = [];
          
          // Update computed properties
          draft.canUndo = draft.undoStack.length > 0;
          draft.canRedo = draft.redoStack.length > 0;
          draft.lastActionTime = now;
          draft.totalActionsRecorded++;
          
          // Track memory saved vs full snapshots (rough estimate)
          draft.totalMemorySaved += (2000 - estimatedSize); // Assume 2KB per full snapshot vs diff
        });
      },
      
      undo: () => {
        const state = get();
        if (state.undoStack.length === 0) return null;
        
        const action = state.undoStack[state.undoStack.length - 1];
        
        set((draft) => {
          draft.isUndoing = true;
          
          // Move action from undo to redo stack
          const undoAction = draft.undoStack.pop()!;
          draft.redoStack.push(undoAction);
          
          // Update computed properties
          draft.canUndo = draft.undoStack.length > 0;
          draft.canRedo = draft.redoStack.length > 0;
        });
        
        // Reset undoing flag after a brief delay
        setTimeout(() => {
          set((draft) => {
            draft.isUndoing = false;
          });
        }, 100);
        
        return action;
      },
      
      redo: () => {
        const state = get();
        if (state.redoStack.length === 0) return null;
        
        const action = state.redoStack[state.redoStack.length - 1];
        
        set((draft) => {
          draft.isRedoing = true;
          
          // Move action from redo to undo stack
          const redoAction = draft.redoStack.pop()!;
          draft.undoStack.push(redoAction);
          
          // Update computed properties
          draft.canUndo = draft.undoStack.length > 0;
          draft.canRedo = draft.redoStack.length > 0;
        });
        
        // Reset redoing flag after a brief delay
        setTimeout(() => {
          set((draft) => {
            draft.isRedoing = false;
          });
        }, 100);
        
        return action;
      },
      
      clearHistory: () => {
        set((draft) => {
          draft.undoStack = [];
          draft.redoStack = [];
          draft.canUndo = false;
          draft.canRedo = false;
        });
      },
      
      setMaxStackSize: (size) => {
        set((draft) => {
          draft.maxStackSize = Math.max(1, size);
          
          // Trim stacks if they exceed new size
          while (draft.undoStack.length > draft.maxStackSize) {
            const removed = draft.undoStack.shift();
            if (removed?.estimatedSize) {
              draft.currentMemoryBytes -= removed.estimatedSize;
            }
          }
          
          while (draft.redoStack.length > draft.maxStackSize) {
            const removed = draft.redoStack.shift();
            if (removed?.estimatedSize) {
              draft.currentMemoryBytes -= removed.estimatedSize;
            }
          }
          
          // Update computed properties
          draft.canUndo = draft.undoStack.length > 0;
          draft.canRedo = draft.redoStack.length > 0;
        });
      },
      
      setMaxMemoryBytes: (bytes) => {
        set((draft) => {
          draft.maxMemoryBytes = Math.max(100 * 1024, bytes); // Min 100KB
          
          // Cleanup if currently over limit
          if (draft.currentMemoryBytes > draft.maxMemoryBytes) {
            get().performCleanup();
          }
        });
      },
      
      getMemoryUsage: () => {
        const state = get();
        return {
          current: state.currentMemoryBytes,
          max: state.maxMemoryBytes,
          percentage: (state.currentMemoryBytes / state.maxMemoryBytes) * 100,
        };
      },
      
      performCleanup: () => {
        let freedBytes = 0;
        
        set((draft) => {
          // Remove oldest 30% of undo stack
          const removeCount = Math.ceil(draft.undoStack.length * 0.3);
          
          for (let i = 0; i < removeCount && draft.undoStack.length > 0; i++) {
            const removed = draft.undoStack.shift();
            if (removed?.estimatedSize) {
              freedBytes += removed.estimatedSize;
              draft.currentMemoryBytes -= removed.estimatedSize;
            }
          }
          
          // Clear redo stack if still over limit
          if (draft.currentMemoryBytes > draft.maxMemoryBytes * 0.8) {
            draft.redoStack.forEach(action => {
              if (action.estimatedSize) {
                freedBytes += action.estimatedSize;
                draft.currentMemoryBytes -= action.estimatedSize;
              }
            });
            draft.redoStack = [];
          }
          
          // Update computed properties
          draft.canUndo = draft.undoStack.length > 0;
          draft.canRedo = draft.redoStack.length > 0;
        });
        
        return freedBytes;
      },
      
      enableAction: (actionType) => {
        set((draft) => {
          draft.enabledActions.add(actionType);
        });
      },
      
      disableAction: (actionType) => {
        set((draft) => {
          draft.enabledActions.delete(actionType);
        });
      },
      
      getUndoDescription: () => {
        const state = get();
        const lastAction = state.undoStack[state.undoStack.length - 1];
        return lastAction ? lastAction.description : null;
      },
      
      getRedoDescription: () => {
        const state = get();
        const nextAction = state.redoStack[state.redoStack.length - 1];
        return nextAction ? nextAction.description : null;
      },
      
      getHistory: () => {
        const state = get();
        return [...state.undoStack].reverse(); // Most recent first
      },
      
      canGroupWithPrevious: (actionType) => {
        const state = get();
        if (state.undoStack.length === 0) return false;
        
        const timeDiff = Date.now() - state.lastActionTime;
        const lastActionType = state.undoStack[state.undoStack.length - 1].type;
        
        return shouldGroupActions(actionType, lastActionType, timeDiff, state.groupingTimeWindow);
      },
    }))
  )
);

// Hooks for specific functionality
export const useUndoRedo = () => {
  const canUndo = useUndoRedoStore(state => state.canUndo);
  const canRedo = useUndoRedoStore(state => state.canRedo);
  const undo = useUndoRedoStore(state => state.undo);
  const redo = useUndoRedoStore(state => state.redo);
  const undoDescription = useUndoRedoStore(state => state.getUndoDescription());
  const redoDescription = useUndoRedoStore(state => state.getRedoDescription());
  
  return {
    canUndo,
    canRedo,
    undo,
    redo,
    undoDescription,
    redoDescription,
  };
};

export const useUndoRedoActions = () => {
  return useUndoRedoStore(state => ({
    recordAction: state.recordAction,
    clearHistory: state.clearHistory,
    setMaxStackSize: state.setMaxStackSize,
    enableAction: state.enableAction,
    disableAction: state.disableAction,
  }));
};

export const useUndoRedoHistory = () => {
  return useUndoRedoStore(state => state.getHistory());
};

// Performance monitoring hook
export const useUndoRedoPerformance = () => {
  const memoryUsage = useUndoRedoStore(state => state.getMemoryUsage());
  const totalActionsRecorded = useUndoRedoStore(state => state.totalActionsRecorded);
  const totalMemorySaved = useUndoRedoStore(state => state.totalMemorySaved);
  const stackSize = useUndoRedoStore(state => state.undoStack.length + state.redoStack.length);
  
  return {
    memoryUsage,
    totalActionsRecorded,
    totalMemorySaved,
    stackSize,
    averageActionSize: stackSize > 0 ? memoryUsage.current / stackSize : 0,
    memoryEfficiency: totalMemorySaved > 0 
      ? ((totalMemorySaved / (totalMemorySaved + memoryUsage.current)) * 100).toFixed(1) + '%'
      : 'N/A',
  };
};

// Helper hook to create optimized action recorders
export const useActionRecorder = () => {
  const recordAction = useUndoRedoStore(state => state.recordAction);
  
  const createCardAction = (cardData: KanbanCard) => {
    recordAction({
      type: 'CREATE_CARD',
      description: `Create card: ${cardData.title}`,
      diff: {
        created: [{
          id: cardData.id,
          data: cardData,
        }],
      },
      cardIds: [cardData.id],
      metadata: { title: cardData.title },
    });
  };
  
  const updateCardAction = (beforeState: KanbanCard, afterState: KanbanCard) => {
    recordAction({
      type: 'UPDATE_CARD',
      description: `Update card: ${afterState.title}`,
      diff: createCardDiff(afterState.id, beforeState, afterState),
      cardIds: [afterState.id],
      metadata: { title: afterState.title },
    });
  };
  
  const deleteCardAction = (card: KanbanCard) => {
    recordAction({
      type: 'DELETE_CARD',
      description: `Delete card: ${card.title}`,
      diff: {
        deleted: [{
          id: card.id,
          data: card,
        }],
      },
      cardIds: [card.id],
      metadata: { title: card.title },
    });
  };
  
  const moveCardAction = (
    cardId: string, 
    beforeStatus: string, 
    afterStatus: string,
    beforeIndex: number,
    afterIndex: number,
    cardTitle?: string
  ) => {
    recordAction({
      type: 'MOVE_CARD',
      description: `Move card to ${afterStatus}`,
      diff: {
        cardChanges: {
          [cardId]: [{
            field: 'status',
            oldValue: beforeStatus,
            newValue: afterStatus,
          }],
        },
        orderChanges: [{
          path: beforeStatus,
          oldIndex: beforeIndex,
          newIndex: afterIndex,
        }],
      },
      cardIds: [cardId],
      metadata: { 
        title: cardTitle,
        oldStatus: beforeStatus, 
        newStatus: afterStatus 
      },
    });
  };
  
  const moveCardToPathAction = (
    cardId: string, 
    beforePath: string, 
    afterPath: string,
    cardTitle?: string
  ) => {
    recordAction({
      type: 'MOVE_CARD_TO_PATH',
      description: `Move card to ${afterPath}`,
      diff: {
        cardChanges: {
          [cardId]: [{
            field: 'path',
            oldValue: beforePath,
            newValue: afterPath,
          }],
        },
      },
      cardIds: [cardId],
      metadata: { 
        title: cardTitle,
        oldPath: beforePath, 
        newPath: afterPath 
      },
    });
  };
  
  const bulkUpdateAction = (updates: Array<{ id: string; before: KanbanCard; after: KanbanCard }>) => {
    const cardChanges: StateDiff['cardChanges'] = {};
    
    updates.forEach(({ id, before, after }) => {
      const diff = createCardDiff(id, before, after);
      if (diff.cardChanges) {
        Object.assign(cardChanges, diff.cardChanges);
      }
    });
    
    recordAction({
      type: 'BULK_UPDATE',
      description: `Update ${updates.length} cards`,
      diff: { cardChanges },
      cardIds: updates.map(u => u.id),
      metadata: { count: updates.length },
    });
  };
  
  const bulkDeleteAction = (cards: KanbanCard[]) => {
    recordAction({
      type: 'BULK_DELETE',
      description: `Delete ${cards.length} cards`,
      diff: {
        deleted: cards.map(card => ({
          id: card.id,
          data: card,
        })),
      },
      cardIds: cards.map(card => card.id),
      metadata: { count: cards.length },
    });
  };
  
  const bulkMoveAction = (
    cardIds: string[], 
    beforeStatus: string, 
    afterStatus: string
  ) => {
    const cardChanges: StateDiff['cardChanges'] = {};
    
    cardIds.forEach(cardId => {
      cardChanges[cardId] = [{
        field: 'status',
        oldValue: beforeStatus,
        newValue: afterStatus,
      }];
    });
    
    recordAction({
      type: 'BULK_MOVE',
      description: `Move ${cardIds.length} cards to ${afterStatus}`,
      diff: { cardChanges },
      cardIds,
      metadata: { 
        count: cardIds.length, 
        oldStatus: beforeStatus, 
        newStatus: afterStatus 
      },
    });
  };
  
  const navigateAction = (beforePath: string, afterPath: string) => {
    recordAction({
      type: 'NAVIGATE',
      description: `Navigate to ${afterPath}`,
      diff: {}, // Navigation doesn't change card state
      path: afterPath,
      metadata: { oldPath: beforePath, newPath: afterPath },
    });
  };
  
  const filterChangeAction = (beforeFilters: any, afterFilters: any) => {
    recordAction({
      type: 'FILTER_CHANGE',
      description: 'Change filters',
      diff: {}, // Filters are stored in metadata
      metadata: { before: beforeFilters, after: afterFilters },
    });
  };
  
  const schemaUpdateAction = (schemaType: string, beforeSchema: any, afterSchema: any) => {
    recordAction({
      type: 'SCHEMA_UPDATE',
      description: `Update ${schemaType} schema`,
      diff: {}, // Schema changes stored in metadata
      metadata: { 
        schemaType,
        before: beforeSchema,
        after: afterSchema,
      },
    });
  };
  
  return {
    createCardAction,
    updateCardAction,
    deleteCardAction,
    moveCardAction,
    moveCardToPathAction,
    bulkUpdateAction,
    bulkDeleteAction,
    bulkMoveAction,
    navigateAction,
    filterChangeAction,
    schemaUpdateAction,
  };
};