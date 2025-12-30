import { z } from 'zod';

// Navigation Schema Version
export const NAVIGATION_SCHEMA_VERSION = '1.0.0';

// Breadcrumb Display Options
export const BreadcrumbDisplay = z.object({
  showRoot: z.boolean().default(true),
  showIcons: z.boolean().default(true),
  showSeparator: z.boolean().default(true),
  separator: z.string().default('/'),
  maxItems: z.number().default(5), // Max items before collapsing
  
  // Mobile behavior
  mobile: z.object({
    maxItems: z.number().default(2),
    useDropdown: z.boolean().default(true),
    showCurrentOnly: z.boolean().default(false),
  }),
  
  // Styling
  style: z.object({
    variant: z.enum(['filled', 'subtle', 'outline', 'transparent']).default('subtle'),
    size: z.enum(['xs', 'sm', 'md', 'lg']).default('sm'),
    radius: z.enum(['xs', 'sm', 'md', 'lg', 'xl']).default('sm'),
  }),
});

export type BreadcrumbDisplay = z.infer<typeof BreadcrumbDisplay>;

// Keyboard Shortcut Definition
export const KeyboardShortcut = z.object({
  id: z.string(),
  description: z.string(),
  keys: z.array(z.string()), // e.g., ['Meta', 'k'] or ['ArrowUp']
  action: z.enum([
    'navigate-up',
    'navigate-down', 
    'navigate-left',
    'navigate-right',
    'navigate-back',
    'navigate-forward',
    'navigate-root',
    'open-card',
    'edit-card',
    'new-card',
    'delete-card',
    'search',
    'focus-panel',
    'toggle-theme',
    'undo',
    'redo',
    'custom'
  ]),
  handler: z.string().optional(), // Custom handler function name
  
  // Conditions
  enabledWhen: z.string().optional(), // JS expression for when shortcut is enabled
  preventDefault: z.boolean().default(true),
  stopPropagation: z.boolean().default(true),
  
  // Scope
  global: z.boolean().default(false), // Global vs component-specific
  excludeInputs: z.boolean().default(true), // Disable when input is focused
  
  // Visual feedback
  showInTooltip: z.boolean().default(false),
  category: z.string().optional(), // For grouping in help/documentation
});

export type KeyboardShortcut = z.infer<typeof KeyboardShortcut>;

// Navigation Behavior
export const NavigationBehavior = z.object({
  // Auto-navigation
  autoOpenCards: z.boolean().default(false), // Auto-open cards on navigation
  autoSelectFirst: z.boolean().default(true), // Auto-select first card when navigating
  
  // Double-click/tap behavior
  doubleClickAction: z.enum(['open', 'edit', 'navigate', 'none']).default('navigate'),
  doubleTapAction: z.enum(['open', 'edit', 'navigate', 'none']).default('navigate'),
  longPressAction: z.enum(['open', 'edit', 'menu', 'none']).default('edit'),
  longPressDuration: z.number().default(500), // ms
  
  // Focus behavior
  focusOnNavigation: z.boolean().default(true),
  focusOnCardSelection: z.boolean().default(true),
  restoreFocus: z.boolean().default(true), // Restore focus after modal/drawer close
  
  // URL integration
  updateUrl: z.boolean().default(true),
  urlFormat: z.enum(['path', 'hash', 'query']).default('hash'),
  urlPrefix: z.string().default('board'),
  
  // History
  enableHistory: z.boolean().default(true),
  maxHistorySize: z.number().default(50),
  
  // Animation
  animateTransitions: z.boolean().default(true),
  animationDuration: z.number().default(200), // ms
});

export type NavigationBehavior = z.infer<typeof NavigationBehavior>;

// Path Configuration
export const PathConfiguration = z.object({
  rootPath: z.string().default('root'),
  pathSeparator: z.string().default('/'),
  pathCaseSensitive: z.boolean().default(false),
  
  // Path display
  displayNames: z.record(z.string(), z.string()).optional(), // path -> display name mapping
  displayIcons: z.record(z.string(), z.string()).optional(), // path -> icon mapping
  
  // Path validation
  allowedCharacters: z.string().default('a-zA-Z0-9-_'),
  maxDepth: z.number().default(10),
  maxSegmentLength: z.number().default(50),
  
  // Auto-generation
  autoGeneratePath: z.boolean().default(true),
  pathFromTitle: z.boolean().default(true),
  slugify: z.boolean().default(true),
});

export type PathConfiguration = z.infer<typeof PathConfiguration>;

