import { useEffect } from 'react';
import { useKanbanViewStore } from '../state';

export const useScaleKeyboardShortcuts = () => {
  const { zoomIn, zoomOut, resetScale } = useKanbanViewStore(state => state.actions);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Check if the user is typing in an input field
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLElement && event.target.contentEditable === 'true'
      ) {
        return;
      }

      // Handle keyboard shortcuts
      if (event.ctrlKey || event.metaKey) {
        switch (event.code) {
          case 'Equal':
          case 'NumpadAdd':
            event.preventDefault();
            zoomIn();
            break;
          case 'Minus':
          case 'NumpadSubtract':
            event.preventDefault();
            zoomOut();
            break;
          case 'Digit0':
          case 'Numpad0':
            event.preventDefault();
            resetScale();
            break;
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [zoomIn, zoomOut, resetScale]);
};