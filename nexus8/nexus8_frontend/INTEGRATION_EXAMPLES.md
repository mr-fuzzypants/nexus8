# Nexus8 DataGrid Integration Examples

This document shows how to integrate the DataGrid with various backends and data sources.

## Basic Integration with REST API

```tsx
import React, { useState, useEffect } from 'react';
import { DataGrid } from './components/DataGrid/DataGrid';
import type { DataGridSchema } from './types';

interface User {
  id: number;
  name: string;
  email: string;
  department: string;
  createdAt: string;
}

const userSchema: DataGridSchema<User> = {
  columns: [
    { id: 'id', accessorKey: 'id', header: 'ID', size: 80 },
    { id: 'name', accessorKey: 'name', header: 'Name', size: 200 },
    { id: 'email', accessorKey: 'email', header: 'Email', size: 250 },
    { id: 'department', accessorKey: 'department', header: 'Department', size: 150 },
    { 
      id: 'createdAt', 
      accessorKey: 'createdAt', 
      header: 'Created', 
      size: 120,
      meta: {
        type: 'date',
        format: (value) => new Date(value).toLocaleDateString(),
      },
    },
  ],
  enableMultiSort: true,
  enableGrouping: true,
};

function UsersTable() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch('/api/users');
      if (!response.ok) throw new Error('Failed to fetch users');
      const data = await response.json();
      setUsers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  if (error) {
    return (
      <DataGrid
        data={[]}
        schema={userSchema}
        errorState={
          <div>
            <p>Error: {error}</p>
            <button onClick={fetchUsers}>Retry</button>
          </div>
        }
      />
    );
  }

  return (
    <DataGrid
      data={users}
      schema={userSchema}
      loading={loading}
      height="600px"
      onRowClick={(user) => console.log('Selected user:', user)}
    />
  );
}
```

## Integration with GraphQL

```tsx
import React from 'react';
import { useQuery, gql } from '@apollo/client';
import { DataGrid } from './components/DataGrid/DataGrid';

const GET_PRODUCTS = gql`
  query GetProducts($limit: Int, $offset: Int, $sortBy: String, $sortOrder: String) {
    products(limit: $limit, offset: $offset, sortBy: $sortBy, sortOrder: $sortOrder) {
      id
      name
      price
      category
      inStock
      createdAt
    }
  }
`;

function ProductsTable() {
  const { data, loading, error, refetch } = useQuery(GET_PRODUCTS, {
    variables: { limit: 100, offset: 0 },
  });

  const handleStateChange = (state: any) => {
    const sortBy = state.sorting?.[0]?.id;
    const sortOrder = state.sorting?.[0]?.desc ? 'DESC' : 'ASC';
    
    refetch({
      sortBy,
      sortOrder,
    });
  };

  return (
    <DataGrid
      data={data?.products || []}
      schema={productSchema}
      loading={loading}
      onStateChange={handleStateChange}
    />
  );
}
```

## Server-Side Pagination & Filtering

```tsx
import React, { useState, useCallback } from 'react';
import { DataGrid } from './components/DataGrid/DataGrid';
import { useDataGridState } from './hooks/useDataGrid';

function ServerDataGrid() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [state, updateState] = useDataGridState({
    pagination: { pageIndex: 0, pageSize: 50 },
  });

  const fetchData = useCallback(async (params: any) => {
    setLoading(true);
    try {
      const queryParams = new URLSearchParams({
        page: params.pagination.pageIndex.toString(),
        limit: params.pagination.pageSize.toString(),
        ...(params.sorting.length > 0 && {
          sortBy: params.sorting[0].id,
          sortOrder: params.sorting[0].desc ? 'desc' : 'asc',
        }),
        ...(params.globalFilter && { search: params.globalFilter }),
      });

      const response = await fetch(`/api/data?${queryParams}`);
      const result = await response.json();
      
      setData(result.data);
      setTotalCount(result.total);
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleStateChange = useCallback((newState: any) => {
    updateState(newState);
    fetchData({ ...state, ...newState });
  }, [state, updateState, fetchData]);

  return (
    <div>
      <DataGrid
        data={data}
        schema={yourSchema}
        loading={loading}
        onStateChange={handleStateChange}
      />
      
      {/* Custom Pagination */}
      <div>
        <span>
          Showing {data.length} of {totalCount} records
        </span>
        <button 
          onClick={() => handleStateChange({
            pagination: { 
              ...state.pagination, 
              pageIndex: state.pagination.pageIndex - 1 
            }
          })}
          disabled={state.pagination.pageIndex === 0}
        >
          Previous
        </button>
        <button 
          onClick={() => handleStateChange({
            pagination: { 
              ...state.pagination, 
              pageIndex: state.pagination.pageIndex + 1 
            }
          })}
          disabled={data.length < state.pagination.pageSize}
        >
          Next
        </button>
      </div>
    </div>
  );
}
```

## Real-time Data with WebSockets

