# Card Reordering Feature

## Overview
The Kanban board now supports card reordering within columns via drag and drop. Users can change the order of cards within the same status column by dragging cards up or down.

## How It Works

### User Experience
1. **Drag Handle**: Each card has a grip icon (⋮⋮) on the left side that serves as a drag handle
2. **Visual Feedback**: 
   - Hover over the drag handle to see a tooltip and highlight effect
   - While dragging, the card becomes slightly transparent and scales up
   - Drop zones show a dashed border when hovering with a card
   - Empty columns display "Drop card here" message when hovering
3. **Reordering**: Drag a card and drop it on another card in the same column to reorder

### Technical Implementation

#### Components Involved
- **KanbanBoard**: Handles drag events and coordinates card movement
- **KanbanColumn**: Provides sortable context for cards within each column
- **KanbanCard**: Individual draggable card component with visual feedback
- **CardVirtualList**: Supports reordering even in virtualized lists

#### Drag and Drop System
- Uses `@dnd-kit` library for robust drag and drop functionality
- `SortableContext` with `verticalListSortingStrategy` for each column
- Collision detection prevents accidental drops
- Activation constraint (8px distance) prevents unintentional drags

#### State Management
- Cards maintain order in `cardOrder[path]` array in the store
- `moveCard(cardId, status, newIndex)` action handles reordering
- Real-time updates with proper state synchronization
- Undo/redo support for reordering operations

## Features

### Intra-Column Reordering
- Drag cards within the same column to change their order
- Visual feedback during drag operations
- Smooth animations for position changes

### Inter-Column Movement
- Drag cards between different status columns
- Maintains original functionality while adding reordering
- Cards dropped on columns go to the end of that column

### Responsive Design
- Works on both desktop and mobile devices
- Touch-friendly drag interactions
- Consistent spacing and visual feedback

### Performance Optimization
- Virtualized lists support reordering for large card sets
- Minimal re-renders during drag operations
- Efficient state updates with Zustand + Immer

## Usage Examples

### Basic Reordering
1. Hover over a card's drag handle (⋮⋮)
2. Click and drag to move the card
3. Drop on another card or empty space in the same column
4. The card order updates immediately

### Cross-Column Movement
1. Drag a card from one column
2. Drop it on another column header or cards
3. The card moves to the new status and appears at the target position

### Keyboard Support
- Tab navigation to cards
- Space/Enter to start drag mode
- Arrow keys to move cards during keyboard drag
- Escape to cancel drag operation

## Technical Notes

### Card Order Persistence
- Card order is stored in `cardOrder[path]` for each path in the hierarchy
- Order persists across navigation and page refreshes
- Hierarchical paths maintain separate ordering contexts

### Collision Detection
- Uses `closestCenter` strategy for accurate drop targeting
- Prevents cards from being dropped in invalid locations
- Handles edge cases like dragging outside valid drop zones

### Animation System
- CSS transforms for smooth drag animations
- Scale and opacity changes during drag
- Transition animations for reordering
- No layout thrashing during drag operations

## Browser Support
- Modern browsers with ES2020+ support
- Touch devices (iOS Safari, Android Chrome)
- Keyboard accessibility compliant
- Screen reader compatible drag operations