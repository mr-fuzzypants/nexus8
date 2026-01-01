import { createWithEqualityFn } from 'zustand/traditional';
import { persist, subscribeWithSelector } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type {
  KanbanCard,
  CardSchema,
  KanbanSchema,
  InfoPanelSchema,
  NavigationSchema,
} from '../schema';
import { useUndoRedoStore } from './useUndoRedo';
import { 
  defaultCardSchema, 
  defaultKanbanSchema, 
  defaultInfoPanelSchema, 
  defaultNavigationSchema 
} from '../schema';

// Filter State
export interface FilterState {
  search: string;
  statusFilter: string[];
  assigneeFilter: string[];
  priorityFilter: string[];
  dateFilter: {
    field?: string;
    start?: string;
    end?: string;
  };
  metadataFilters: Record<string, any>;
  quickFilter?: string;
}

// Selection State
export interface SelectionState {
  selectedCardId?: string;
  selectedCardPath?: string;
  focusedColumnIndex: number;
  focusedCardIndex: number;
  multiSelection: string[];
}

// UI State
export interface UIState {
  currentPath: string;
  pathHistory: string[];
  currentHistoryIndex: number;
  
  // Panel state
  infoPanelOpen: boolean;
  infoPanelActiveTab: string;
  infoPanelWidth: number;
  
  // Theme
  colorScheme: 'light' | 'dark' | 'auto';
  
  // Layout
  isMobile: boolean;
  sidebarCollapsed: boolean;
  
  // Scale settings
  boardScale: number;
  cardScale: number;
  minScale: number;
  maxScale: number;
  
  // Modals
  cardEditorOpen: boolean;
  settingsModalOpen: boolean;
  searchModalOpen: boolean;
  
  // Debug settings
  showPerformanceMonitor: boolean;
  
  // Loading states
  loading: boolean;
  saving: boolean;
  loadingCardId?: string;
}

// Kanban Store State
export interface KanbanState {
  // Data
  cards: Record<string, KanbanCard>;
  cardOrder: Record<string, Record<string, string[]>>; // path -> status -> ordered card IDs
  
  // Schemas
  cardSchema: CardSchema;
  kanbanSchema: KanbanSchema;
  infoPanelSchema: InfoPanelSchema;
  navigationSchema: NavigationSchema;
  
  // UI State
  ui: UIState;
  
  // Selection & Focus
  selection: SelectionState;
  
  // Filters
  filters: FilterState;
  
  // Computed getters
  getCardsAtPath: (path: string) => KanbanCard[];
  getCardsByStatus: (path: string, status: string) => KanbanCard[];
  getCardsByAggregateStatus: (path: string, aggregateStatus: string) => KanbanCard[];
  getFilteredCards: (path: string) => KanbanCard[];
  getCardChildren: (cardId: string) => KanbanCard[];
  getCardParent: (cardId: string) => KanbanCard | undefined;
  getPathSegments: (path: string) => string[];
  getBreadcrumbItems: (path: string) => Array<{ label: string; path: string; icon?: string }>;
  
  // Actions
  actions: {
    // Card operations
    createCard: (card: Omit<KanbanCard, 'id' | 'createdAt' | 'updatedAt'>) => string;
    createChildCard: (parentId: string, card: Omit<KanbanCard, 'id' | 'createdAt' | 'updatedAt' | 'parentId' | 'path'>) => string;
    updateCard: (id: string, updates: Partial<KanbanCard>) => void;
    deleteCard: (id: string) => void;
    duplicateCard: (id: string) => string;
    moveCard: (cardId: string, newStatus: string, newIndex?: number) => void;
    moveCardToPath: (cardId: string, newPath: string) => void;
    
    // Navigation
    navigateToPath: (path: string) => void;
    navigateUp: () => void;
    navigateToCard: (cardId: string) => void;
    goBack: () => void;
    goForward: () => void;
    
    // Selection
    selectCard: (cardId: string) => void;
    clearSelection: () => void;
    selectMultiple: (cardIds: string[]) => void;
    focusCard: (columnIndex: number, cardIndex: number) => void;
    
    // Filters
    setSearch: (search: string) => void;
    setStatusFilter: (statuses: string[]) => void;
    setAssigneeFilter: (assignees: string[]) => void;
    setPriorityFilter: (priorities: string[]) => void;
    setDateFilter: (filter: FilterState['dateFilter']) => void;
    setMetadataFilter: (key: string, value: any) => void;
    setQuickFilter: (filterId?: string) => void;
    clearFilters: () => void;
    
    // UI
    toggleInfoPanel: () => void;
    setInfoPanelOpen: (open: boolean) => void;
    setInfoPanelTab: (tabId: string) => void;
    setInfoPanelWidth: (width: number) => void;
    setColorScheme: (scheme: 'light' | 'dark' | 'auto') => void;
    setMobile: (isMobile: boolean) => void;
    
    // Debug settings
    setShowPerformanceMonitor: (show: boolean) => void;
    
    // Scale controls
    setBoardScale: (scale: number) => void;
    setCardScale: (scale: number) => void;
    setScale: (boardScale: number, cardScale: number) => void;
    resetScale: () => void;
    zoomIn: () => void;
    zoomOut: () => void;
    
    // Modals
    openCardEditor: (cardId?: string) => void;
    closeCardEditor: () => void;
    openSettings: () => void;
    closeSettings: () => void;
    openSearch: () => void;
    closeSearch: () => void;
    
    // Schema updates
    updateCardSchema: (schema: CardSchema) => void;
    updateKanbanSchema: (schema: KanbanSchema) => void;
    updateInfoPanelSchema: (schema: InfoPanelSchema) => void;
    updateNavigationSchema: (schema: NavigationSchema) => void;
    
    // Bulk operations
    bulkUpdateCards: (updates: Array<{ id: string; updates: Partial<KanbanCard> }>) => void;
    bulkDeleteCards: (cardIds: string[]) => void;
    bulkMoveCards: (cardIds: string[], newStatus: string) => void;
    
    // Data management
    loadCards: (cards: KanbanCard[]) => void;
    exportData: () => { cards: KanbanCard[]; schemas: any };
    importData: (data: { cards: KanbanCard[]; schemas?: any }) => void;
    resetStore: () => void;
  };
}