// Navigation Schema
export const NavigationSchema = z.object({
  version: z.string().default(NAVIGATION_SCHEMA_VERSION),
  name: z.string(),
  description: z.string().optional(),
  
  // Breadcrumb configuration
  breadcrumb: BreadcrumbDisplay.optional(),
  
  // Keyboard shortcuts
  shortcuts: z.array(KeyboardShortcut).default([]),
  
  // Navigation behavior
  behavior: NavigationBehavior.optional(),
  
  // Path configuration
  paths: PathConfiguration.optional(),
  
  // Search integration
  search: z.object({
    enableGlobalSearch: z.boolean().default(true),
    searchShortcut: z.array(z.string()).default(['Meta', 'k']),
    searchPlaceholder: z.string().default('Search cards...'),
    
    // Search scoping
    searchInCurrentLevel: z.boolean().default(false),
    searchInChildren: z.boolean().default(true),
    searchInSiblings: z.boolean().default(true),
    
    // Results
    maxResults: z.number().default(20),
    groupByLevel: z.boolean().default(true),
    highlightMatches: z.boolean().default(true),
  }),
  
  // Mobile navigation
  mobile: z.object({
    showBackButton: z.boolean().default(true),
    swipeGestures: z.boolean().default(true),
    swipeThreshold: z.number().default(50), // px
    
    // Touch navigation
    tapToNavigate: z.boolean().default(true),
    doubleTapDelay: z.number().default(300), // ms
    
    // Mobile-specific shortcuts
    volumeKeyNavigation: z.boolean().default(false),
    shakeToRefresh: z.boolean().default(false),
  }),
  
  // Accessibility
  accessibility: z.object({
    announceNavigation: z.boolean().default(true),
    skipLinks: z.boolean().default(true),
    landmarkRoles: z.boolean().default(true),
    keyboardTrap: z.boolean().default(true), // Trap focus in modals
    
    // Screen reader
    ariaLabels: z.record(z.string(), z.string()).default({}),
    liveRegions: z.boolean().default(true),
  }),
});

export type NavigationSchema = z.infer<typeof NavigationSchema>;

// Helper function to create keyboard shortcuts with defaults
const createShortcut = (partial: Partial<KeyboardShortcut> & { id: string; description: string; keys: string[]; action: KeyboardShortcut['action'] }): KeyboardShortcut => ({
  preventDefault: true,
  stopPropagation: true,
  global: false,
  excludeInputs: true,
  showInTooltip: false,
  ...partial,
});

// Default Navigation Schema
export const defaultNavigationSchema: NavigationSchema = {
  version: NAVIGATION_SCHEMA_VERSION,
  name: 'Standard Navigation',
  description: 'Standard navigation with breadcrumbs and keyboard shortcuts',
  
  breadcrumb: {
    showRoot: true,
    showIcons: true,
    showSeparator: true,
    separator: '/',
    maxItems: 5,
    
    mobile: {
      maxItems: 2,
      useDropdown: true,
      showCurrentOnly: false,
    },
    
    style: {
      variant: 'subtle',
      size: 'sm',
      radius: 'sm',
    },
  },
  
  shortcuts: [
    createShortcut({
      id: 'navigate-up',
      description: 'Navigate up one level',
      keys: ['ArrowLeft'],
      action: 'navigate-up',
      category: 'navigation',
    }),
    createShortcut({
      id: 'navigate-down',
      description: 'Navigate into selected card',
      keys: ['ArrowRight', 'Enter'],
      action: 'navigate-down',
      category: 'navigation',
    }),
    createShortcut({
      id: 'select-up',
      description: 'Select previous card',
      keys: ['ArrowUp'],
      action: 'navigate-up',
      category: 'selection',
    }),
    createShortcut({
      id: 'select-down',
      description: 'Select next card',
      keys: ['ArrowDown'],
      action: 'navigate-down',
      category: 'selection',
    }),
    createShortcut({
      id: 'open-card',
      description: 'Open card details',
      keys: ['Space'],
      action: 'open-card',
      category: 'cards',
    }),
    createShortcut({
      id: 'edit-card',
      description: 'Edit selected card',
      keys: ['e'],
      action: 'edit-card',
      excludeInputs: true,
      category: 'cards',
    }),
    createShortcut({
      id: 'new-card',
      description: 'Create new card',
      keys: ['n'],
      action: 'new-card',
      excludeInputs: true,
      category: 'cards',
    }),
    createShortcut({
      id: 'delete-card',
      description: 'Delete selected card',
      keys: ['Delete', 'Backspace'],
      action: 'delete-card',
      excludeInputs: true,
      category: 'cards',
    }),
    createShortcut({
      id: 'search',
      description: 'Global search',
      keys: ['Meta', 'k'],
      action: 'search',
      global: true,
      category: 'search',
    }),
    createShortcut({
      id: 'search-alt',
      description: 'Global search (alternative)',
      keys: ['Control', 'k'],
      action: 'search',
      global: true,
      category: 'search',
    }),
    createShortcut({
      id: 'focus-panel',
      description: 'Focus info panel',
      keys: ['p'],
      action: 'focus-panel',
      excludeInputs: true,
      category: 'interface',
    }),
    createShortcut({
      id: 'toggle-theme',
      description: 'Toggle light/dark theme',
      keys: ['Meta', 'Shift', 'd'],
      action: 'toggle-theme',
      global: true,
      category: 'interface',
    }),
    createShortcut({
      id: 'undo',
      description: 'Undo last action',
      keys: ['Meta', 'z'],
      action: 'undo',
      global: true,
      category: 'editing',
    }),
    createShortcut({
      id: 'undo-alt',
      description: 'Undo last action (PC)',
      keys: ['Control', 'z'],
      action: 'undo',
      global: true,
      category: 'editing',
    }),
    createShortcut({
      id: 'redo',
      description: 'Redo last action',
      keys: ['Meta', 'Shift', 'z'],
      action: 'redo',
      global: true,
      category: 'editing',
    }),
    createShortcut({
      id: 'redo-alt',
      description: 'Redo last action (PC)',
      keys: ['Control', 'Shift', 'z'],
      action: 'redo',
      global: true,
      category: 'editing',
    }),
    createShortcut({
      id: 'navigate-root',
      description: 'Navigate to root level',
      keys: ['Home'],
      action: 'navigate-root',
      category: 'navigation',
    }),
  ],
  
  behavior: {
    autoOpenCards: false,
    autoSelectFirst: true,
    doubleClickAction: 'navigate',
    doubleTapAction: 'navigate',
    longPressAction: 'edit',
    longPressDuration: 500,
    focusOnNavigation: true,
    focusOnCardSelection: true,
    restoreFocus: true,
    updateUrl: true,
    urlFormat: 'hash',
    urlPrefix: 'board',
    enableHistory: true,
    maxHistorySize: 50,
    animateTransitions: true,
    animationDuration: 200,
  },
  
  paths: {
    rootPath: 'root',
    pathSeparator: '/',
    pathCaseSensitive: false,
    allowedCharacters: 'a-zA-Z0-9-_',
    maxDepth: 10,
    maxSegmentLength: 50,
    autoGeneratePath: true,
    pathFromTitle: true,
    slugify: true,
  },
  
  search: {
    enableGlobalSearch: true,
    searchShortcut: ['Meta', 'k'],
    searchPlaceholder: 'Search cards...',
    searchInCurrentLevel: false,
    searchInChildren: true,
    searchInSiblings: true,
    maxResults: 20,
    groupByLevel: true,
    highlightMatches: true,
  },
  
  mobile: {
    showBackButton: true,
    swipeGestures: true,
    swipeThreshold: 50,
    tapToNavigate: true,
    doubleTapDelay: 300,
    volumeKeyNavigation: false,
    shakeToRefresh: false,
  },
  
  accessibility: {
    announceNavigation: true,
    skipLinks: true,
    landmarkRoles: true,
    keyboardTrap: true,
    ariaLabels: {
      breadcrumb: 'Breadcrumb navigation',
      currentLevel: 'Current level',
      parentLevel: 'Parent level',
      search: 'Search cards',
      backButton: 'Go back',
    },
    liveRegions: true,
  },
};

