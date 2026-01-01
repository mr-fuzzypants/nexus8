import React, { useState } from 'react';
import {
  Box,
  Group,
  Text,
  Breadcrumbs,
  Anchor,
  ActionIcon,
  Tooltip,
  Paper,
  Button,
} from '@mantine/core';
import {
  IconArrowLeft,
  IconArrowRight,
  IconHome,
  IconChevronRight,
  IconSearch,
  IconPlus,
  IconSettings,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconLayout,
} from '@tabler/icons-react';
import { useDataStore, useKanbanViewStore } from '../../state';
import { useUndoRedo } from '../../state/useUndoRedo';
import { useResponsive } from '../../utils';
import { ColumnManagerModal } from './ColumnManagerModal';

interface NavigationBarProps {
  onNewCard?: () => void;
  onSearch?: () => void;
  className?: string;
  style?: React.CSSProperties;
}

export const NavigationBar: React.FC<NavigationBarProps> = ({
  onNewCard,
  onSearch,
  className,
  style,
}) => {
  const screenSize = useResponsive();
  const ui = useKanbanViewStore(state => state.ui);
  console.log('NavigationBar render, currentPath:', ui.currentPath);
  const viewActions = useKanbanViewStore(state => state.actions);
  const cards = useDataStore(state => state.cards);
  const { canUndo, canRedo, undo, redo, undoDescription, redoDescription } = useUndoRedo();
  const [columnManagerOpened, setColumnManagerOpened] = useState(false);
  
  const getBreadcrumbItems = (path: string) => {
    const parts = path.split('/').filter(Boolean);
    const items = [{ title: 'Home', path: 'root' }];
    
    let currentPath = '';
    parts.forEach((part, index) => {
      if (part === 'root') return;
      
      // If it's a card ID, look up the title
      const card = cards[part];
      const title = card ? card.title : part;
      
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      // Reconstruct full path for navigation
      // This logic assumes path structure is root/cardId/cardId...
      // But wait, path in store is parent path.
      // The currentPath in UI is the path we are viewing.
      // If we are viewing 'root', we see root cards.
      // If we are viewing 'root/card1', we see children of card1.
      
      // Let's reconstruct the path correctly.
      // The parts array contains the segments.
      // If path is 'root/A/B', parts are ['root', 'A', 'B'].
      // Item 0: Home (root)
      // Item 1: Card A (root/A)
      // Item 2: Card B (root/A/B)
      
      const itemPath = parts.slice(0, index + 1).join('/');
      items.push({ title, path: itemPath });
    });
    
    return items;
  };

  const breadcrumbItems = getBreadcrumbItems(ui.currentPath);
  
  const handleNavigateToPath = (path: string) => {
    viewActions.navigateToPath(path);
  };
  
  const handleGoBack = () => {
    viewActions.goBack();
  };
  
  const handleGoForward = () => {
    viewActions.goForward();
  };
  
  const canGoBack = ui.currentHistoryIndex > 0;
  const canGoForward = ui.currentHistoryIndex < ui.pathHistory.length - 1;
  
  return (
    <Paper
      className={className}
      style={style}
      p={screenSize.isMobile ? 'xs' : 'sm'}
      shadow="sm"
      withBorder
    >
      <Group justify="space-between" gap="md">
        {/* Navigation Controls */}
        <Group gap="xs">
          <Tooltip label="Back">
            <ActionIcon
              variant="subtle"
              onClick={handleGoBack}
              disabled={!canGoBack}
            >
              <IconArrowLeft size={16} />
            </ActionIcon>
          </Tooltip>
          
          <Tooltip label="Forward">
            <ActionIcon
              variant="subtle"
              onClick={handleGoForward}
              disabled={!canGoForward}
            >
              <IconArrowRight size={16} />
            </ActionIcon>
          </Tooltip>
          
          {/* Breadcrumbs */}
          <Box style={{ flex: 1 }}>
            <Breadcrumbs
              separator={<IconChevronRight size={12} />}
              separatorMargin={4}
            >
              {breadcrumbItems.map((item, index) => (
                <Anchor
                  key={item.path}
                  onClick={() => handleNavigateToPath(item.path)}
                  size={screenSize.isMobile ? 'sm' : 'md'}
                  style={{
                    fontWeight: index === breadcrumbItems.length - 1 ? 600 : 400,
                    color: index === breadcrumbItems.length - 1 
                      ? 'var(--mantine-color-text)' 
                      : 'var(--mantine-color-dimmed)',
                  }}
                >
                  {index === 0 ? (
                    <Group gap={4}>
                      <IconHome size={14} />
                      <Text size="inherit">{item.title}</Text>
                    </Group>
                  ) : (
                    item.title
                  )}
                </Anchor>
              ))}
            </Breadcrumbs>
          </Box>
        </Group>
        
        {/* Action Controls */}
        <Group gap="xs">
          {/* Undo/Redo Controls */}
          <Tooltip label={undoDescription || 'Nothing to undo'}>
            <ActionIcon
              variant="light"
              onClick={undo}
              disabled={!canUndo}
              color="blue"
            >
              <IconArrowBackUp size={16} />
            </ActionIcon>
          </Tooltip>
          
          <Tooltip label={redoDescription || 'Nothing to redo'}>
            <ActionIcon
              variant="light"
              onClick={redo}
              disabled={!canRedo}
              color="blue"
            >
              <IconArrowForwardUp size={16} />
            </ActionIcon>
          </Tooltip>
          
          <Tooltip label="Column Settings">
            <ActionIcon
              variant="light"
              onClick={() => setColumnManagerOpened(true)}
            >
              <IconLayout size={16} />
            </ActionIcon>
          </Tooltip>

          <Tooltip label="Global Settings">
            <ActionIcon
              variant="light"
              onClick={() => viewActions.setSettingsModalOpen(true)}
            >
              <IconSettings size={16} />
            </ActionIcon>
          </Tooltip>
          
          {onSearch && (
            <Tooltip label="Search">
              <ActionIcon
                variant="light"
                onClick={onSearch}
              >
                <IconSearch size={16} />
              </ActionIcon>
            </Tooltip>
          )}
          
          {onNewCard && (
            <Button
              leftSection={<IconPlus size={16} />}
              size={screenSize.isMobile ? 'sm' : 'md'}
              onClick={onNewCard}
            >
              New Card
            </Button>
          )}
        </Group>
      </Group>
      
      {/* Column Manager Modal */}
      <ColumnManagerModal
        opened={columnManagerOpened}
        onClose={() => setColumnManagerOpened(false)}
      />
    </Paper>
  );
};

export default NavigationBar;