// Core data types for the DataGrid component
import { ReactNode, CSSProperties } from 'react';

export interface DataGridColumn<T = any> {
  id: string;
  accessorKey: keyof T;
  header: string;
  size?: number;
  minSize?: number;
  maxSize?: number;
  enableSorting?: boolean;
  enableHiding?: boolean;
  enableResizing?: boolean;
  enableGrouping?: boolean;
  cell?: (info: { getValue: () => any; row: { original: T } }) => ReactNode;
  meta?: {
    align?: 'left' | 'center' | 'right';
    type?: 'text' | 'number' | 'date' | 'boolean' | 'action';
    format?: (value: any) => string;
    [key: string]: any;
  };
}

export interface DataGridSchema<T = any> {
  columns: DataGridColumn<T>[];
  defaultSort?: Array<{ id: string; desc: boolean }>;
  defaultGrouping?: string[];
  defaultColumnVisibility?: Record<string, boolean>;
  enableMultiSort?: boolean;
  enableGrouping?: boolean;
  enableColumnOrdering?: boolean;
  enableColumnResizing?: boolean;
}

export interface SortingState {
  id: string;
  desc: boolean;
}

export interface GroupingState {
  [columnId: string]: any;
}

export interface PaginationState {
  pageIndex: number;
  pageSize: number;
}

export interface ColumnVisibilityState {
  [columnId: string]: boolean;
}

export interface ColumnOrderState {
  columnOrder: string[];
}

export interface ColumnSizingState {
  [columnId: string]: number;
}

export interface DataGridState {
  sorting: Array<{ id: string; desc: boolean }>;
  grouping: string[];
  columnVisibility: ColumnVisibilityState;
  columnOrder: string[];
  columnSizing: ColumnSizingState;
  pagination: PaginationState;
  globalFilter: string;
  rowSelection: Record<string, boolean>;
}

export interface DataGridProps<T = any> {
  data: T[];
  schema: DataGridSchema<T>;
  loading?: boolean;
  height?: string | number;
  maxHeight?: string | number;
  enableVirtualization?: boolean;
  enableStreaming?: boolean;
  streamingBatchSize?: number;
  onStateChange?: (state: Partial<DataGridState>) => void;
  onRowClick?: (row: T) => void;
  onRowDoubleClick?: (row: T) => void;
  className?: string;
  style?: CSSProperties;
  emptyState?: ReactNode;
  errorState?: ReactNode;
  loadingState?: ReactNode;
}

export interface StreamingDataProvider<T = any> {
  subscribe: (callback: (data: T[]) => void) => () => void;
  loadMore: () => Promise<void>;
  hasMore: boolean;
  isLoading: boolean;
}

export interface TreeNode<T = any> {
  id: string;
  data: T;
  children?: TreeNode<T>[];
  parent?: TreeNode<T>;
  expanded?: boolean;
  level: number;
}

export interface GroupedData<T = any> {
  groupKey: string;
  groupValue: any;
  items: T[];
  subGroups?: GroupedData<T>[];
  expanded?: boolean;
  level: number;
}

// Event types
export interface DataGridEvent<T = any> {
  type: string;
  data?: T;
  meta?: any;
}

export type DataGridEventHandler<T = any> = (event: DataGridEvent<T>) => void;

// Theme types
export interface DataGridTheme {
  colorScheme: 'light' | 'dark';
  primaryColor: string;
  backgroundColor: string;
  borderColor: string;
  headerBackgroundColor: string;
  rowHoverColor: string;
  selectedRowColor: string;
  fontSize: number;
  fontFamily: string;
}

// Filter types
export interface FilterState {
  id: string;
  value: any;
  operator: 'contains' | 'equals' | 'starts_with' | 'ends_with' | 'gt' | 'lt' | 'gte' | 'lte' | 'between';
}

export interface FilterDefinition {
  columnId: string;
  type: 'text' | 'number' | 'date' | 'select' | 'multi-select' | 'boolean';
  options?: Array<{ label: string; value: any }>;
  placeholder?: string;
}