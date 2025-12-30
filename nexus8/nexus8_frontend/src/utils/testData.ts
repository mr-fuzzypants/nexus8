import { faker } from '@faker-js/faker';
import { DataGridColumn, DataGridSchema } from '@/types';

// Sample data interfaces
export interface Employee {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  department: string;
  position: string;
  salary: number;
  startDate: Date;
  isActive: boolean;
  manager?: string;
  projects?: string[];
}

export interface Product {
  id: number;
  name: string;
  category: string;
  price: number;
  stock: number;
  description: string;
  rating: number;
  brand: string;
  isAvailable: boolean;
  tags: string[];
}

export interface Order {
  id: string;
  customerId: number;
  customerName: string;
  orderDate: Date;
  amount: number;
  status: 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled';
  items: Array<{
    productId: number;
    productName: string;
    quantity: number;
    price: number;
  }>;
  shippingAddress: string;
  paymentMethod: string;
}

// Data generators
export const generateEmployees = (count: number): Employee[] => {
  const departments = ['Engineering', 'Marketing', 'Sales', 'HR', 'Finance', 'Operations'];
  const positions = {
    Engineering: ['Software Engineer', 'Senior Engineer', 'Tech Lead', 'Principal Engineer'],
    Marketing: ['Marketing Specialist', 'Marketing Manager', 'Content Creator', 'SEO Specialist'],
    Sales: ['Sales Representative', 'Account Manager', 'Sales Director', 'Business Developer'],
    HR: ['HR Specialist', 'Recruiter', 'HR Manager', 'People Operations'],
    Finance: ['Financial Analyst', 'Accountant', 'Finance Manager', 'Controller'],
    Operations: ['Operations Specialist', 'Project Manager', 'Operations Manager', 'Coordinator'],
  };

  return Array.from({ length: count }, (_, index) => {
    const department = faker.helpers.arrayElement(departments);
    const position = faker.helpers.arrayElement(positions[department as keyof typeof positions]);
    
    return {
      id: index + 1,
      firstName: faker.person.firstName(),
      lastName: faker.person.lastName(),
      email: faker.internet.email(),
      department,
      position,
      salary: faker.number.int({ min: 40000, max: 200000 }),
      startDate: faker.date.past({ years: 10 }),
      isActive: faker.datatype.boolean(0.9),
      manager: faker.datatype.boolean(0.7) ? faker.person.fullName() : undefined,
      projects: faker.helpers.arrayElements([
        'Project Alpha', 'Project Beta', 'Project Gamma', 'Project Delta', 
        'Project Epsilon', 'Project Zeta'
      ], { min: 0, max: 3 }),
    };
  });
};

export const generateProducts = (count: number): Product[] => {
  const categories = ['Electronics', 'Clothing', 'Home & Garden', 'Sports', 'Books', 'Toys'];
  const brands = ['Apple', 'Samsung', 'Nike', 'Adidas', 'Sony', 'Microsoft', 'Amazon', 'Google'];

  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    name: faker.commerce.productName(),
    category: faker.helpers.arrayElement(categories),
    price: parseFloat(faker.commerce.price({ min: 10, max: 2000, dec: 2 })),
    stock: faker.number.int({ min: 0, max: 1000 }),
    description: faker.commerce.productDescription(),
    rating: parseFloat(faker.number.float({ min: 1, max: 5, multipleOf: 0.1 }).toFixed(1)),
    brand: faker.helpers.arrayElement(brands),
    isAvailable: faker.datatype.boolean(0.8),
    tags: faker.helpers.arrayElements([
      'featured', 'bestseller', 'new', 'sale', 'premium', 'eco-friendly'
    ], { min: 0, max: 3 }),
  }));
};

export const generateOrders = (count: number): Order[] => {
  const statuses: Order['status'][] = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
  const paymentMethods = ['credit-card', 'paypal', 'bank-transfer', 'apple-pay', 'google-pay'];

  return Array.from({ length: count }, (_, index) => {
    const itemCount = faker.number.int({ min: 1, max: 5 });
    const items = Array.from({ length: itemCount }, (_, itemIndex) => ({
      productId: faker.number.int({ min: 1, max: 1000 }),
      productName: faker.commerce.productName(),
      quantity: faker.number.int({ min: 1, max: 10 }),
      price: parseFloat(faker.commerce.price({ min: 10, max: 500, dec: 2 })),
    }));

    const amount = items.reduce((sum, item) => sum + (item.quantity * item.price), 0);

    return {
      id: `ORD-${String(index + 1).padStart(6, '0')}`,
      customerId: faker.number.int({ min: 1, max: 10000 }),
      customerName: faker.person.fullName(),
      orderDate: faker.date.recent({ days: 365 }),
      amount: parseFloat(amount.toFixed(2)),
      status: faker.helpers.arrayElement(statuses),
      items,
      shippingAddress: faker.location.streetAddress({ useFullAddress: true }),
      paymentMethod: faker.helpers.arrayElement(paymentMethods),
    };
  });
};

