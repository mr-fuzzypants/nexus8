import { useEffect, useState } from 'react';

// Responsive breakpoints (Mantine defaults)
export const BREAKPOINTS = {
  xs: 576,
  sm: 768,
  md: 992,
  lg: 1200,
  xl: 1400,
} as const;

export type Breakpoint = keyof typeof BREAKPOINTS;

// Current screen size
export interface ScreenSize {
  width: number;
  height: number;
  breakpoint: Breakpoint;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
}

// Responsive utilities class
export class ResponsiveUtils {
  // Get current breakpoint based on width
  static getBreakpoint(width: number): Breakpoint {
    if (width < BREAKPOINTS.xs) return 'xs';
    if (width < BREAKPOINTS.sm) return 'xs';
    if (width < BREAKPOINTS.md) return 'sm';
    if (width < BREAKPOINTS.lg) return 'md';
    if (width < BREAKPOINTS.xl) return 'lg';
    return 'xl';
  }
  
  // Check if screen size is mobile
  static isMobile(width: number): boolean {
    return width < BREAKPOINTS.md;
  }
  
  // Check if screen size is tablet
  static isTablet(width: number): boolean {
    return width >= BREAKPOINTS.sm && width < BREAKPOINTS.lg;
  }
  
  // Check if screen size is desktop
  static isDesktop(width: number): boolean {
    return width >= BREAKPOINTS.lg;
  }
  
  // Get current screen info
  static getCurrentScreenSize(): ScreenSize {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const breakpoint = ResponsiveUtils.getBreakpoint(width);
    
    return {
      width,
      height,
      breakpoint,
      isMobile: ResponsiveUtils.isMobile(width),
      isTablet: ResponsiveUtils.isTablet(width),
      isDesktop: ResponsiveUtils.isDesktop(width),
    };
  }
  
  // Calculate grid columns for responsive design
  static getGridColumns(baseColumns: number, screenSize: ScreenSize): number {
    if (screenSize.isMobile) {
      return Math.min(baseColumns, 1);
    }
    if (screenSize.isTablet) {
      return Math.min(baseColumns, 2);
    }
    return baseColumns;
  }
  
  // Get responsive card size
  static getCardSize(screenSize: ScreenSize): 'compact' | 'normal' | 'expanded' {
    if (screenSize.isMobile) return 'compact';
    if (screenSize.isTablet) return 'normal';
    return 'expanded';
  }
  
  // Calculate maximum visible cards for virtualization
  static getMaxVisibleCards(containerHeight: number, cardHeight: number, padding: number = 16): number {
    const availableHeight = containerHeight - padding;
    const cardsPerView = Math.floor(availableHeight / cardHeight);
    return Math.max(cardsPerView + 2, 5); // Add buffer and minimum
  }
  
  // Get responsive font sizes
  static getFontSizes(screenSize: ScreenSize): {
    title: string;
    body: string;
    caption: string;
  } {
    if (screenSize.isMobile) {
      return {
        title: '1.1rem',
        body: '0.875rem',
        caption: '0.75rem',
      };
    }
    if (screenSize.isTablet) {
      return {
        title: '1.25rem',
        body: '0.9rem',
        caption: '0.8rem',
      };
    }
    return {
      title: '1.5rem',
      body: '1rem',
      caption: '0.875rem',
    };
  }
  
  // Get responsive spacing
  static getSpacing(screenSize: ScreenSize): {
    xs: string;
    sm: string;
    md: string;
    lg: string;
    xl: string;
  } {
    const multiplier = screenSize.isMobile ? 0.75 : screenSize.isTablet ? 0.875 : 1;
    
    return {
      xs: `${0.25 * multiplier}rem`,
      sm: `${0.5 * multiplier}rem`,
      md: `${1 * multiplier}rem`,
      lg: `${1.5 * multiplier}rem`,
      xl: `${2 * multiplier}rem`,
    };
  }
  
  // Check if touch device
  static isTouchDevice(): boolean {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  }
  