```tsx
import React, { useState, useEffect } from 'react';
import { DataGrid } from './components/DataGrid/DataGrid';

function RealTimeDataGrid() {
  const [data, setData] = useState([]);
  const [connectionStatus, setConnectionStatus] = useState('connecting');

  useEffect(() => {
    const ws = new WebSocket('ws://localhost:8080/data-stream');
    
    ws.onopen = () => {
      setConnectionStatus('connected');
    };
    
    ws.onmessage = (event) => {
      const update = JSON.parse(event.data);
      
      switch (update.type) {
        case 'INITIAL_DATA':
          setData(update.data);
          break;
          
        case 'INSERT':
          setData(prev => [...prev, update.record]);
          break;
          
        case 'UPDATE':
          setData(prev => 
            prev.map(item => 
              item.id === update.record.id ? update.record : item
            )
          );
          break;
          
        case 'DELETE':
          setData(prev => prev.filter(item => item.id !== update.id));
          break;
      }
    };
    
    ws.onclose = () => {
      setConnectionStatus('disconnected');
    };
    
    ws.onerror = () => {
      setConnectionStatus('error');
    };

    return () => {
      ws.close();
    };
  }, []);

  return (
    <div>
      <div>Status: {connectionStatus}</div>
      <DataGrid
        data={data}
        schema={yourSchema}
        height="600px"
      />
    </div>
  );
}
```

## Integration with State Management (Zustand)

```tsx
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

interface DataGridStore {
  data: any[];
  loading: boolean;
  error: string | null;
  filters: Record<string, any>;
  sorting: any[];
  pagination: { page: number; size: number };
  
  setData: (data: any[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  updateFilters: (filters: Record<string, any>) => void;
  updateSorting: (sorting: any[]) => void;
  updatePagination: (pagination: { page: number; size: number }) => void;
  fetchData: () => Promise<void>;
}

const useDataGridStore = create<DataGridStore>()(
  immer((set, get) => ({
    data: [],
    loading: false,
    error: null,
    filters: {},
    sorting: [],
    pagination: { page: 0, size: 50 },
    
    setData: (data) => set((state) => { state.data = data; }),
    setLoading: (loading) => set((state) => { state.loading = loading; }),
    setError: (error) => set((state) => { state.error = error; }),
    updateFilters: (filters) => set((state) => { state.filters = filters; }),
    updateSorting: (sorting) => set((state) => { state.sorting = sorting; }),
    updatePagination: (pagination) => set((state) => { state.pagination = pagination; }),
    
    fetchData: async () => {
      const state = get();
      set((draft) => { draft.loading = true; });
      
      try {
        const response = await fetch('/api/data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filters: state.filters,
            sorting: state.sorting,
            pagination: state.pagination,
          }),
        });
        
        const result = await response.json();
        set((draft) => {
          draft.data = result.data;
          draft.error = null;
        });
      } catch (error) {
        set((draft) => {
          draft.error = error instanceof Error ? error.message : 'Unknown error';
        });
      } finally {
        set((draft) => { draft.loading = false; });
      }
    },
  }))
);

function StoreConnectedDataGrid() {
  const {
    data,
    loading,
    error,
    updateSorting,
    updateFilters,
    fetchData,
  } = useDataGridStore();

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleStateChange = (state: any) => {
    if (state.sorting) updateSorting(state.sorting);
    if (state.globalFilter) updateFilters({ global: state.globalFilter });
    // Refetch data when state changes
    fetchData();
  };

  return (
    <DataGrid
      data={data}
      schema={yourSchema}
      loading={loading}
      onStateChange={handleStateChange}
      errorState={error ? <div>Error: {error}</div> : undefined}
    />
  );
}
```

## Custom Cell Renderers

```tsx
import React from 'react';
import { Badge, Avatar, Group, Text, ActionIcon } from '@mantine/core';
import { IconEdit, IconTrash } from '@tabler/icons-react';

const customSchema = {
  columns: [
    {
      id: 'avatar',
      accessorKey: 'avatar',
      header: 'Avatar',
      size: 80,
      cell: ({ row }) => (
        <Avatar
          src={row.original.avatarUrl}
          alt={row.original.name}
          size="sm"
          radius="xl"
        >
          {row.original.name.slice(0, 2)}
        </Avatar>
      ),
    },
    {
      id: 'status',
      accessorKey: 'status',
      header: 'Status',
      size: 100,
      cell: ({ getValue }) => {
        const status = getValue();
        const colors = {
          active: 'green',
          inactive: 'red',
          pending: 'yellow',
        };
        return <Badge color={colors[status]}>{status}</Badge>;
      },
    },
    {
      id: 'actions',
      header: 'Actions',
      size: 100,
      cell: ({ row }) => (
        <Group gap="xs">
          <ActionIcon
            size="sm"
            variant="subtle"
            onClick={(e) => {
              e.stopPropagation();
              console.log('Edit:', row.original);
            }}
          >
            <IconEdit size={14} />
          </ActionIcon>
          <ActionIcon
            size="sm"
            variant="subtle"
            color="red"
            onClick={(e) => {
              e.stopPropagation();
              console.log('Delete:', row.original);
            }}
          >
            <IconTrash size={14} />
          </ActionIcon>
        </Group>
      ),
    },
  ],
};
```

## Performance Optimization Tips

```tsx
// 1. Memoize expensive computations
const processedData = useMemo(() => {
  return rawData.map(item => ({
    ...item,
    computedField: expensiveComputation(item),
  }));
}, [rawData]);

// 2. Use stable references for handlers
const handleRowClick = useCallback((row) => {
  // Handle row click
}, []);

// 3. Optimize large datasets with virtualization
<DataGrid
  data={largeDataset}
  schema={schema}
  enableVirtualization={true}
  height="600px"
/>

// 4. Implement incremental loading for massive datasets
const { data, loadMore, hasMore } = useInfiniteQuery({
  queryKey: ['data'],
  queryFn: ({ pageParam = 0 }) => fetchData(pageParam),
  getNextPageParam: (lastPage, pages) => 
    lastPage.hasMore ? pages.length : undefined,
});
```