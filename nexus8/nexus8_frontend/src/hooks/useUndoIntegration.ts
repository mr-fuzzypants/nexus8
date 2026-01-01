import { useEffect } from 'react';
import { useUndoRedoStore } from '../state/useUndoRedo';
import { useDataStore } from '../state/useDataStore';
import type { UndoableAction } from '../state/useUndoRedo';
import type { KanbanCard } from '../schema';

/**
 * Hook to integrate undo/redo system with Kanban store
 * Listens for undo/redo actions and applies them to the state
 */
export const useUndoIntegration = () => {
  useEffect(() => {
    // Subscribe to undo/redo actions
    const unsubscribe = useUndoRedoStore.subscribe(
      (state) => ({ isUndoing: state.isUndoing, isRedoing: state.isRedoing }),
      ({ isUndoing, isRedoing }) => {
        if (isUndoing) {
          const state = useUndoRedoStore.getState();
          const action = state.redoStack[state.redoStack.length - 1]; // Action was just moved to redo stack
          if (action) {
            applyUndoAction(action);
          }
        } else if (isRedoing) {
          const state = useUndoRedoStore.getState();
          const action = state.undoStack[state.undoStack.length - 1]; // Action was just moved to undo stack
          if (action) {
            applyRedoAction(action);
          }
        }
      }
    );

    return unsubscribe;
  }, []);
};

/**
 * Apply an undo action (reverse the changes)
 */
const applyUndoAction = (action: UndoableAction) => {
  const dataStore = useDataStore.getState();
  const diff = action.diff;

  // Handle created cards - remove them on undo
  if (diff.created && diff.created.length > 0) {
    diff.created.forEach((created) => {
      dataStore.actions.deleteCard(created.id);
    });
  }

  // Handle deleted cards - restore them on undo
  if (diff.deleted && diff.deleted.length > 0) {
    diff.deleted.forEach((deleted) => {
      // Restore the deleted card
      useDataStore.setState((draft) => {
        draft.cards[deleted.id] = deleted.data;
        
        // Restore to card order
        const path = deleted.data.path || 'root';
        const status = deleted.data.status;
        
        if (!draft.cardOrder[path]) {
          draft.cardOrder[path] = {};
        }
        if (!draft.cardOrder[path][status]) {
          draft.cardOrder[path][status] = [];
        }
        if (!draft.cardOrder[path][status].includes(deleted.id)) {
          draft.cardOrder[path][status].push(deleted.id);
        }
        
        // Restore parent relationship
        if (deleted.data.parentId && draft.cards[deleted.data.parentId]) {
          if (!draft.cards[deleted.data.parentId].children) {
            draft.cards[deleted.data.parentId].children = [];
          }
          if (!draft.cards[deleted.data.parentId].children!.includes(deleted.id)) {
            draft.cards[deleted.data.parentId].children!.push(deleted.id);
          }
        }
      });
    });
  }

  // Handle card changes - reverse them
  if (diff.cardChanges) {
    Object.entries(diff.cardChanges).forEach(([cardId, changes]) => {
      const card = dataStore.cards[cardId];
      if (card) {
        const updates: Partial<KanbanCard> = {};
        
        changes.forEach((change) => {
          // Restore old value
          updates[change.field as keyof KanbanCard] = change.oldValue;
        });
        
        dataStore.actions.updateCard(cardId, updates);
      }
    });
  }

  // Handle order changes - reverse them
  if (diff.orderChanges) {
    diff.orderChanges.forEach((orderChange) => {
      if (orderChange.oldOrder && orderChange.status) {
        useDataStore.setState((draft) => {
          if (!draft.cardOrder[orderChange.path]) {
            draft.cardOrder[orderChange.path] = {};
          }
          draft.cardOrder[orderChange.path][orderChange.status!] = orderChange.oldOrder!;
        });
      } else if (orderChange.oldIndex !== undefined && orderChange.newIndex !== undefined && orderChange.status && action.cardIds?.[0]) {
         const cardId = action.cardIds[0];
         useDataStore.setState((draft) => {
            const list = draft.cardOrder[orderChange.path]?.[orderChange.status!];
            if (list) {
                const currentIndex = list.indexOf(cardId);
                if (currentIndex !== -1) {
                    list.splice(currentIndex, 1);
                    list.splice(orderChange.oldIndex!, 0, cardId);
                }
            }
         });
      }
    });
  }
};

/**
 * Apply a redo action (reapply the changes)
 */
const applyRedoAction = (action: UndoableAction) => {
  const dataStore = useDataStore.getState();
  const diff = action.diff;

  // Handle created cards - recreate them on redo
  if (diff.created && diff.created.length > 0) {
    diff.created.forEach((created) => {
      // Recreate the card
      useDataStore.setState((draft) => {
        draft.cards[created.id] = created.data as KanbanCard;
        
        // Add to card order
        const path = created.data.path || 'root';
        const status = created.data.status;
        
        if (!draft.cardOrder[path]) {
          draft.cardOrder[path] = {};
        }
        if (!draft.cardOrder[path][status]) {
          draft.cardOrder[path][status] = [];
        }
        if (!draft.cardOrder[path][status].includes(created.id)) {
          draft.cardOrder[path][status].push(created.id);
        }
        
        // Update parent if exists
        if (created.data.parentId && draft.cards[created.data.parentId]) {
          if (!draft.cards[created.data.parentId].children) {
            draft.cards[created.data.parentId].children = [];
          }
          if (!draft.cards[created.data.parentId].children!.includes(created.id)) {
            draft.cards[created.data.parentId].children!.push(created.id);
          }
        }
      });
    });
  }

  // Handle deleted cards - delete them again on redo
  if (diff.deleted && diff.deleted.length > 0) {
    diff.deleted.forEach((deleted) => {
      dataStore.actions.deleteCard(deleted.id);
    });
  }

  // Handle card changes - reapply them
  if (diff.cardChanges) {
    Object.entries(diff.cardChanges).forEach(([cardId, changes]) => {
      const card = dataStore.cards[cardId];
      if (card) {
        const updates: Partial<KanbanCard> = {};
        
        changes.forEach((change) => {
          // Apply new value
          updates[change.field as keyof KanbanCard] = change.newValue;
        });
        
        dataStore.actions.updateCard(cardId, updates);
      }
    });
  }

  // Handle order changes - reapply them
  if (diff.orderChanges) {
    diff.orderChanges.forEach((orderChange) => {
      if (orderChange.newOrder && orderChange.status) {
        useDataStore.setState((draft) => {
          if (!draft.cardOrder[orderChange.path]) {
            draft.cardOrder[orderChange.path] = {};
          }
          draft.cardOrder[orderChange.path][orderChange.status!] = orderChange.newOrder!;
        });
      } else if (orderChange.oldIndex !== undefined && orderChange.newIndex !== undefined && orderChange.status && action.cardIds?.[0]) {
         const cardId = action.cardIds[0];
         useDataStore.setState((draft) => {
            const list = draft.cardOrder[orderChange.path]?.[orderChange.status!];
            if (list) {
                const currentIndex = list.indexOf(cardId);
                if (currentIndex !== -1) {
                    list.splice(currentIndex, 1);
                    list.splice(orderChange.newIndex!, 0, cardId);
                }
            }
         });
      }
    });
  }
};
