import { useEffect, useState } from 'react';
import { AppShell, Box, Tabs } from '@mantine/core';
import {
  KanbanThemeProvider,
  KanbanBoard,
  NavigationBar,
  InfoPanel,
  SettingsModal,
} from './components';
import { ScaleDebugger } from './components/ScaleDebugger';
import { UndoKeyboardShortcuts } from './components/UndoKeyboardShortcuts';
import { UndoPerformanceMonitor } from './components/UndoPerformanceMonitor';
import { useKanbanStore } from './state';
import { useUndoIntegration } from './hooks/useUndoIntegration';
import type { KanbanCard } from './schema';
import './index.css';

// Generate large test dataset for performance testing
function generateLargeTestDataset(count: number): KanbanCard[] {
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

function App() {
  const { ui, actions } = useKanbanStore();
  const [activeTab, setActiveTab] = useState<string | null>('kanban');
  const [isLoadingData, setIsLoadingData] = useState(false);
  
  // Initialize undo/redo integration
  useUndoIntegration();

  useEffect(() => {
    // Initialize with some sample data including parent-child relationships
    const sampleCards = [
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

    // Create sample cards first
    const createdCardIds = sampleCards.map(card => {
      return actions.createCard(card);
    });

    // Add some child cards to demonstrate hierarchy
    if (createdCardIds.length > 0) {
      // Add child tasks to the Epic card
      const epicId = createdCardIds[0];
      
      actions.createChildCard(epicId, {
        title: 'Task: Design Login UI',
        description: 'Create wireframes and mockups for login interface',
        status: 'todo',
        metadata: {
          priority: 'medium',
          tags: ['task', 'design'],
          progress: 80,
          assignee: 'jane',
        },
      });
      
      actions.createChildCard(epicId, {
        title: 'Task: Implement JWT Authentication',
        description: 'Backend implementation for JWT token-based auth',
        status: 'inprogress',
        metadata: {
          priority: 'high',
          tags: ['task', 'backend'],
          progress: 30,
          assignee: 'john',
        },
      });
      
      actions.createChildCard(epicId, {
        title: 'Task: Password Reset Flow',
        description: 'Implement forgot password and reset functionality',
        status: 'todo',
        metadata: {
          priority: 'medium',
          tags: ['task', 'security'],
          progress: 0,
          assignee: 'bob',
        },
      });

      // Add a child to the Dashboard feature
      const dashboardId = createdCardIds[1];
      
      actions.createChildCard(dashboardId, {
        title: 'Subtask: Chart Component',
        description: 'Build reusable chart components using recharts',
        status: 'inprogress',
        metadata: {
          priority: 'high',
          tags: ['subtask', 'component'],
          progress: 90,
          assignee: 'jane',
        },
      });
    }
  }, [actions]);

  // Generate large test dataset
  useEffect(() => {
    const ENABLE_LARGE_DATASET = false; // Set to true to test with large dataset
    const DATASET_SIZE = 100; // Reasonable size for testing (reduced from 10k)
    
    if (ENABLE_LARGE_DATASET && !isLoadingData) {
      setIsLoadingData(true);
      console.log(`Generating ${DATASET_SIZE} test cards...`);
      const largeDataset = generateLargeTestDataset(DATASET_SIZE);
      
      // Batch the additions to prevent UI blocking - smaller batches for better responsiveness
      const BATCH_SIZE = 20;
      let index = 0;
      
      const addBatch = () => {
        const batch = largeDataset.slice(index, index + BATCH_SIZE);
        
        batch.forEach(card => {
          const { id, createdAt, updatedAt, ...cardData } = card;
          actions.createCard(cardData);
        });
        
        index += BATCH_SIZE;
        
        if (index < largeDataset.length) {
          // Continue with next batch - add small delay for better UI responsiveness
          setTimeout(addBatch, 10);
        } else {
          console.log(`Added ${DATASET_SIZE} cards to the store`);
          setIsLoadingData(false);
        }
      };
      
      // Start adding cards
      setTimeout(addBatch, 0);
    }
  }, [actions]);


  const handleNewCard = (status: string) => {
    actions.createCard({
      title: 'New Card',
      description: 'Enter card description',
      status,
      path: ui.currentPath,
      metadata: {},
    });
  };

  const handleCardClick = (card: any) => {
    actions.selectCard(card.id);
    actions.setInfoPanelOpen(true);
  };

  const handleSearch = () => {
    actions.openSearch();
  };

  return (
    <KanbanThemeProvider>
      <UndoKeyboardShortcuts />
      {ui.showPerformanceMonitor && <UndoPerformanceMonitor />}
      
      <SettingsModal
        opened={ui.settingsModalOpen}
        onClose={() => actions.closeSettings()}
        showPerformanceMonitor={ui.showPerformanceMonitor}
        onTogglePerformanceMonitor={actions.setShowPerformanceMonitor}
      />
      
      <AppShell
        header={{ height: 60 }}
        aside={{
          width: ui.infoPanelOpen ? ui.infoPanelWidth : 0,
          breakpoint: 'sm',
          collapsed: { mobile: !ui.infoPanelOpen },
        }}
        padding={0}
      >
        <AppShell.Header>
          <NavigationBar
            onNewCard={() => handleNewCard('todo')}
            onSearch={handleSearch}
          />
        </AppShell.Header>

        <AppShell.Main>
          <Box h="100vh" pt={60}>
            <ScaleDebugger />
            <Tabs value={activeTab} onChange={setActiveTab}>
              <Tabs.List>
                <Tabs.Tab value="kanban">Kanban Board</Tabs.Tab>
              </Tabs.List>

              <Tabs.Panel value="kanban" pt="md">
                <KanbanBoard
                  onCardClick={handleCardClick}
                  onNewCard={handleNewCard}
                  onSettingsClick={() => actions.openSettings()}
                  onFilterClick={() => console.log('Filter clicked')}
                  onSearchClick={handleSearch}
                />
              </Tabs.Panel>
            </Tabs>
          </Box>
        </AppShell.Main>

        {ui.infoPanelOpen && (
          <AppShell.Aside>
            <InfoPanel onClose={() => actions.setInfoPanelOpen(false)} />
          </AppShell.Aside>
        )}
      </AppShell>
    </KanbanThemeProvider>
  );
}

export default App;