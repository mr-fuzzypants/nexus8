import React from 'react';
import {
  Box,
  Tabs,
  ScrollArea,
  Group,
  Text,
  Badge,
  ActionIcon,
  Divider,
  Stack,
  Paper,
  Progress,
  Table,
} from '@mantine/core';
import {
  IconX,
  IconFileText,
  IconTag,
  IconHistory,
  IconLink,
} from '@tabler/icons-react';
import { useKanbanStore } from '../../state';
import { useResponsive } from '../../utils';

interface InfoPanelProps {
  onClose?: () => void;
  className?: string;
  style?: React.CSSProperties;
}

export const InfoPanel: React.FC<InfoPanelProps> = ({
  onClose,
  className,
  style,
}) => {
  const screenSize = useResponsive();
  const { ui, selection, cards, infoPanelSchema, actions } = useKanbanStore();
  
  // Get selected card
  const selectedCard = selection.selectedCardId ? cards[selection.selectedCardId] : undefined;
  
  const handleTabChange = (tabId: string) => {
    actions.setInfoPanelTab(tabId);
  };
  
  if (!selectedCard) {
    return (
      <Paper
        className={className}
        style={style}
        h="100%"
        p="md"
        withBorder
      >
        <Stack align="center" justify="center" h="100%">
          <Text c="dimmed" ta="center">
            Select a card to view details
          </Text>
        </Stack>
      </Paper>
    );
  }
  
  return (
    <Paper
      className={className}
      style={style}
      h="100%"
      withBorder
    >
      {/* Header */}
      <Group justify="space-between" p="md" style={{ borderBottom: '1px solid var(--mantine-color-gray-3)' }}>
        <Text size="lg" fw={600}>Card Details</Text>
        {onClose && (
          <ActionIcon variant="subtle" onClick={onClose}>
            <IconX size={16} />
          </ActionIcon>
        )}
      </Group>
      
      {/* Tabs */}
      <Tabs
        value={ui.infoPanelActiveTab}
        onChange={(value) => value && handleTabChange(value)}
        orientation={screenSize.isMobile ? 'horizontal' : 'vertical'}
        style={{ height: 'calc(100% - 60px)' }}
      >
        <Tabs.List>
          {infoPanelSchema.tabs.map((tab) => (
            <Tabs.Tab
              key={tab.id}
              value={tab.id}
              leftSection={getTabIcon(tab.icon)}
            >
              {tab.label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        
        {/* Details Tab */}
        <Tabs.Panel value="details" p="md">
          <ScrollArea h="100%">
            <Stack gap="md">
              {/* Card Header */}
              <Box>
                <Text size="xl" fw={600} mb="xs">
                  {selectedCard.title}
                </Text>
                <Group gap="xs" mb="md">
                  <Badge
                    color={getPriorityColor(selectedCard.metadata?.priority)}
                    variant="light"
                    size="sm"
                  >
                    {selectedCard.metadata?.priority || 'Normal'}
                  </Badge>
                  <Badge variant="outline" size="sm">
                    {selectedCard.status}
                  </Badge>
                </Group>
                
                {selectedCard.description && (
                  <Text size="sm" c="dimmed">
                    {selectedCard.description}
                  </Text>
                )}
              </Box>
              
              <Divider />
              
              {/* Progress */}
              {selectedCard.metadata?.progress !== undefined && (
                <Box>
                  <Group justify="space-between" mb="xs">
                    <Text size="sm" fw={500}>Progress</Text>
                    <Text size="sm" c="dimmed">{selectedCard.metadata.progress}%</Text>
                  </Group>
                  <Progress value={selectedCard.metadata.progress} size="md" />
                </Box>
              )}
              
              {/* Due Date */}
              {selectedCard.metadata?.dueDate && (
                <Group grow>
                  <Box>
                    <Text size="sm" fw={500} mb="xs">Created</Text>
                    <Text size="sm" c="dimmed">
                      {new Date(selectedCard.createdAt).toLocaleDateString()}
                    </Text>
                  </Box>
                  
                  <Box>
                    <Text size="sm" fw={500} mb="xs">Due Date</Text>
                    <Text size="sm" c="dimmed">
                      {new Date(selectedCard.metadata.dueDate).toLocaleDateString()}
                    </Text>
                  </Box>
                </Group>
              )}
              
              {!selectedCard.metadata?.dueDate && (
                <Box>
                  <Text size="sm" fw={500} mb="xs">Created</Text>
                  <Text size="sm" c="dimmed">
                    {new Date(selectedCard.createdAt).toLocaleDateString()}
                  </Text>
                </Box>
              )}
              
              {/* Tags */}
              {selectedCard.metadata?.tags && Array.isArray(selectedCard.metadata.tags) && selectedCard.metadata.tags.length > 0 && (
                <Box>
                  <Text size="sm" fw={500} mb="xs">Tags</Text>
                  <Group gap="xs">
                    {selectedCard.metadata.tags.map((tag: string, index: number) => (
                      <Badge key={index} variant="light" size="sm">
                        {tag}
                      </Badge>
                    ))}
                  </Group>
                </Box>
              )}
            </Stack>
          </ScrollArea>
        </Tabs.Panel>
        
        {/* Metadata Tab */}
        <Tabs.Panel value="metadata" p="md">
          <ScrollArea h="100%">
            <Stack gap="md">
              <Text size="lg" fw={600}>Metadata</Text>
              
              {selectedCard.metadata && Object.keys(selectedCard.metadata).length > 0 ? (
                <Table>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Field</Table.Th>
                      <Table.Th>Value</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {Object.entries(selectedCard.metadata).map(([key, value]) => (
                      <Table.Tr key={key}>
                        <Table.Td>{key}</Table.Td>
                        <Table.Td>
                          {typeof value === 'object' 
                            ? JSON.stringify(value, null, 2)
                            : String(value)
                          }
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              ) : (
                <Text c="dimmed" ta="center">
                  No metadata available
                </Text>
              )}
            </Stack>
          </ScrollArea>
        </Tabs.Panel>
        
        {/* Activity Tab */}
        <Tabs.Panel value="activity" p="md">
          <ScrollArea h="100%">
            <Stack gap="md">
              <Text size="lg" fw={600}>Activity</Text>
              
              <Stack gap="sm">
                <Group gap="sm">
                  <Box
                    w={20}
                    h={20}
                    style={{
                      backgroundColor: 'var(--mantine-color-blue-5)',
                      borderRadius: '50%',
                    }}
                  />
                  <Text size="sm">
                    Card created on {new Date(selectedCard.createdAt).toLocaleString()}
                  </Text>
                </Group>
                
                {selectedCard.updatedAt !== selectedCard.createdAt && (
                  <Group gap="sm">
                    <Box
                      w={20}
                      h={20}
                      style={{
                        backgroundColor: 'var(--mantine-color-green-5)',
                        borderRadius: '50%',
                      }}
                    />
                    <Text size="sm">
                      Last updated on {new Date(selectedCard.updatedAt).toLocaleString()}
                    </Text>
                  </Group>
                )}
              </Stack>
            </Stack>
          </ScrollArea>
        </Tabs.Panel>
      </Tabs>
    </Paper>
  );
};

// Helper functions
const getTabIcon = (icon?: string) => {
  const iconMap: Record<string, React.ReactNode> = {
    details: <IconFileText size={16} />,
    metadata: <IconTag size={16} />,
    activity: <IconHistory size={16} />,
    links: <IconLink size={16} />,
  };
  
  return iconMap[icon || 'details'] || <IconFileText size={16} />;
};

const getPriorityColor = (priority?: string) => {
  switch (priority?.toLowerCase()) {
    case 'high':
    case 'urgent':
      return 'red';
    case 'medium':
      return 'yellow';
    case 'low':
      return 'green';
    default:
      return 'blue';
  }
};

export default InfoPanel;