import React, { useState, useMemo } from 'react';
import {
  MantineProvider,
  AppShell,
  Container,
  Title,
  Tabs,
  Box,
  Group,
  Switch,
  Button,
  NumberInput,
  Badge,
  Stack,
  Text,
  Paper,
  useMantineColorScheme,
} from '@mantine/core';
import { IconSun, IconMoon, IconRefresh } from '@tabler/icons-react';

import { DataGrid } from './components/DataGrid/DataGrid';
import {
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
import type { DataGridSchema } from './types';

// Demo component for the DataGrid
const DataGridDemo: React.FC = () => {
  const { colorScheme, toggleColorScheme } = useMantineColorScheme();
  const [rowCount, setRowCount] = useState(1000);
  const [enableVirtualization, setEnableVirtualization] = useState(true);
  const [activeTab, setActiveTab] = useState('employees');
  const [enableGrouping, setEnableGrouping] = useState(false);

  // Generate test data
  const employees = useMemo(() => generateEmployees(rowCount), [rowCount]);
  const products = useMemo(() => generateProducts(rowCount), [rowCount]);
  const orders = useMemo(() => generateOrders(Math.min(rowCount, 500)), [rowCount]);

  // Debug data generation
  // console.log('App Data Generation:', {
  //   employeesLength: employees.length,
  //   productsLength: products.length,
  //   ordersLength: orders.length,
  //   rowCount,
  //   activeTab,
  //   enableGrouping
  // });

  // Create schemas with conditional grouping
  const employeeSchemaWithGrouping = useMemo(() => ({
    ...employeeSchema,
    defaultGrouping: enableGrouping ? ['department'] : [],
  }), [enableGrouping]);

  const productSchemaWithGrouping = useMemo(() => ({
    ...productSchema,
    defaultGrouping: enableGrouping ? ['category'] : [],
  }), [enableGrouping]);

  const orderSchemaWithGrouping = useMemo(() => ({
    ...orderSchema,
    defaultGrouping: enableGrouping ? ['status'] : [],
  }), [enableGrouping]);

  // Streaming data provider
  const streamingProvider = useMemo(
    () => new MockStreamingProvider(employees, 50),
    [employees]
  );

  const handleRefreshData = () => {
    // Regenerate data by changing the rowCount and setting it back
    const currentCount = rowCount;
    setRowCount(0);
    setTimeout(() => setRowCount(currentCount), 10);
  };

  const renderDataGrid = () => {
    switch (activeTab) {
      case 'employees':
        return (
          <DataGrid<Employee>
            data={employees}
            schema={employeeSchemaWithGrouping}
            enableVirtualization={enableVirtualization}
            height="600px"
            onRowClick={(row) => console.log('Row clicked:', row)}
            onRowDoubleClick={(row) => console.log('Row double-clicked:', row)}
            onStateChange={(state) => console.log('State changed:', state)}
          />
        );
      
      case 'products':
        return (
          <DataGrid<Product>
            data={products}
            schema={productSchemaWithGrouping}
            enableVirtualization={enableVirtualization}
            height="600px"
            onRowClick={(row) => console.log('Product clicked:', row)}
          />
        );
      
      case 'orders':
        return (
          <DataGrid<Order>
            data={orders}
            schema={orderSchemaWithGrouping}
            enableVirtualization={enableVirtualization}
            height="600px"
            onRowClick={(row) => console.log('Order clicked:', row)}
          />
        );
      
      case 'streaming':
        return (
          <StreamingDataDemo provider={streamingProvider} schema={employeeSchemaWithGrouping} />
        );
      
      default:
        return null;
    }
  };

  return (
    <Container size="xl" py="md" style={{ backgroundColor: 'transparent' }}>
      <Stack gap="lg">
        {/* Header */}
        <Paper p="md" radius="md" withBorder style={{ backgroundColor: 'white' }}>
          <Group justify="space-between" align="center">
            <Box>
              <Title order={1} size="h2" c="gray.8">Nexus8 DataGrid</Title>
              <Text size="sm" c="dimmed">Enterprise-grade data grid with Kendo UI styling</Text>
            </Box>
            <Group gap="md">
              <Switch
                checked={colorScheme === 'dark'}
                onChange={toggleColorScheme}
                label={colorScheme === 'dark' ? 'Dark Mode' : 'Light Mode'}
                thumbIcon={
                  colorScheme === 'dark' ? (
                    <IconMoon size={12} />
                  ) : (
                    <IconSun size={12} />
                  )
                }
              />
            </Group>
          </Group>
        </Paper>

        {/* Controls */}
        <Paper p="md" withBorder radius="md" style={{ backgroundColor: 'white' }}>
          <Group gap="lg" align="center">
            <NumberInput
              label="Dataset Size"
              value={rowCount}
              onChange={(value) => setRowCount(Number(value) || 100)}
              min={100}
              max={10000}
              step={100}
              w={140}
              styles={{
                label: { fontSize: 13, fontWeight: 600, color: '#333' }
              }}
            />
            
            <Switch
              label="Virtual Scrolling"
              checked={enableVirtualization}
              onChange={(event) => setEnableVirtualization(event.currentTarget.checked)}
              styles={{
                label: { fontSize: 13, fontWeight: 600, color: '#333' }
              }}
            />

            <Switch
              label="Enable Grouping"
              checked={enableGrouping}
              onChange={(event) => setEnableGrouping(event.currentTarget.checked)}
              styles={{
                label: { fontSize: 13, fontWeight: 600, color: '#333' }
              }}
            />

            <Button
              leftSection={<IconRefresh size={16} />}
              onClick={handleRefreshData}
              variant="light"
              color="blue"
              size="sm"
            >
              Refresh Data
            </Button>

            <Badge 
              color={enableVirtualization ? "green" : "orange"} 
              variant="light"
              size="md"
            >
              {enableVirtualization ? 'High Performance' : 'Standard Mode'}
            </Badge>

            {enableGrouping && (
              <Badge color="purple" variant="light" size="md">
                🌳 Grouped View
              </Badge>
            )}
          </Group>
        </Paper>

        {/* Tabs */}
        <Paper withBorder radius="md" style={{ backgroundColor: 'white', overflow: 'hidden' }}>
          <Tabs value={activeTab} onChange={(value) => setActiveTab(value || 'employees')}>
            <Tabs.List style={{ backgroundColor: '#f8f8f8', borderBottom: '1px solid #d7d7d7' }}>
              <Tabs.Tab value="employees" style={{ fontWeight: 600 }}>
                👥 Employees ({employees.length.toLocaleString()})
              </Tabs.Tab>
              <Tabs.Tab value="products" style={{ fontWeight: 600 }}>
                📦 Products ({products.length.toLocaleString()})
              </Tabs.Tab>
              <Tabs.Tab value="orders" style={{ fontWeight: 600 }}>
                🛒 Orders ({orders.length.toLocaleString()})
              </Tabs.Tab>
              <Tabs.Tab value="streaming" style={{ fontWeight: 600 }}>
                📡 Streaming Demo
              </Tabs.Tab>
            </Tabs.List>

            <Box p="md" style={{ backgroundColor: 'white' }}>
              {renderDataGrid()}
            </Box>
          </Tabs>
        </Paper>

        {/* Features Info */}
        <Paper p="lg" withBorder radius="md" style={{ backgroundColor: 'white' }}>
          <Title order={3} mb="md" c="gray.8">✨ Enterprise Features</Title>
          <Group gap="md" wrap="wrap">
            <Badge color="blue" size="md" variant="light">🚀 Virtual Scrolling</Badge>
            <Badge color="green" size="md" variant="light">🔄 Multi-Column Sort</Badge>
            <Badge color="purple" size="md" variant="light">📏 Column Resizing</Badge>
            <Badge color="orange" size="md" variant="light">👁️ Column Management</Badge>
            <Badge color="cyan" size="md" variant="light">🔄 Drag & Drop Reorder</Badge>
            <Badge color="red" size="md" variant="light">🌳 Hierarchical Grouping</Badge>
            <Badge color="pink" size="md" variant="light">🎨 Kendo UI Styling</Badge>
            <Badge color="teal" size="md" variant="light">📡 Progressive Loading</Badge>
            <Badge color="indigo" size="md" variant="light">🌙 Dark/Light Themes</Badge>
            <Badge color="gray" size="md" variant="light">📝 TypeScript Ready</Badge>
          </Group>
          
          <Box mt="md" p="md" style={{ backgroundColor: '#f8f9fa', borderRadius: 8 }}>
            <Text size="sm" c="dimmed" ta="center">
              🏆 Production-ready DataGrid with enterprise performance • 
              Handles 100,000+ rows • Built with React 18 & TanStack Table v8
            </Text>
            <Text size="xs" c="dimmed" ta="center" mt="xs">
              💡 Try enabling grouping and clicking the + buttons to expand grouped data! 
              Use column headers to sort, resize columns by dragging borders, and manage column visibility.
            </Text>
          </Box>
        </Paper>
      </Stack>
    </Container>
  );
};

// Streaming data demo component
const StreamingDataDemo: React.FC<{ 
  provider: MockStreamingProvider<Employee>;
  schema: DataGridSchema<Employee>;
}> = ({ 
  provider,
  schema 
}) => {
  const [streamingData, setStreamingData] = useState<Employee[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);

  const startStreaming = () => {
    if (isStreaming) return;
    
    setIsStreaming(true);
    setStreamingData([]);
    provider.reset();
    
    provider.subscribe((newData) => {
      setStreamingData((prev) => [...prev, ...newData]);
    });
  };

  const loadMore = async () => {
    await provider.loadMore();
  };

  return (
    <Stack gap="md">
      <Group gap="md">
        <Button onClick={startStreaming} disabled={isStreaming}>
          Start Streaming
        </Button>
        <Button 
          onClick={loadMore} 
          disabled={!isStreaming || provider.isLoading || !provider.hasMore}
          loading={provider.isLoading}
        >
          Load More
        </Button>
        <Text size="sm" c="dimmed">
          Loaded: {streamingData.length} rows
          {provider.hasMore ? ' (More available)' : ' (Complete)'}
        </Text>
      </Group>

      <DataGrid<Employee>
        data={streamingData}
        schema={schema}
        enableVirtualization={true}
        height="500px"
        loading={provider.isLoading}
      />
    </Stack>
  );
};

// Main App component with Kendo-style demo
const App: React.FC = () => {
  return (
    <MantineProvider defaultColorScheme="light">
      <AppShell
        styles={{
          main: {
            backgroundColor: '#f5f5f5',
            padding: 0,
          }
        }}
      >
        <AppShell.Main>
          <Box p="xl">
            <DataGridDemo />
          </Box>
        </AppShell.Main>
      </AppShell>
    </MantineProvider>
  );
};

export default App;