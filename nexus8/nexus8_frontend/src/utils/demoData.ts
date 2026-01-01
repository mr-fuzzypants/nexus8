import { KanbanCard } from '../schema';
import { TreeNode } from '../state/useTreeGridStore';

export function generateLargeTestDataset(count: number): KanbanCard[] {
  const statuses = ['backlog', 'todo', 'inprogress', 'review', 'done'];
  const priorities = ['low', 'medium', 'high', 'urgent'];
  const assignees = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace', 'Henry'];
  
  const cards: KanbanCard[] = [];
  
  for (let i = 0; i < count; i++) {
    const hasParent = i > 0 && Math.random() > 0.7; // 30% chance of having a parent
    const parentIndex = hasParent ? Math.floor(Math.random() * i) : undefined;
    const parentId = parentIndex !== undefined ? `card-${parentIndex}` : undefined;
    
    cards.push({
      id: `card-${i}`,
      title: `Task ${i}: ${['Implement', 'Fix', 'Update', 'Refactor', 'Test'][i % 5]} Feature`,
      description: `Description for task ${i}`,
      status: statuses[Math.floor(Math.random() * statuses.length)],
      imageUrl: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=300&h=160&fit=crop',
      path: parentId && parentIndex !== undefined ? `${cards[parentIndex].path}/card-${i}` : `root`,
      parentId: parentId,
      metadata: {
        priority: priorities[Math.floor(Math.random() * priorities.length)],
        assignee: assignees[Math.floor(Math.random() * assignees.length)],
        tags: [`tag-${i % 10}`, `category-${i % 5}`],
        progress: Math.floor(Math.random() * 101),
        dueDate: new Date(Date.now() + Math.random() * 90 * 24 * 60 * 60 * 1000).toISOString(),
      },
      createdAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
  
  return cards;
}

export function convertCardsToTreeNodes(cards: Record<string, KanbanCard>): TreeNode[] {
  const nodes: Record<string, TreeNode> = {};
  const rootNodes: TreeNode[] = [];

  // First pass: Create nodes
  Object.values(cards).forEach(card => {
    nodes[card.id] = {
      id: card.id,
      data: {
        ...card,
        // Flatten metadata for easier grid display if needed
        priority: card.metadata?.priority,
        assignee: card.metadata?.assignee,
        progress: card.metadata?.progress,
        dueDate: card.metadata?.dueDate,
        tags: card.metadata?.tags,
      },
      children: [],
      parentId: card.parentId || null,
    };
  });

  // Second pass: Build hierarchy
  Object.values(nodes).forEach(node => {
    if (node.parentId && nodes[node.parentId]) {
      nodes[node.parentId].children?.push(node);
    } else {
      rootNodes.push(node);
    }
  });

  return rootNodes;
}

export const initialSampleCards: Partial<KanbanCard>[] = [
  {
    title: 'Epic: User Authentication System',
    description: 'Implement complete user authentication with login, registration, and password reset',
    status: 'todo',
    path: 'root',
    imageUrl: 'https://images.unsplash.com/photo-1555949963-ff9fe0c870eb?w=300&h=160&fit=crop',
    metadata: {
      priority: 'high',
      tags: ['epic', 'security'],
      progress: 15,
      assignee: 'john',
    },
  },
  {
    title: 'Feature: Dashboard Analytics',
    description: 'Build analytics dashboard with charts and metrics',
    status: 'inprogress',
    path: 'root',
    imageUrl: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=300&h=160&fit=crop',
    metadata: {
      priority: 'medium',
      tags: ['feature', 'analytics'],
      progress: 60,
      assignee: 'jane',
    },
  },
  {
    title: 'Bug Fix: Navigation Menu',
    description: 'Fix mobile navigation menu collapsing issues',
    status: 'done',
    path: 'root',
    imageUrl: 'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=300&h=160&fit=crop',
    metadata: {
      priority: 'high',
      tags: ['bug', 'ui'],
      progress: 100,
      assignee: 'bob',
    },
  },
  {
    title: 'Research: Performance Optimization',
    description: 'Research and document performance optimization strategies',
    status: 'review',
    path: 'root',
    imageUrl: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=300&h=160&fit=crop',
    metadata: {
      priority: 'low',
      tags: ['research', 'performance'],
      progress: 40,
      assignee: 'jane',
    },
  },
];
