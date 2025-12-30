import type { KeyboardShortcut } from '../schema';

// Keyboard event handling utilities
export class KeyboardUtils {
  private shortcuts: Map<string, KeyboardShortcut> = new Map();
  private listeners: Map<string, (event: KeyboardEvent) => void> = new Map();
  
  constructor(shortcuts: KeyboardShortcut[] = []) {
    this.setShortcuts(shortcuts);
  }
  
  // Set keyboard shortcuts
  setShortcuts(shortcuts: KeyboardShortcut[]): void {
    this.shortcuts.clear();
    shortcuts.forEach(shortcut => {
      this.shortcuts.set(shortcut.id, shortcut);
    });
  }
  
  // Add a keyboard shortcut
  addShortcut(shortcut: KeyboardShortcut): void {
    this.shortcuts.set(shortcut.id, shortcut);
  }
  
  // Remove a keyboard shortcut
  removeShortcut(id: string): void {
    this.shortcuts.delete(id);
    this.removeListener(id);
  }
  
  // Check if a key combination matches a shortcut
  static matchesShortcut(event: KeyboardEvent, shortcut: KeyboardShortcut): boolean {
    // For shortcuts with multiple keys, we need to handle them differently
    // For now, we'll handle simple combinations
    if (shortcut.keys.length === 0) return false;
    
    // Handle single key shortcuts
    if (shortcut.keys.length === 1) {
      const key = shortcut.keys[0].toLowerCase();
      return event.key.toLowerCase() === key || event.code.toLowerCase() === key;
    }
    
    // Handle modifier + key combinations
    const hasCtrl = shortcut.keys.some(k => ['control', 'ctrl', 'meta', 'cmd'].includes(k.toLowerCase()));
    const hasAlt = shortcut.keys.some(k => ['alt'].includes(k.toLowerCase()));
    const hasShift = shortcut.keys.some(k => ['shift'].includes(k.toLowerCase()));
    const mainKey = shortcut.keys.find(k => 
      !['control', 'ctrl', 'meta', 'cmd', 'alt', 'shift'].includes(k.toLowerCase())
    );
    
    if (!mainKey) return false;
    
    const ctrlMatch = hasCtrl === (event.ctrlKey || event.metaKey);
    const altMatch = hasAlt === event.altKey;
    const shiftMatch = hasShift === event.shiftKey;
    const keyMatch = mainKey.toLowerCase() === event.key.toLowerCase() ||
                   mainKey.toLowerCase() === event.code.toLowerCase();
    
    return ctrlMatch && altMatch && shiftMatch && keyMatch;
  }
  
  // Parse key combination string like "ctrl+shift+n"
  static parseKeyCombo(keyCombo: string): {
    ctrl: boolean;
    alt: boolean;
    shift: boolean;
    key: string;
  } {
    const parts = keyCombo.toLowerCase().split('+').map(p => p.trim());
    
    return {
      ctrl: parts.includes('ctrl') || parts.includes('cmd') || parts.includes('meta'),
      alt: parts.includes('alt'),
      shift: parts.includes('shift'),
      key: parts.find(p => !['ctrl', 'cmd', 'meta', 'alt', 'shift'].includes(p)) || '',
    };
  }
  
  // Format key combination for display
  static formatKeyCombo(keys: string[]): string {
    if (keys.length === 0) return '';
    
    // Use platform-appropriate symbols
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const parts: string[] = [];
    
    // Handle modifiers first
    const modifiers = keys.filter(k => 
      ['control', 'ctrl', 'meta', 'cmd', 'alt', 'shift'].includes(k.toLowerCase())
    );
    const mainKey = keys.find(k => 
      !['control', 'ctrl', 'meta', 'cmd', 'alt', 'shift'].includes(k.toLowerCase())
    );
    
    modifiers.forEach(modifier => {
      const mod = modifier.toLowerCase();
      if (['control', 'ctrl', 'meta', 'cmd'].includes(mod)) {
        parts.push(isMac ? '⌘' : 'Ctrl');
      } else if (mod === 'alt') {
        parts.push(isMac ? '⌥' : 'Alt');
      } else if (mod === 'shift') {
        parts.push(isMac ? '⇧' : 'Shift');
      }
    });
    
    // Add the main key
    if (mainKey) {
      const keyName = KeyboardUtils.getKeyDisplayName(mainKey);
      parts.push(keyName);
    }
    
    return parts.join(isMac ? '' : '+');
  }
  
  // Get display name for a key
  static getKeyDisplayName(key: string): string {
    const keyMap: Record<string, string> = {
      'arrowup': '↑',
      'arrowdown': '↓',
      'arrowleft': '←',
      'arrowright': '→',
      'enter': '↵',
      'space': '␣',
      'tab': '⇥',
      'escape': 'Esc',
      'backspace': '⌫',
      'delete': '⌦',
      'home': '⌂',
      'end': 'End',
      'pageup': 'PgUp',
      'pagedown': 'PgDn',
    };
    
    const normalized = key.toLowerCase();
    return keyMap[normalized] || key.charAt(0).toUpperCase() + key.slice(1);
  }
  
