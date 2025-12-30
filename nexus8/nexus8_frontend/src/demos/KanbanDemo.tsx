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
import { useKanbanStore } from '../state';
import { useUndoIntegration } from '../hooks/useUndoIntegration';
import { generateLargeTestDataset, initialSampleCards, convertCardsToTreeNodes } from '../utils/demoData';
import '../index.css';

export function KanbanDemo() {
  const { ui, actions, cards } = useKanbanStore();
  const [activeTab, setActiveTab] = useState<string | null>('kanban');
  const [isLoadingData, setIsLoadingData] = useState(false);
  
  // Initialize undo/redo integration
  useUndoIntegration();

  // Convert cards to tree nodes for TreeTable
  const treeData = useMemo(() => convertCardsToTreeNodes(cards), [cards]);

  useEffect(() => {
    // Initialize with some sample data including parent-child relationships
    const sampleCards = initialSampleCards;

    // Create sample cards first
    const createdCardIds = sampleCards.map(card => {
      return actions.createCard(card as any);
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
            <Tabs value={activeTab} onChange={setActiveTab} h="calc(100% - 60px)">
              <Tabs.List>
                <Tabs.Tab value="kanban">Kanban Board</Tabs.Tab>
                <Tabs.Tab value="treetable">Tree Table</Tabs.Tab>
              </Tabs.List>

              <Tabs.Panel value="kanban" pt="md" h="calc(100% - 50px)">
                <KanbanBoard
                  onCardClick={handleCardClick}
                  onNewCard={handleNewCard}
                  onSettingsClick={() => actions.openSettings()}
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
            <InfoPanel onClose={() => actions.setInfoPanelOpen(false)} />
          </AppShell.Aside>
        )}
      </AppShell>
    </KanbanThemeProvider>
  );
}
