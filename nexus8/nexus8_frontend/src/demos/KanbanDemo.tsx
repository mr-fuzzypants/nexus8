import { useEffect, useState, useMemo } from 'react';
import { AppShell, Box, Tabs } from '@mantine/core';
import {
  KanbanThemeProvider,
  KanbanBoard,
  NavigationBar,
  InfoPanel,
  SettingsModal,
} from '../components';
import { TreeTableDemo } from './TreeTableDemo';
import { ScaleDebugger } from '../components/ScaleDebugger';
import { UndoKeyboardShortcuts } from '../components/UndoKeyboardShortcuts';
import { UndoPerformanceMonitor } from '../components/UndoPerformanceMonitor';
import { useKanbanViewStore } from '../state';
import { useDataStore } from '../state/useDataStore';
import { useUndoIntegration } from '../hooks/useUndoIntegration';
import { generateLargeTestDataset, initialSampleCards, convertCardsToTreeNodes } from '../utils/demoData';
import { v4 as uuidv4 } from 'uuid';
import '../index.css';

export function KanbanDemo() {
  const ui = useKanbanViewStore(state => state.ui);
  const viewActions = useKanbanViewStore(state => state.actions);
  const { addCard } = useDataStore(state => state.actions);
  const cards = useDataStore(state => state.cards);
  
  const [activeTab, setActiveTab] = useState<string | null>('kanban');
  const [isLoadingData, setIsLoadingData] = useState(false);
  
  // Initialize undo/redo integration
  useUndoIntegration();

  // Convert cards to tree nodes for TreeTable
  const treeData = useMemo(() => convertCardsToTreeNodes(cards), [cards]);

  useEffect(() => {
    // Only initialize if empty
    if (Object.keys(cards).length > 0) return;

    // Initialize with some sample data including parent-child relationships
    const sampleCards = initialSampleCards;
    const createdCards: any[] = [];

    // Helper to create a card with defaults
    const createCard = (cardData: any) => {
        const id = `card-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const now = new Date().toISOString();
        const card = {
            ...cardData,
            id,
            createdAt: now,
            updatedAt: now,
            path: cardData.path || 'root',
            metadata: cardData.metadata || {},
            children: [],
        };
        addCard(card);
        createdCards.push(card);
        return id;
    };

    // Create sample cards first
    const createdCardIds = sampleCards.map(card => {
      return createCard(card);
    });

    // Add some child cards to demonstrate hierarchy
    if (createdCardIds.length > 0) {
      // Add child tasks to the Epic card
      const epicId = createdCardIds[0];
      const epicCard = createdCards.find(c => c.id === epicId);
      
      const createChild = (data: any) => {
          const childId = createCard({
              ...data,
              parentId: epicId,
              path: `${epicCard.path}/${epicId}`,
              status: data.status || epicCard.status,
          });
          // Update parent
          // Note: addCard doesn't automatically update parent's children array in this simple script
          // But useDataStore.reparentCard does. 
          // For initialization, we should probably just construct the objects correctly or use reparentCard.
          // Let's use reparentCard from the store if available, but we are inside useEffect.
          // Actually, let's just manually update the parent in the store for this init script
          // OR better, use the store action reparentCard after adding.
          useDataStore.getState().actions.reparentCard(childId, epicId);
      };
      
      createChild({
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
      
      createChild({
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
      
      createChild({
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
      const dashboardCard = createdCards.find(c => c.id === dashboardId);
      
      const createDashboardChild = (data: any) => {
          const childId = createCard({
              ...data,
              parentId: dashboardId,
              path: `${dashboardCard.path}/${dashboardId}`,
              status: data.status || dashboardCard.status,
          });
          useDataStore.getState().actions.reparentCard(childId, dashboardId);
      };

      createDashboardChild({
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
  }, [cards, addCard]);

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
          addCard(card);
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
  }, [addCard, isLoadingData]);


  const handleNewCard = (status: string) => {
    addCard({
      id: uuidv4(),
      title: 'New Card',
      description: 'Enter card description',
      status,
      path: ui.currentPath,
      metadata: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  };

  const handleCardClick = (card: any) => {
    viewActions.setSelectedCardId(card.id);
    if (!ui.infoPanelOpen) {
        viewActions.toggleInfoPanel();
    }
  };

  const handleSearch = () => {
    viewActions.setSearchModalOpen(true);
  };

  return (
    <KanbanThemeProvider>
      <UndoKeyboardShortcuts />
      {ui.showPerformanceMonitor && <UndoPerformanceMonitor />}
      
      <SettingsModal
        opened={ui.settingsModalOpen}
        onClose={() => viewActions.setSettingsModalOpen(false)}
        showPerformanceMonitor={ui.showPerformanceMonitor}
        onTogglePerformanceMonitor={viewActions.setShowPerformanceMonitor}
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
            <Tabs value={activeTab} onChange={setActiveTab} h="calc(100% - 60px)">
              <Tabs.List>
                <Tabs.Tab value="kanban">Kanban Board</Tabs.Tab>
                <Tabs.Tab value="treetable">Tree Table</Tabs.Tab>
              </Tabs.List>

              <Tabs.Panel value="kanban" pt="md" h="calc(100% - 50px)">
                <KanbanBoard
                  onCardClick={handleCardClick}
                  onNewCard={handleNewCard}
                  onSettingsClick={() => viewActions.setSettingsModalOpen(true)}
                  onFilterClick={() => console.log('Filter clicked')}
                  onSearchClick={handleSearch}
                />
              </Tabs.Panel>

              <Tabs.Panel value="treetable" h="calc(100% - 50px)">
                <TreeTableDemo data={treeData} />
              </Tabs.Panel>
            </Tabs>
          </Box>
        </AppShell.Main>

        {ui.infoPanelOpen && (
          <AppShell.Aside>
            <InfoPanel />
          </AppShell.Aside>
        )}
      </AppShell>
    </KanbanThemeProvider>
  );
}