// Schema definitions for the sample data
export const employeeSchema: DataGridSchema<Employee> = {
  columns: [
    {
      id: 'id',
      accessorKey: 'id',
      header: 'ID',
      size: 80,
      enableSorting: true,
      enableHiding: false,
    },
    {
      id: 'firstName',
      accessorKey: 'firstName',
      header: 'First Name',
      size: 120,
      enableSorting: true,
      enableGrouping: true,
    },
    {
      id: 'lastName',
      accessorKey: 'lastName',
      header: 'Last Name',
      size: 120,
      enableSorting: true,
      enableGrouping: true,
    },
    {
      id: 'email',
      accessorKey: 'email',
      header: 'Email',
      size: 200,
      enableSorting: true,
    },
    {
      id: 'department',
      accessorKey: 'department',
      header: 'Department',
      size: 130,
      enableSorting: true,
      enableGrouping: true,
    },
    {
      id: 'position',
      accessorKey: 'position',
      header: 'Position',
      size: 150,
      enableSorting: true,
      enableGrouping: true,
    },
    {
      id: 'salary',
      accessorKey: 'salary',
      header: 'Salary',
      size: 100,
      enableSorting: true,
      meta: {
        type: 'number',
        format: (value: number) => `$${value.toLocaleString()}`,
        align: 'right',
      },
    },
    {
      id: 'startDate',
      accessorKey: 'startDate',
      header: 'Start Date',
      size: 120,
      enableSorting: true,
      meta: {
        type: 'date',
        format: (value: Date) => value.toLocaleDateString(),
      },
    },
    {
      id: 'isActive',
      accessorKey: 'isActive',
      header: 'Active',
      size: 80,
      enableSorting: true,
      meta: {
        type: 'boolean',
        format: (value: boolean) => value ? 'Yes' : 'No',
      },
    },
  ],
  enableMultiSort: true,
  enableGrouping: true,
  enableColumnOrdering: true,
  enableColumnResizing: true,
};

export const productSchema: DataGridSchema<Product> = {
  columns: [
    {
      id: 'id',
      accessorKey: 'id',
      header: 'ID',
      size: 80,
      enableSorting: true,
      enableHiding: false,
    },
    {
      id: 'name',
      accessorKey: 'name',
      header: 'Product Name',
      size: 200,
      enableSorting: true,
      enableGrouping: true,
    },
    {
      id: 'category',
      accessorKey: 'category',
      header: 'Category',
      size: 120,
      enableSorting: true,
      enableGrouping: true,
    },
    {
      id: 'brand',
      accessorKey: 'brand',
      header: 'Brand',
      size: 100,
      enableSorting: true,
      enableGrouping: true,
    },
    {
      id: 'price',
      accessorKey: 'price',
      header: 'Price',
      size: 100,
      enableSorting: true,
      meta: {
        type: 'number',
        format: (value: number) => `$${value.toFixed(2)}`,
        align: 'right',
      },
    },
    {
      id: 'stock',
      accessorKey: 'stock',
      header: 'Stock',
      size: 80,
      enableSorting: true,
      meta: {
        type: 'number',
        align: 'right',
      },
    },
    {
      id: 'rating',
      accessorKey: 'rating',
      header: 'Rating',
      size: 80,
      enableSorting: true,
      meta: {
        type: 'number',
        format: (value: number) => `${value}/5`,
        align: 'center',
      },
    },
    {
      id: 'isAvailable',
      accessorKey: 'isAvailable',
      header: 'Available',
      size: 90,
      enableSorting: true,
      meta: {
        type: 'boolean',
        format: (value: boolean) => value ? 'Yes' : 'No',
      },
    },
  ],
  enableMultiSort: true,
  enableGrouping: true,
  enableColumnOrdering: true,
  enableColumnResizing: true,
};