// Helper functions for path management
const getParentPath = (path: string): string | null => {
  const segments = path.split('/').filter(Boolean);
  if (segments.length <= 1) return null;
  segments.pop();
  return segments.join('/') || 'root';
};

const generateCardId = (): string => {
  return `card_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

// Initial state
const initialUIState: UIState = {
  currentPath: 'root',
  pathHistory: ['root'],
  currentHistoryIndex: 0,
  infoPanelOpen: false,
  infoPanelActiveTab: 'details',
  infoPanelWidth: 350,
  colorScheme: 'auto',
  isMobile: false,
  sidebarCollapsed: false,
  boardScale: 1.0,
  cardScale: 1.0,
  minScale: 0.5,
  maxScale: 2.0,
  cardEditorOpen: false,
  settingsModalOpen: false,
  searchModalOpen: false,
  showPerformanceMonitor: false,
  loading: false,
  saving: false,
};

const initialSelectionState: SelectionState = {
  focusedColumnIndex: 0,
  focusedCardIndex: 0,
  multiSelection: [],
};

const initialFilterState: FilterState = {
  search: '',
  statusFilter: [],
  assigneeFilter: [],
  priorityFilter: [],
  dateFilter: {},
  metadataFilters: {},
};

// Create the store
export const useKanbanStore = createWithEqualityFn<KanbanState>()(
  persist(
    subscribeWithSelector(
      immer((set, get) => ({
        // Initial state
        cards: {},
        cardOrder: { root: {} },
        
        cardSchema: defaultCardSchema,
        kanbanSchema: defaultKanbanSchema,
        infoPanelSchema: defaultInfoPanelSchema,
        navigationSchema: defaultNavigationSchema,
        
        ui: initialUIState,
        selection: initialSelectionState,
        filters: initialFilterState,
        
        // Computed getters
        getCardsAtPath: (path: string) => {
          const state = get();
          const statusOrders = state.cardOrder[path] || {};
          const allCardIds = Object.values(statusOrders).flat();
          return allCardIds
            .map(id => state.cards[id])
            .filter(Boolean);
        },
        
        getCardsByStatus: (path: string, status: string) => {
          const state = get();
          const cardIds = state.cardOrder[path]?.[status] || [];
          return cardIds
            .map(id => state.cards[id])
            .filter(Boolean);
        },

        getCardsByAggregateStatus: (path: string, aggregateStatus: string) => {
          const state = get();
          // Find all statuses that map to this aggregate status, sorted by order
          const matchingStatuses = state.kanbanSchema.statuses
            .filter(s => s.aggregateStatus === aggregateStatus)
            .sort((a, b) => a.order - b.order)
            .map(s => s.id);
            
          // Collect all cards from these statuses
          const allCards: KanbanCard[] = [];
          matchingStatuses.forEach(statusId => {
             const cardIds = state.cardOrder[path]?.[statusId] || [];
             cardIds.forEach(id => {
               const card = state.cards[id];
               if (card) allCards.push(card);
             });
          });
          
          return allCards;
        },
        
        getFilteredCards: (path: string) => {
          const state = get();
          const cards = state.getCardsAtPath(path);
          const filters = state.filters;
          
          return cards.filter(card => {
            // Search filter
            if (filters.search) {
              const searchLower = filters.search.toLowerCase();
              const searchable = [
                card.title,
                card.description,
                ...Object.values(card.metadata || {}).map(String)
              ].join(' ').toLowerCase();
              
              if (!searchable.includes(searchLower)) {
                return false;
              }
            }
            
            // Status filter
            if (filters.statusFilter.length > 0 && !filters.statusFilter.includes(card.status)) {
              return false;
            }
            
            // Assignee filter
            if (filters.assigneeFilter.length > 0) {
              const assignee = card.metadata?.assignee;
              if (!assignee || !filters.assigneeFilter.includes(assignee)) {
                return false;
              }
            }
            
            // Priority filter
            if (filters.priorityFilter.length > 0) {
              const priority = card.metadata?.priority;
              if (!priority || !filters.priorityFilter.includes(priority)) {
                return false;
              }
            }
            
            // Date filter
            if (filters.dateFilter.field && (filters.dateFilter.start || filters.dateFilter.end)) {
              const dateValue = card.metadata?.[filters.dateFilter.field] || 
                              (filters.dateFilter.field === 'createdAt' ? card.createdAt : 
                               filters.dateFilter.field === 'updatedAt' ? card.updatedAt : null);
              
              if (dateValue) {
                const cardDate = new Date(dateValue);
                const startDate = filters.dateFilter.start ? new Date(filters.dateFilter.start) : null;
                const endDate = filters.dateFilter.end ? new Date(filters.dateFilter.end) : null;
                
                if (startDate && cardDate < startDate) return false;
                if (endDate && cardDate > endDate) return false;
              }
            }
            
            // Metadata filters
            for (const [key, value] of Object.entries(filters.metadataFilters)) {
              if (value != null && card.metadata?.[key] !== value) {
                return false;
              }
            }
            
            return true;
          });
        },
        
        getCardChildren: (cardId: string) => {
          const state = get();
          const card = state.cards[cardId];
          if (!card || !card.children) return [];
          
          return card.children
            .map(id => state.cards[id])
            .filter(Boolean);
        },
        
        getCardParent: (cardId: string) => {
          const state = get();
          const card = state.cards[cardId];
          if (!card || !card.parentId) return undefined;
          
          return state.cards[card.parentId];
        },
        
        getPathSegments: (path: string) => {
          return path.split('/').filter(Boolean);
        },
        
        getBreadcrumbItems: (path: string) => {
          const state = get();
          const segments = state.getPathSegments(path);
          const items = [];
          
          items.push({ label: 'Root', path: 'root' });
          
          let currentPath = 'root';
          for (const segment of segments) {
            if (segment !== 'root') {
              currentPath += `/${segment}`;
              
              // Try to find the card and use its title, otherwise use the segment
              const card = state.cards[segment];
              const label = card ? card.title : segment;
              
              items.push({ 
                label, 
                path: currentPath 
              });
            }
          }
          
          return items;
        },
        
        // Actions
        actions: {
          createCard: (cardData) => {
            const id = generateCardId();
            const now = new Date().toISOString();
            const state = get();
            
            const card: KanbanCard = {
              ...cardData,
              id,
              createdAt: now,
              updatedAt: now,
              path: cardData.path || state.ui.currentPath,
              metadata: cardData.metadata || {},
            };
            
            set((draft) => {
              draft.cards[id] = card;
              
              // Add to card order (per status)
              const path = card.path;
              if (!draft.cardOrder[path]) {
                draft.cardOrder[path] = {};
              }
              if (!draft.cardOrder[path][card.status]) {
                draft.cardOrder[path][card.status] = [];
              }
              draft.cardOrder[path][card.status].push(id);
              
              // Update parent if exists
              if (card.parentId && draft.cards[card.parentId]) {
                if (!draft.cards[card.parentId].children) {
                  draft.cards[card.parentId].children = [];
                }
                draft.cards[card.parentId].children!.push(id);
              }
            });
            
            // Record action for undo
            useUndoRedoStore.getState().recordAction({
              type: 'CREATE_CARD',
              description: `Create card: ${card.title}`,
              diff: {
                created: [{
                  id: card.id,
                  data: card,
                }],
              },
              cardIds: [card.id],
              metadata: { title: card.title },
            });
            
            return id;
          },

          createChildCard: (parentId, cardData) => {
            const state = get();
            const parentCard = state.cards[parentId];
            if (!parentCard) {
              throw new Error(`Parent card with id ${parentId} not found`);
            }

            // Create child card with parent's status and path + parent ID
            const childPath = `${parentCard.path}/${parentId}`;
            
            return state.actions.createCard({
              ...cardData,
              parentId,
              path: childPath,
              status: cardData.status || parentCard.status, // Inherit parent's status if not specified
            });
          },
          
          updateCard: (id, updates) => {
            const state = get();
            const beforeState = state.cards[id];
            
            if (!beforeState) return;
            
            // Create a copy of the before state
            const before = { ...beforeState };
            const statusChanged = updates.status && updates.status !== before.status;
            
            set((draft) => {
              if (draft.cards[id]) {
                Object.assign(draft.cards[id], {
                  ...updates,
                  updatedAt: new Date().toISOString(),
                });
                
                // If status changed, update cardOrder structure
                if (statusChanged && updates.status) {
                  const path = draft.cards[id].path;
                  const oldStatus = before.status;
                  const newStatus = updates.status;
                  
                  // Initialize structures if needed
                  if (!draft.cardOrder[path]) {
                    draft.cardOrder[path] = {};
                  }
                  if (!draft.cardOrder[path][oldStatus]) {
                    draft.cardOrder[path][oldStatus] = [];
                  }
                  if (!draft.cardOrder[path][newStatus]) {
                    draft.cardOrder[path][newStatus] = [];
                  }
                  
                  // Remove from old status array
                  draft.cardOrder[path][oldStatus] = draft.cardOrder[path][oldStatus].filter(cardId => cardId !== id);
                  
                  // Add to new status array
                  draft.cardOrder[path][newStatus].push(id);
                }
              }
            });
            
            // Get the after state
            const afterState = get().cards[id];
            if (!afterState) return;
            
            // Create diff - only store changed fields
            const changes: Array<{ field: string; oldValue: any; newValue: any }> = [];
            
            Object.keys(updates).forEach(field => {
              const oldValue = before[field as keyof KanbanCard];
              const newValue = afterState[field as keyof KanbanCard];
              
              // Only record if actually changed
              if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
                changes.push({ field, oldValue, newValue });
              }
            });
            
            // Only record if there were actual changes
            if (changes.length > 0) {
              useUndoRedoStore.getState().recordAction({
                type: 'UPDATE_CARD',
                description: `Update card: ${afterState.title}`,
                diff: {
                  cardChanges: {
                    [id]: changes,
                  },
                },
                cardIds: [id],
                metadata: { title: afterState.title },
              });
            }
          },
          
          deleteCard: (id) => {
            const state = get();
            const card = state.cards[id];
            if (!card) return;
            
            const path = card.path;
            const status = card.status;
            const oldOrder = state.cardOrder[path]?.[status] ? [...state.cardOrder[path][status]] : [];

            set((draft) => {
              const card = draft.cards[id];
              if (!card) return;
              
              // Remove from card order (per status)
              const path = card.path;
              if (draft.cardOrder[path]?.[card.status]) {
                draft.cardOrder[path][card.status] = draft.cardOrder[path][card.status].filter(cardId => cardId !== id);
              }
              
              // Remove from parent's children
              if (card.parentId && draft.cards[card.parentId]?.children) {
                draft.cards[card.parentId].children = draft.cards[card.parentId].children!.filter(childId => childId !== id);
              }
              
              // Delete children recursively
              if (card.children) {
                card.children.forEach(childId => {
                  // Recursively delete children
                  if (draft.cards[childId]) {
                    draft.actions.deleteCard(childId);
                  }
                });
              }
              
              // Remove from cards
              delete draft.cards[id];
              
              // Clear selection if deleted card was selected
              if (draft.selection.selectedCardId === id) {
                draft.selection.selectedCardId = undefined;
                draft.selection.selectedCardPath = undefined;
              }
            });
            
            // Record action
            const newState = get();
            const newOrder = newState.cardOrder[path]?.[status] || [];
            
            useUndoRedoStore.getState().recordAction({
              type: 'DELETE_CARD',
              description: `Delete card: ${card.title}`,
              diff: {
                deleted: [{
                  id: card.id,
                  data: card,
                }],
                orderChanges: [{
                  path,
                  status,
                  oldOrder,
                  newOrder
                }]
              },
              cardIds: [id],
              metadata: { title: card.title },
            });
          },
          
          duplicateCard: (id) => {
            const state = get();
            const originalCard = state.cards[id];
            if (!originalCard) return '';
            
            const duplicatedId = state.actions.createCard({
              ...originalCard,
              title: `${originalCard.title} (Copy)`,
              path: originalCard.path,
              parentId: originalCard.parentId,
              // Don't copy children - only duplicate this card
            });
            
            return duplicatedId;
          },
          
          moveCard: (cardId, newStatus, newIndex) => {
            const state = get();
            const card = state.cards[cardId];
            if (!card) return;
            
            const path = card.path;
            const oldStatus = card.status;
            
            // Capture state before change
            const oldOrderSource = state.cardOrder[path]?.[oldStatus] ? [...state.cardOrder[path][oldStatus]] : [];
            const oldOrderDest = oldStatus === newStatus ? oldOrderSource : (state.cardOrder[path]?.[newStatus] ? [...state.cardOrder[path][newStatus]] : []);

            set((draft) => {
              const card = draft.cards[cardId];
              if (!card) return;
              
              // Initialize structures if needed
              if (!draft.cardOrder[path]) {
                draft.cardOrder[path] = {};
              }
              if (!draft.cardOrder[path][oldStatus]) {
                draft.cardOrder[path][oldStatus] = [];
              }
              if (!draft.cardOrder[path][newStatus]) {
                draft.cardOrder[path][newStatus] = [];
              }
              
              // Remove from old status array
              draft.cardOrder[path][oldStatus] = draft.cardOrder[path][oldStatus].filter(id => id !== cardId);
              
              // Add to new status array at specified index (or end)
              if (newIndex !== undefined) {
                // Insert at specific position
                draft.cardOrder[path][newStatus].splice(newIndex, 0, cardId);
              } else {
                // Append to end
                draft.cardOrder[path][newStatus].push(cardId);
              }
              
              // Update card status
              card.status = newStatus;
              card.updatedAt = new Date().toISOString();
            });
            
            // Capture state after change
            const newState = get();
            const newOrderSource = newState.cardOrder[path]?.[oldStatus] || [];
            const newOrderDest = newState.cardOrder[path]?.[newStatus] || [];
            
            // Record action
            const orderChanges: any[] = [];
            
            if (oldStatus === newStatus) {
               // Reordering within same list
               orderChanges.push({
                 path,
                 status: oldStatus,
                 oldOrder: oldOrderSource,
                 newOrder: newOrderSource
               });
            } else {
               // Moving between lists
               orderChanges.push({
                 path,
                 status: oldStatus,
                 oldOrder: oldOrderSource,
                 newOrder: newOrderSource
               });
               orderChanges.push({
                 path,
                 status: newStatus,
                 oldOrder: oldOrderDest,
                 newOrder: newOrderDest
               });
            }
            
            useUndoRedoStore.getState().recordAction({
              type: 'MOVE_CARD',
              description: `Move card to ${newStatus}`,
              diff: {
                cardChanges: oldStatus !== newStatus ? {
                  [cardId]: [{ field: 'status', oldValue: oldStatus, newValue: newStatus }]
                } : undefined,
                orderChanges
              },
              cardIds: [cardId],
            });
          },
          
          moveCardToPath: (cardId, newPath) => {
            set((draft) => {
              const card = draft.cards[cardId];
              if (!card) return;
              
              const oldPath = card.path;
              
              // Remove from old path order (per status)
              if (draft.cardOrder[oldPath]?.[card.status]) {
                draft.cardOrder[oldPath][card.status] = draft.cardOrder[oldPath][card.status].filter(id => id !== cardId);
              }
              
              // Add to new path order (per status)
              if (!draft.cardOrder[newPath]) {
                draft.cardOrder[newPath] = {};
              }
              if (!draft.cardOrder[newPath][card.status]) {
                draft.cardOrder[newPath][card.status] = [];
              }
              draft.cardOrder[newPath][card.status].push(cardId);
              
              // Update card path
              card.path = newPath;
              card.updatedAt = new Date().toISOString();
              
              // Update all children paths recursively
              const updateChildrenPaths = (parentId: string) => {
                const parent = draft.cards[parentId];
                if (parent?.children) {
                  parent.children.forEach(childId => {
                    const child = draft.cards[childId];
                    if (child) {
                      const childNewPath = `${newPath}/${child.title.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
                      child.path = childNewPath;
                      updateChildrenPaths(childId);
                    }
                  });
                }
              };
              
              updateChildrenPaths(cardId);
            });
          },
          
          navigateToPath: (path) => {
            set((draft) => {
              draft.ui.currentPath = path;
              
              // Update history
              const currentIndex = draft.ui.currentHistoryIndex;
              draft.ui.pathHistory = draft.ui.pathHistory.slice(0, currentIndex + 1);
              draft.ui.pathHistory.push(path);
              draft.ui.currentHistoryIndex = draft.ui.pathHistory.length - 1;
              
              // Clear selection when navigating
              draft.selection.selectedCardId = undefined;
              draft.selection.selectedCardPath = undefined;
              draft.selection.focusedColumnIndex = 0;
              draft.selection.focusedCardIndex = 0;
            });
          },
          
          navigateUp: () => {
            const state = get();
            const parentPath = getParentPath(state.ui.currentPath);
            if (parentPath) {
              state.actions.navigateToPath(parentPath);
            }
          },
          
          navigateToCard: (cardId) => {
            const state = get();
            const card = state.cards[cardId];
            if (card) {
              state.actions.navigateToPath(card.path);
              state.actions.selectCard(cardId);
            }
          },
          
          goBack: () => {
            set((draft) => {
              if (draft.ui.currentHistoryIndex > 0) {
                draft.ui.currentHistoryIndex--;
                draft.ui.currentPath = draft.ui.pathHistory[draft.ui.currentHistoryIndex];
              }
            });
          },
          
          goForward: () => {
            set((draft) => {
              if (draft.ui.currentHistoryIndex < draft.ui.pathHistory.length - 1) {
                draft.ui.currentHistoryIndex++;
                draft.ui.currentPath = draft.ui.pathHistory[draft.ui.currentHistoryIndex];
              }
            });
          },
          
          selectCard: (cardId) => {
            set((draft) => {
              const card = draft.cards[cardId];
              if (card) {
                draft.selection.selectedCardId = cardId;
                draft.selection.selectedCardPath = card.path;
                
                // Auto-open info panel on selection
                if (draft.infoPanelSchema.behavior?.autoOpen) {
                  draft.ui.infoPanelOpen = true;
                }
                
                // Clear multi-selection
                draft.selection.multiSelection = [];
              }
            });
          },
          
          clearSelection: () => {
            set((draft) => {
              draft.selection.selectedCardId = undefined;
              draft.selection.selectedCardPath = undefined;
              draft.selection.multiSelection = [];
              
              // Auto-close info panel if configured
              if (draft.infoPanelSchema.behavior?.autoClose) {
                draft.ui.infoPanelOpen = false;
              }
            });
          },
          
          selectMultiple: (cardIds) => {
            set((draft) => {
              draft.selection.multiSelection = cardIds;
              // Clear single selection when multi-selecting
              if (cardIds.length > 1) {
                draft.selection.selectedCardId = undefined;
                draft.selection.selectedCardPath = undefined;
              }
            });
          },
          
          focusCard: (columnIndex, cardIndex) => {
            set((draft) => {
              draft.selection.focusedColumnIndex = columnIndex;
              draft.selection.focusedCardIndex = cardIndex;
            });
          },
          
          setSearch: (search) => {
            set((draft) => {
              draft.filters.search = search;
            });
          },
          
          setStatusFilter: (statuses) => {
            set((draft) => {
              draft.filters.statusFilter = statuses;
            });
          },
          
          setAssigneeFilter: (assignees) => {
            set((draft) => {
              draft.filters.assigneeFilter = assignees;
            });
          },
          
          setPriorityFilter: (priorities) => {
            set((draft) => {
              draft.filters.priorityFilter = priorities;
            });
          },
          
          setDateFilter: (filter) => {
            set((draft) => {
              draft.filters.dateFilter = filter;
            });
          },
          
          setMetadataFilter: (key, value) => {
            set((draft) => {
              if (value == null) {
                delete draft.filters.metadataFilters[key];
              } else {
                draft.filters.metadataFilters[key] = value;
              }
            });
          },
          
          setQuickFilter: (filterId) => {
            set((draft) => {
              draft.filters.quickFilter = filterId;
              
              // Apply quick filter settings
              if (filterId) {
                const quickFilter = draft.kanbanSchema.filters?.quickFilters.find(f => f.id === filterId);
                if (quickFilter) {
                  // Apply the filter criteria
                  Object.entries(quickFilter.filter).forEach(([key, value]) => {
                    draft.filters.metadataFilters[key] = value;
                  });
                }
              }
            });
          },
          
          clearFilters: () => {
            set((draft) => {
              draft.filters = { ...initialFilterState };
            });
          },
          
          toggleInfoPanel: () => {
            set((draft) => {
              draft.ui.infoPanelOpen = !draft.ui.infoPanelOpen;
            });
          },
          
          setInfoPanelOpen: (open) => {
            set((draft) => {
              draft.ui.infoPanelOpen = open;
            });
          },
          
          setInfoPanelTab: (tabId) => {
            set((draft) => {
              draft.ui.infoPanelActiveTab = tabId;
            });
          },
          
          setInfoPanelWidth: (width) => {
            set((draft) => {
              draft.ui.infoPanelWidth = Math.max(300, Math.min(600, width));
            });
          },
          
          setColorScheme: (scheme) => {
            set((draft) => {
              draft.ui.colorScheme = scheme;
            });
          },
          
          setMobile: (isMobile) => {
            set((draft) => {
              draft.ui.isMobile = isMobile;
            });
          },
          
          // Debug settings
          setShowPerformanceMonitor: (show) => {
            set((draft) => {
              draft.ui.showPerformanceMonitor = show;
            });
          },
          
          setBoardScale: (scale) => {
            set((draft) => {
              draft.ui.boardScale = Math.max(draft.ui.minScale, Math.min(draft.ui.maxScale, scale));
            });
          },
          
          setCardScale: (scale) => {
            set((draft) => {
              draft.ui.cardScale = Math.max(draft.ui.minScale, Math.min(draft.ui.maxScale, scale));
            });
          },
          
          setScale: (boardScale, cardScale) => {
            set((draft) => {
              draft.ui.boardScale = Math.max(draft.ui.minScale, Math.min(draft.ui.maxScale, boardScale));
              draft.ui.cardScale = Math.max(draft.ui.minScale, Math.min(draft.ui.maxScale, cardScale));
            });
          },
          
          resetScale: () => {
            set((draft) => {
              draft.ui.boardScale = 1.0;
              draft.ui.cardScale = 1.0;
            });
          },
          
          zoomIn: () => {
            set((draft) => {
              const increment = 0.1;
              draft.ui.boardScale = Math.min(draft.ui.maxScale, draft.ui.boardScale + increment);
              draft.ui.cardScale = Math.min(draft.ui.maxScale, draft.ui.cardScale + increment);
            });
          },
          
          zoomOut: () => {
            set((draft) => {
              const decrement = 0.1;
              draft.ui.boardScale = Math.max(draft.ui.minScale, draft.ui.boardScale - decrement);
              draft.ui.cardScale = Math.max(draft.ui.minScale, draft.ui.cardScale - decrement);
            });
          },
          
          openCardEditor: (cardId) => {
            set((draft) => {
              draft.ui.cardEditorOpen = true;
              if (cardId) {
                draft.selection.selectedCardId = cardId;
              }
            });
          },
          
          closeCardEditor: () => {
            set((draft) => {
              draft.ui.cardEditorOpen = false;
            });
          },
          
          openSettings: () => {
            set((draft) => {
              draft.ui.settingsModalOpen = true;
            });
          },
          
          closeSettings: () => {
            set((draft) => {
              draft.ui.settingsModalOpen = false;
            });
          },
          
          openSearch: () => {
            set((draft) => {
              draft.ui.searchModalOpen = true;
            });
          },
          
          closeSearch: () => {
            set((draft) => {
              draft.ui.searchModalOpen = false;
            });
          },
          
          updateCardSchema: (schema) => {
            set((draft) => {
              draft.cardSchema = schema;
            });
          },
          
          updateKanbanSchema: (schema) => {
            set((draft) => {
              draft.kanbanSchema = schema;
            });
          },
          
          updateInfoPanelSchema: (schema) => {
            set((draft) => {
              draft.infoPanelSchema = schema;
            });
          },
          
          updateNavigationSchema: (schema) => {
            set((draft) => {
              draft.navigationSchema = schema;
            });
          },
          
          bulkUpdateCards: (updates) => {
            set((draft) => {
              const now = new Date().toISOString();
              updates.forEach(({ id, updates: cardUpdates }) => {
                if (draft.cards[id]) {
                  Object.assign(draft.cards[id], {
                    ...cardUpdates,
                    updatedAt: now,
                  });
                }
              });
            });
          },
          
          bulkDeleteCards: (cardIds) => {
            const state = get();
            cardIds.forEach(id => {
              state.actions.deleteCard(id);
            });
          },
          
          bulkMoveCards: (cardIds, newStatus) => {
            const state = get();
            cardIds.forEach(id => {
              state.actions.moveCard(id, newStatus);
            });
          },
          
          loadCards: (cards) => {
            set((draft) => {
              // Clear existing data
              draft.cards = {};
              draft.cardOrder = { root: {} };
              
              // Build card order mapping (per status)
              const orderMap: Record<string, Record<string, string[]>> = {};
              
              cards.forEach(card => {
                draft.cards[card.id] = card;
                
                if (!orderMap[card.path]) {
                  orderMap[card.path] = {};
                }
                if (!orderMap[card.path][card.status]) {
                  orderMap[card.path][card.status] = [];
                }
                orderMap[card.path][card.status].push(card.id);
              });
              
              draft.cardOrder = orderMap;
            });
          },
          
          exportData: () => {
            const state = get();
            return {
              cards: Object.values(state.cards),
              schemas: {
                card: state.cardSchema,
                kanban: state.kanbanSchema,
                infoPanel: state.infoPanelSchema,
                navigation: state.navigationSchema,
              },
            };
          },
          
          importData: (data) => {
            set((draft) => {
              // Load cards
              if (data.cards) {
                draft.actions.loadCards(data.cards);
              }
              
              // Load schemas
              if (data.schemas) {
                if (data.schemas.card) draft.cardSchema = data.schemas.card;
                if (data.schemas.kanban) draft.kanbanSchema = data.schemas.kanban;
                if (data.schemas.infoPanel) draft.infoPanelSchema = data.schemas.infoPanel;
                if (data.schemas.navigation) draft.navigationSchema = data.schemas.navigation;
              }
            });
          },
          
          resetStore: () => {
            set({
              cards: {},
              cardOrder: { root: {} },
              cardSchema: defaultCardSchema,
              kanbanSchema: defaultKanbanSchema,
              infoPanelSchema: defaultInfoPanelSchema,
              navigationSchema: defaultNavigationSchema,
              ui: { ...initialUIState },
              selection: { ...initialSelectionState },
              filters: { ...initialFilterState },
            });
          },
        },
      }))
    ),
    {
      name: 'kanban-store',
      partialize: (state) => ({
        cards: state.cards,
        cardOrder: state.cardOrder,
        cardSchema: state.cardSchema,
        kanbanSchema: state.kanbanSchema,
        infoPanelSchema: state.infoPanelSchema,
        navigationSchema: state.navigationSchema,
        ui: {
          currentPath: state.ui.currentPath,
          pathHistory: state.ui.pathHistory,
          currentHistoryIndex: state.ui.currentHistoryIndex,
          infoPanelActiveTab: state.ui.infoPanelActiveTab,
          infoPanelWidth: state.ui.infoPanelWidth,
          colorScheme: state.ui.colorScheme,
          boardScale: state.ui.boardScale,
          cardScale: state.ui.cardScale,
          minScale: state.ui.minScale,
          maxScale: state.ui.maxScale,
        },
      }),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...(persistedState as object),
        actions: currentState.actions,
        // Also preserve getters if they are in state
        getCardsAtPath: currentState.getCardsAtPath,
        getCardsByStatus: currentState.getCardsByStatus,
        getCardsByAggregateStatus: currentState.getCardsByAggregateStatus,
        getFilteredCards: currentState.getFilteredCards,
        getCardChildren: currentState.getCardChildren,
        getCardParent: currentState.getCardParent,
        getPathSegments: currentState.getPathSegments,
        getBreadcrumbItems: currentState.getBreadcrumbItems,
      }),
      onRehydrateStorage: () => {
        return (state, error) => {
          if (error) {
            console.log('An error happened during hydration', error);
          } else if (state) {
            // Migrate old cardOrder structure if needed
            if (state.cardOrder) {
              // Check if any path has an array (old structure) instead of object (new structure)
              let needsMigration = false;
              for (const [path, value] of Object.entries(state.cardOrder)) {
                if (Array.isArray(value)) {
                  needsMigration = true;
                  break;
                }
              }
              
              if (needsMigration) {
                console.log('Migrating cardOrder from old structure to per-status structure');
                const newCardOrder: Record<string, Record<string, string[]>> = {};
                
                // For each path with an array of card IDs, group them by status
                for (const [path, cardIds] of Object.entries(state.cardOrder)) {
                  if (Array.isArray(cardIds)) {
                    newCardOrder[path] = {};
                    // Group cards by their status
                    cardIds.forEach((cardId: string) => {
                      const card = state.cards[cardId];
                      if (card) {
                        if (!newCardOrder[path][card.status]) {
                          newCardOrder[path][card.status] = [];
                        }
                        newCardOrder[path][card.status].push(cardId);
                      }
                    });
                  } else {
                    // Already in new format
                    newCardOrder[path] = value as Record<string, string[]>;
                  }
                }
                
                state.cardOrder = newCardOrder;
              }
            }
            
            // Ensure scale properties exist with defaults
            if (typeof state.ui.boardScale !== 'number' || isNaN(state.ui.boardScale)) {
              state.ui.boardScale = 1.0;
            }
            if (typeof state.ui.cardScale !== 'number' || isNaN(state.ui.cardScale)) {
              state.ui.cardScale = 1.0;
            }
            if (typeof state.ui.minScale !== 'number' || isNaN(state.ui.minScale)) {
              state.ui.minScale = 0.5;
            }
            if (typeof state.ui.maxScale !== 'number' || isNaN(state.ui.maxScale)) {
              state.ui.maxScale = 2.0;
            }
          }
        };
      },
    }
  )
);

// Selectors for common use cases
export const useKanbanCards = () => useKanbanStore(state => state.cards);
export const useCurrentPath = () => useKanbanStore(state => state.ui.currentPath);
export const useSelectedCard = () => useKanbanStore(state => {
  const selectedId = state.selection.selectedCardId;
  return selectedId ? state.cards[selectedId] : undefined;
});
export const useCardsAtCurrentPath = () => useKanbanStore(state => 
  state.getCardsAtPath(state.ui.currentPath)
);
export const useFilteredCardsAtCurrentPath = () => useKanbanStore(state => 
  state.getFilteredCards(state.ui.currentPath)
);
export const useKanbanActions = () => useKanbanStore(state => state.actions);
export const useKanbanSchemas = () => useKanbanStore(state => ({
  card: state.cardSchema,
  kanban: state.kanbanSchema,
  infoPanel: state.infoPanelSchema,
  navigation: state.navigationSchema,
}));
export const useKanbanUI = () => useKanbanStore(state => state.ui);
export const useKanbanSelection = () => useKanbanStore(state => state.selection);
export const useKanbanFilters = () => useKanbanStore(state => state.filters);