  // Add event listener for a shortcut
  addListener(
    shortcutId: string,
    handler: (event: KeyboardEvent) => void,
    element: HTMLElement = document.body
  ): void {
    const shortcut = this.shortcuts.get(shortcutId);
    if (!shortcut) {
      console.warn(`Shortcut ${shortcutId} not found`);
      return;
    }
    
    const listener = (event: KeyboardEvent) => {
      if (KeyboardUtils.matchesShortcut(event, shortcut)) {
        // Check if we should prevent default
        if (shortcut.preventDefault !== false) {
          event.preventDefault();
        }
        
        // Check if we should stop propagation
        if (shortcut.stopPropagation !== false) {
          event.stopPropagation();
        }
        
        handler(event);
      }
    };
    
    // Remove existing listener if any
    this.removeListener(shortcutId);
    
    // Add new listener
    element.addEventListener('keydown', listener);
    this.listeners.set(shortcutId, listener);
  }
  
  // Remove event listener for a shortcut
  removeListener(shortcutId: string, element: HTMLElement = document.body): void {
    const listener = this.listeners.get(shortcutId);
    if (listener) {
      element.removeEventListener('keydown', listener);
      this.listeners.delete(shortcutId);
    }
  }
  
  // Remove all listeners
  removeAllListeners(element: HTMLElement = document.body): void {
    this.listeners.forEach(listener => {
      element.removeEventListener('keydown', listener);
    });
    this.listeners.clear();
  }
  
  // Check if a shortcut is available (not conflicting)
  isShortcutAvailable(keys: string[], excludeId?: string): boolean {
    const keyString = keys.join('+').toLowerCase();
    for (const [id, shortcut] of this.shortcuts) {
      if (excludeId && id === excludeId) continue;
      const shortcutKeyString = shortcut.keys.join('+').toLowerCase();
      if (shortcutKeyString === keyString) {
        return false;
      }
    }
    return true;
  }
  
  // Get shortcuts by category
  getShortcutsByCategory(category: string): KeyboardShortcut[] {
    return Array.from(this.shortcuts.values())
      .filter(shortcut => shortcut.category === category);
  }
  
  // Validate shortcut configuration
  static validateShortcut(shortcut: KeyboardShortcut): {
    isValid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];
    
    if (!shortcut.id?.trim()) {
      errors.push('Shortcut ID is required');
    }
    
    if (!shortcut.keys || shortcut.keys.length === 0) {
      errors.push('Key combination is required');
    } else {
      const hasMainKey = shortcut.keys.some(k => 
        !['control', 'ctrl', 'meta', 'cmd', 'alt', 'shift'].includes(k.toLowerCase())
      );
      if (!hasMainKey) {
        errors.push('Main key is required in combination');
      }
    }
    
    if (!shortcut.description?.trim()) {
      errors.push('Description is required');
    }
    
    return {
      isValid: errors.length === 0,
      errors,
    };
  }
  
  // Check if an event should be ignored (e.g., in input fields)
  static shouldIgnoreEvent(event: KeyboardEvent): boolean {
    const target = event.target as HTMLElement;
    if (!target) return false;
    
    const tagName = target.tagName.toLowerCase();
    const isInput = tagName === 'input' || tagName === 'textarea' || target.contentEditable === 'true';
    
    // Ignore if typing in input field (unless it's a special key)
    if (isInput) {
      const specialKeys = ['escape', 'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11', 'f12'];
      const isSpecialKey = specialKeys.includes(event.key.toLowerCase());
      const hasModifier = event.ctrlKey || event.metaKey || event.altKey;
      
      return !isSpecialKey && !hasModifier;
    }
    
    return false;
  }
  
  // Create a help dialog content for shortcuts
  generateHelpContent(): string {
    const shortcuts = Array.from(this.shortcuts.values());
    
    // Group by category
    const groupedShortcuts: Record<string, KeyboardShortcut[]> = {};
    shortcuts.forEach(shortcut => {
      const category = shortcut.category || 'General';
      if (!groupedShortcuts[category]) {
        groupedShortcuts[category] = [];
      }
      groupedShortcuts[category].push(shortcut);
    });
    
    let content = '# Keyboard Shortcuts\n\n';
    
    Object.entries(groupedShortcuts).forEach(([category, categoryShortcuts]) => {
      content += `## ${category}\n\n`;
      content += '| Shortcut | Description |\n';
      content += '|----------|-------------|\n';
      
      categoryShortcuts
        .sort((a, b) => a.description.localeCompare(b.description))
        .forEach(shortcut => {
          const key = KeyboardUtils.formatKeyCombo(shortcut.keys);
          content += `| ${key} | ${shortcut.description} |\n`;
        });
      
      content += '\n';
    });
    
    return content;
  }
  
  // Export shortcuts configuration
  exportShortcuts(): KeyboardShortcut[] {
    return Array.from(this.shortcuts.values());
  }
  
  // Import shortcuts configuration
  importShortcuts(shortcuts: KeyboardShortcut[]): void {
    // Validate all shortcuts first
    const validationErrors: string[] = [];
    shortcuts.forEach((shortcut, index) => {
      const validation = KeyboardUtils.validateShortcut(shortcut);
      if (!validation.isValid) {
        validationErrors.push(`Shortcut ${index + 1}: ${validation.errors.join(', ')}`);
      }
    });
    
    if (validationErrors.length > 0) {
      throw new Error(`Invalid shortcuts:\n${validationErrors.join('\n')}`);
    }
    
    // Check for duplicates
    const keyMap = new Map<string, number>();
    shortcuts.forEach((shortcut, index) => {
      const normalizedKey = shortcut.keys.join('+').toLowerCase();
      if (keyMap.has(normalizedKey)) {
        throw new Error(`Duplicate key combination "${shortcut.keys.join('+')}" at shortcuts ${keyMap.get(normalizedKey)! + 1} and ${index + 1}`);
      }
      keyMap.set(normalizedKey, index);
    });
    
    // If all valid, set the shortcuts
    this.setShortcuts(shortcuts);
  }
}