export const orderSchema: DataGridSchema<Order> = {
  columns: [
    {
      id: 'id',
      accessorKey: 'id',
      header: 'Order ID',
      size: 120,
      enableSorting: true,
      enableHiding: false,
    },
    {
      id: 'customerName',
      accessorKey: 'customerName',
      header: 'Customer',
      size: 150,
      enableSorting: true,
      enableGrouping: true,
    },
    {
      id: 'orderDate',
      accessorKey: 'orderDate',
      header: 'Order Date',
      size: 120,
      enableSorting: true,
      meta: {
        type: 'date',
        format: (value: Date) => value.toLocaleDateString(),
      },
    },
    {
      id: 'amount',
      accessorKey: 'amount',
      header: 'Amount',
      size: 100,
      enableSorting: true,
      meta: {
        type: 'number',
        format: (value: number) => `$${value.toFixed(2)}`,
        align: 'right',
      },
    },
    {
      id: 'status',
      accessorKey: 'status',
      header: 'Status',
      size: 100,
      enableSorting: true,
      enableGrouping: true,
    },
    {
      id: 'paymentMethod',
      accessorKey: 'paymentMethod',
      header: 'Payment',
      size: 120,
      enableSorting: true,
      enableGrouping: true,
    },
    {
      id: 'itemCount',
      accessorKey: 'items',
      header: 'Items',
      size: 80,
      enableSorting: true,
      cell: ({ getValue }) => {
        const items = getValue() as Order['items'];
        return items.length;
      },
      meta: {
        type: 'number',
        align: 'center',
      },
    },
  ],
  enableMultiSort: true,
  enableGrouping: true,
  enableColumnOrdering: true,
  enableColumnResizing: true,
};

// Streaming data provider implementation
export class MockStreamingProvider<T> {
  private data: T[];
  private currentIndex = 0;
  private batchSize: number;
  private subscribers: Array<(data: T[]) => void> = [];
  public isLoading = false;
  public hasMore = true;

  constructor(data: T[], batchSize: number = 100) {
    this.data = data;
    this.batchSize = batchSize;
  }

  subscribe(callback: (data: T[]) => void): () => void {
    this.subscribers.push(callback);
    
    // Send initial batch
    this.loadMore();

    return () => {
      const index = this.subscribers.indexOf(callback);
      if (index > -1) {
        this.subscribers.splice(index, 1);
      }
    };
  }

  async loadMore(): Promise<void> {
    if (this.isLoading || !this.hasMore) return;

    this.isLoading = true;

    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 1000));

    const nextBatch = this.data.slice(this.currentIndex, this.currentIndex + this.batchSize);
    
    if (nextBatch.length > 0) {
      this.currentIndex += nextBatch.length;
      this.subscribers.forEach(callback => callback(nextBatch));
    }

    this.hasMore = this.currentIndex < this.data.length;
    this.isLoading = false;
  }

  reset() {
    this.currentIndex = 0;
    this.hasMore = true;
  }
}
// DataGrid test data generators
const firstNames = ['John', 'Jane', 'Michael', 'Sarah', 'David', 'Emma', 'Robert', 'Lisa', 'William', 'Maria'];
const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez'];
const statuses = ['Active', 'Inactive', 'Pending', 'Archived'];
const departments = ['Engineering', 'Sales', 'Marketing', 'HR', 'Finance', 'Operations'];

export const generateDataGridRows = (count: number = 500): GridRow[] => {
  const rows: GridRow[] = [];

  for (let i = 0; i < count; i++) {
    const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
    const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
    const age = Math.floor(Math.random() * 50) + 20;
    const salary = Math.floor(Math.random() * 150000) + 40000;
    const startDate = new Date(
      2020 + Math.floor(Math.random() * 5),
      Math.floor(Math.random() * 12),
      Math.floor(Math.random() * 28) + 1
    ).toISOString().split('T')[0];

    rows.push({
      id: uuidv4(),
      data: {
        name: `${firstName} ${lastName}`,
        email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.com`,
        age,
        status: statuses[Math.floor(Math.random() * statuses.length)],
        salary,
        startDate,
        active: Math.random() > 0.3,
        department: departments[Math.floor(Math.random() * departments.length)],
      },
      metadata: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
  }

  return rows;
};

export const sampleDataGridData = generateDataGridRows(500);