// Schema validation functions
export const validateNavigationSchema = (schema: unknown): NavigationSchema => {
  return NavigationSchema.parse(schema);
};

// Helper functions
export const getShortcutsByCategory = (schema: NavigationSchema): Record<string, KeyboardShortcut[]> => {
  const categories: Record<string, KeyboardShortcut[]> = {};
  
  schema.shortcuts.forEach(shortcut => {
    const category = shortcut.category || 'other';
    if (!categories[category]) {
      categories[category] = [];
    }
    categories[category].push(shortcut);
  });
  
  return categories;
};

export const getShortcutByAction = (schema: NavigationSchema, action: KeyboardShortcut['action']): KeyboardShortcut | undefined => {
  return schema.shortcuts.find(shortcut => shortcut.action === action);
};

export const formatShortcutKeys = (keys: string[]): string => {
  // Convert key names to display format
  const keyMap: Record<string, string> = {
    'Meta': '⌘',
    'Control': 'Ctrl',
    'Alt': '⌥',
    'Shift': '⇧',
    'ArrowUp': '↑',
    'ArrowDown': '↓',
    'ArrowLeft': '←',
    'ArrowRight': '→',
    'Enter': '⏎',
    'Space': '␣',
    'Backspace': '⌫',
    'Delete': '⌦',
    'Home': '⇱',
    'End': '⇲',
  };
  
  return keys.map(key => keyMap[key] || key).join(' + ');
};

export const createPathFromTitle = (title: string, options: PathConfiguration): string => {
  if (!options.pathFromTitle) return title;
  
  let path = title.toLowerCase();
  
  if (options.slugify) {
    // Basic slugification
    path = path
      .replace(/[^\w\s-]/g, '') // Remove special characters
      .replace(/[\s_-]+/g, '-') // Replace spaces/underscores with hyphens
      .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
  }
  
  // Apply character restrictions
  const allowedRegex = new RegExp(`[^${options.allowedCharacters}]`, 'g');
  path = path.replace(allowedRegex, '');
  
  // Limit length
  if (path.length > options.maxSegmentLength) {
    path = path.substring(0, options.maxSegmentLength);
  }
  
  return path || 'untitled';
};

export const parsePath = (path: string, separator: string = '/'): string[] => {
  return path.split(separator).filter(segment => segment.length > 0);
};

export const buildPath = (segments: string[], separator: string = '/'): string => {
  return segments.join(separator);
};

export const getParentPath = (path: string, separator: string = '/'): string | null => {
  const segments = parsePath(path, separator);
  if (segments.length <= 1) return null;
  
  segments.pop();
  return buildPath(segments, separator);
};