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
} from '@tabler/icons-react';
import { useKanbanStore } from '../../state';
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
  const { ui, getBreadcrumbItems, actions } = useKanbanStore();
  const { canUndo, canRedo, undo, redo, undoDescription, redoDescription } = useUndoRedo();
  const [columnManagerOpened, setColumnManagerOpened] = useState(false);
  
  const breadcrumbItems = getBreadcrumbItems(ui.currentPath);
  
  const handleNavigateToPath = (path: string) => {
    actions.navigateToPath(path);
  };
  
  const handleGoBack = () => {
    actions.goBack();
  };
  
  const handleGoForward = () => {
    actions.goForward();
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
                      <Text size="inherit">{item.label}</Text>
                    </Group>
                  ) : (
                    item.label
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