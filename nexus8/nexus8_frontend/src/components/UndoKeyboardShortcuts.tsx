import { useEffect } from 'react';
import { useUndoRedo } from '../state/useUndoRedo';

/**
 * Component that registers global keyboard shortcuts for undo/redo
 * - Ctrl+Z (Windows/Linux) or Cmd+Z (Mac): Undo
 * - Ctrl+Y or Ctrl+Shift+Z (Windows/Linux) or Cmd+Shift+Z (Mac): Redo
 */
export const UndoKeyboardShortcuts = () => {
  const { undo, redo, canUndo, canRedo } = useUndoRedo();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check for modifier key (Cmd on Mac, Ctrl on Windows/Linux)
      const isMac = navigator.platform.toUpperCase().includes('MAC');
      const modifier = isMac ? e.metaKey : e.ctrlKey;

      // Ignore if user is typing in an input/textarea
      const target = e.target as HTMLElement;
      const isInputField = 
        target.tagName === 'INPUT' || 
        target.tagName === 'TEXTAREA' || 
        target.contentEditable === 'true';

      if (isInputField) return;

      // Undo: Ctrl+Z or Cmd+Z (without Shift)
      if (modifier && e.key === 'z' && !e.shiftKey && canUndo) {
        e.preventDefault();
        undo();
        return;
      }

      // Redo: Ctrl+Y or Ctrl+Shift+Z or Cmd+Shift+Z
      if (modifier && ((e.key === 'y') || (e.key === 'z' && e.shiftKey)) && canRedo) {
        e.preventDefault();
        redo();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [undo, redo, canUndo, canRedo]);

  return null; // This component doesn't render anything
};
