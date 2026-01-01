// Utility to clear Kanban store from localStorage
export const clearKanbanStore = () => {
  if (typeof window !== 'undefined') {
    // Clear legacy store
    localStorage.removeItem('kanban-store');
    // Clear new decoupled stores
    localStorage.removeItem('nexus8-data-store');
    localStorage.removeItem('nexus8-kanban-view-store');
    console.log('Kanban stores cleared from localStorage');
  }
};

// Utility to check current store values in localStorage  
export const debugKanbanStore = () => {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('kanban-store');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        console.log('Current localStorage kanban-store:', parsed);
        return parsed;
      } catch (e) {
        console.error('Failed to parse localStorage kanban-store:', e);
      }
    } else {
      console.log('No kanban-store found in localStorage');
    }
  }
  return null;
};