  // Get optimal panel width
  static getPanelWidth(screenSize: ScreenSize, totalWidth: number): number {
    if (screenSize.isMobile) {
      return Math.min(totalWidth - 32, 320);
    }
    if (screenSize.isTablet) {
      return Math.min(totalWidth * 0.4, 400);
    }
    return Math.min(totalWidth * 0.3, 480);
  }
  
  // Calculate column widths for Kanban board
  static getColumnWidths(
    screenSize: ScreenSize,
    columnCount: number,
    containerWidth: number
  ): number[] {
    const padding = 16;
    const gap = 12;
    const totalGaps = (columnCount - 1) * gap;
    const totalPadding = padding * 2;
    const availableWidth = containerWidth - totalGaps - totalPadding;
    
    let minColumnWidth = 280;
    
    if (screenSize.isMobile) {
      minColumnWidth = 240;
      // On mobile, show one column at a time
      return [Math.min(availableWidth, 320)];
    }
    
    if (screenSize.isTablet) {
      minColumnWidth = 260;
      // On tablet, show max 2 columns
      const maxColumns = Math.min(columnCount, 2);
      const columnWidth = Math.max(availableWidth / maxColumns, minColumnWidth);
      return Array(maxColumns).fill(columnWidth);
    }
    
    // Desktop: fit as many columns as possible
    const maxVisibleColumns = Math.floor(availableWidth / minColumnWidth);
    const visibleColumns = Math.min(columnCount, maxVisibleColumns);
    const columnWidth = availableWidth / visibleColumns;
    
    return Array(visibleColumns).fill(columnWidth);
  }
  
  // Get optimal virtualization settings
  static getVirtualizationSettings(screenSize: ScreenSize): {
    overscan: number;
    itemSize: number;
    scrollbarSize: number;
  } {
    if (screenSize.isMobile) {
      return {
        overscan: 3,
        itemSize: 120,
        scrollbarSize: 12,
      };
    }
    
    if (screenSize.isTablet) {
      return {
        overscan: 5,
        itemSize: 140,
        scrollbarSize: 14,
      };
    }
    
    return {
      overscan: 8,
      itemSize: 160,
      scrollbarSize: 16,
    };
  }
}

// React hook for responsive design
export const useResponsive = () => {
  const [screenSize, setScreenSize] = useState<ScreenSize>(
    ResponsiveUtils.getCurrentScreenSize()
  );
  
  useEffect(() => {
    const handleResize = () => {
      setScreenSize(ResponsiveUtils.getCurrentScreenSize());
    };
    
    window.addEventListener('resize', handleResize);
    
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);
  
  return screenSize;
};

// Hook for media queries
export const useMediaQuery = (query: string): boolean => {
  const [matches, setMatches] = useState(false);
  
  useEffect(() => {
    const mediaQuery = window.matchMedia(query);
    setMatches(mediaQuery.matches);
    
    const handler = (event: MediaQueryListEvent) => {
      setMatches(event.matches);
    };
    
    mediaQuery.addEventListener('change', handler);
    
    return () => {
      mediaQuery.removeEventListener('change', handler);
    };
  }, [query]);
  
  return matches;
};

// Hook for breakpoint-specific values
export const useBreakpointValue = <T>(values: Partial<Record<Breakpoint, T>>): T | undefined => {
  const screenSize = useResponsive();
  
  // Check current breakpoint first
  if (values[screenSize.breakpoint]) {
    return values[screenSize.breakpoint];
  }
  
  // Fall back to smaller breakpoints
  const breakpointOrder: Breakpoint[] = ['xl', 'lg', 'md', 'sm', 'xs'];
  const currentIndex = breakpointOrder.indexOf(screenSize.breakpoint);
  
  for (let i = currentIndex + 1; i < breakpointOrder.length; i++) {
    const bp = breakpointOrder[i];
    if (values[bp]) {
      return values[bp];
    }
  }
  
  return undefined;
};

// Hook for container queries
export const useContainerQuery = (ref: React.RefObject<HTMLElement>, query: string): boolean => {
  const [matches, setMatches] = useState(false);
  
  useEffect(() => {
    if (!ref.current) return;
    
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        
        // Simple query parsing (extend as needed)
        if (query.includes('min-width:')) {
          const minWidth = parseInt(query.match(/min-width:\s*(\d+)px/)?.[1] || '0');
          setMatches(width >= minWidth);
        } else if (query.includes('max-width:')) {
          const maxWidth = parseInt(query.match(/max-width:\s*(\d+)px/)?.[1] || '0');
          setMatches(width <= maxWidth);
        } else if (query.includes('min-height:')) {
          const minHeight = parseInt(query.match(/min-height:\s*(\d+)px/)?.[1] || '0');
          setMatches(height >= minHeight);
        } else if (query.includes('max-height:')) {
          const maxHeight = parseInt(query.match(/max-height:\s*(\d+)px/)?.[1] || '0');
          setMatches(height <= maxHeight);
        }
      }
    });
    
    observer.observe(ref.current);
    
    return () => observer.disconnect();
  }, [ref, query]);
  
  return matches;
};