// Global keyboard utilities
export class GlobalKeyboardManager {
  private static instance: GlobalKeyboardManager | null = null;
  private keyboardUtils: KeyboardUtils;
  private isEnabled: boolean = true;
  
  private constructor() {
    this.keyboardUtils = new KeyboardUtils();
    this.setupGlobalListener();
  }
  
  static getInstance(): GlobalKeyboardManager {
    if (!GlobalKeyboardManager.instance) {
      GlobalKeyboardManager.instance = new GlobalKeyboardManager();
    }
    return GlobalKeyboardManager.instance;
  }
  
  // Setup global event listener
  private setupGlobalListener(): void {
    document.addEventListener('keydown', this.handleGlobalKeyDown.bind(this));
    
    // Handle window focus changes
    window.addEventListener('focus', () => {
      this.isEnabled = true;
    });
    
    window.addEventListener('blur', () => {
      this.isEnabled = false;
    });
  }
  
  // Handle global keydown events
  private handleGlobalKeyDown(event: KeyboardEvent): void {
    if (!this.isEnabled || KeyboardUtils.shouldIgnoreEvent(event)) {
      return;
    }
    
    // Check all registered shortcuts
    for (const shortcut of this.keyboardUtils.exportShortcuts()) {
      if (KeyboardUtils.matchesShortcut(event, shortcut)) {
        // Dispatch custom event
        const customEvent = new CustomEvent('kanban:shortcut', {
          detail: {
            shortcut,
            originalEvent: event,
          },
        });
        
        document.dispatchEvent(customEvent);
        
        if (shortcut.preventDefault !== false) {
          event.preventDefault();
        }
        if (shortcut.stopPropagation !== false) {
          event.stopPropagation();
        }
        
        break;
      }
    }
  }
  
  // Enable/disable keyboard handling
  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
  }
  
  // Get keyboard utils instance
  getKeyboardUtils(): KeyboardUtils {
    return this.keyboardUtils;
  }
  
  // Convenience methods
  addShortcut(shortcut: KeyboardShortcut): void {
    this.keyboardUtils.addShortcut(shortcut);
  }
  
  removeShortcut(id: string): void {
    this.keyboardUtils.removeShortcut(id);
  }
  
  setShortcuts(shortcuts: KeyboardShortcut[]): void {
    this.keyboardUtils.setShortcuts(shortcuts);
  }
}

// Hook for React components
export const useKeyboard = () => {
  const manager = GlobalKeyboardManager.getInstance();
  return {
    keyboardUtils: manager.getKeyboardUtils(),
    addShortcut: manager.addShortcut.bind(manager),
    removeShortcut: manager.removeShortcut.bind(manager),
    setShortcuts: manager.setShortcuts.bind(manager),
    setEnabled: manager.setEnabled.bind(manager),
  };
};

// Utility functions
export const keyboardUtils = {
  // Format key combination for display
  formatKeyCombo: KeyboardUtils.formatKeyCombo,
  
  // Parse key combination string
  parseKeyCombo: KeyboardUtils.parseKeyCombo,
  
  // Check if event matches shortcut
  matchesShortcut: KeyboardUtils.matchesShortcut,
  
  // Get key display name
  getKeyDisplayName: KeyboardUtils.getKeyDisplayName,
  
  // Check if event should be ignored
  shouldIgnoreEvent: KeyboardUtils.shouldIgnoreEvent,
};