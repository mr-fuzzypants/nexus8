// Main entry point for the DataGrid library
export { DataGrid } from './components/DataGrid/DataGrid';
export { useDataGridState, useStreamingData } from './hooks/useDataGrid';
export { 
  flattenTreeData, 
  groupData, 
  sortData, 
  filterData, 
  debounce, 
  throttle, 
  paginateData 
} from './hooks/useDataGrid';

// Test data utilities
export {
  generateEmployees,
  generateProducts,
  generateOrders,
  employeeSchema,
  productSchema,
  orderSchema,
  MockStreamingProvider,
  type Employee,
  type Product,
  type Order,
} from './utils/testData';

// Types
export type {
  DataGridColumn,
  DataGridSchema,
  DataGridProps,
  DataGridState,
  StreamingDataProvider,
  TreeNode,
  GroupedData,
  SortingState,
  GroupingState,
  PaginationState,
  ColumnVisibilityState,
  ColumnOrderState,
  ColumnSizingState,
  DataGridTheme,
  FilterState,
  FilterDefinition,
} from './types';