// Responsive grid utilities
export const getResponsiveProps = (screenSize: ScreenSize) => ({
  // Mantine Grid props
  gutter: screenSize.isMobile ? 'xs' : screenSize.isTablet ? 'sm' : 'md',
  
  // Stack props
  spacing: screenSize.isMobile ? 'xs' : 'sm',
  
  // Group props
  gap: screenSize.isMobile ? 8 : screenSize.isTablet ? 12 : 16,
  
  // Modal props
  modalSize: screenSize.isMobile ? 'full' : screenSize.isTablet ? 'lg' : 'xl',
  
  // Drawer props
  drawerSize: screenSize.isMobile ? '100%' : screenSize.isTablet ? '400px' : '500px',
  
  // Card props
  padding: screenSize.isMobile ? 'sm' : screenSize.isTablet ? 'md' : 'lg',
  
  // Button props
  buttonSize: screenSize.isMobile ? 'sm' : 'md',
  
  // Text props
  textSize: screenSize.isMobile ? 'sm' : 'md',
});

// Touch gesture utilities
export const getTouchConfig = (screenSize: ScreenSize) => ({
  swipeThreshold: screenSize.isMobile ? 50 : 75,
  longPressDelay: screenSize.isMobile ? 600 : 500,
  tapDistance: screenSize.isMobile ? 15 : 10,
  doubleTapDelay: 300,
});

// Performance optimizations for different screen sizes
export const getPerformanceConfig = (screenSize: ScreenSize) => ({
  // Animation duration
  animationDuration: screenSize.isMobile ? 200 : 300,
  
  // Debounce delays
  searchDebounce: screenSize.isMobile ? 400 : 300,
  resizeDebounce: screenSize.isMobile ? 200 : 150,
  
  // Virtual list settings
  virtualListOverscan: screenSize.isMobile ? 3 : 5,
  virtualListItemSize: screenSize.isMobile ? 100 : 120,
  
  // Image loading
  lazyLoadThreshold: screenSize.isMobile ? '100px' : '200px',
  
  // Network settings
  requestBatchSize: screenSize.isMobile ? 10 : 20,
});

// Export utility functions
export const responsiveUtils = {
  getBreakpoint: ResponsiveUtils.getBreakpoint,
  isMobile: ResponsiveUtils.isMobile,
  isTablet: ResponsiveUtils.isTablet,
  isDesktop: ResponsiveUtils.isDesktop,
  getCurrentScreenSize: ResponsiveUtils.getCurrentScreenSize,
  getGridColumns: ResponsiveUtils.getGridColumns,
  getCardSize: ResponsiveUtils.getCardSize,
  getMaxVisibleCards: ResponsiveUtils.getMaxVisibleCards,
  getFontSizes: ResponsiveUtils.getFontSizes,
  getSpacing: ResponsiveUtils.getSpacing,
  isTouchDevice: ResponsiveUtils.isTouchDevice,
  getPanelWidth: ResponsiveUtils.getPanelWidth,
  getColumnWidths: ResponsiveUtils.getColumnWidths,
  getVirtualizationSettings: ResponsiveUtils.getVirtualizationSettings,
};