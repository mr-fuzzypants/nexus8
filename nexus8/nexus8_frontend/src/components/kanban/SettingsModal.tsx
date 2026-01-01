import React, { useState } from 'react';
import {
  Modal,
  Tabs,
  Stack,
  Switch,
  Text,
  Group,
  Divider,
  Badge,
  Box,
  NumberInput,
  Select,
  Slider,
  Button,
} from '@mantine/core';
import {
  IconSettings,
  IconX,
  IconBug,
  IconPalette,
  IconLayout,
  IconRefresh,
} from '@tabler/icons-react';
import { shallow } from 'zustand/shallow';

import { ScaleControls } from './ScaleControls';

interface SettingsModalProps {
  opened: boolean;
  onClose: () => void;
  showPerformanceMonitor: boolean;
  onTogglePerformanceMonitor: (value: boolean) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  opened,
  onClose,
  showPerformanceMonitor,
  onTogglePerformanceMonitor,
}) => {
  const [activeTab, setActiveTab] = useState<string | null>('general');

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="sm">
          <IconSettings size={20} />
          <Text size="lg" fw={600}>Settings</Text>
        </Group>
      }
      size="lg"
      centered
      closeButtonProps={{
        'aria-label': 'Close settings',
        icon: <IconX size={16} />,
      }}
    >
      <Tabs value={activeTab} onChange={setActiveTab}>
        <Tabs.List>
          <Tabs.Tab value="general" leftSection={<IconLayout size={16} />}>
            General
          </Tabs.Tab>
          <Tabs.Tab value="appearance" leftSection={<IconPalette size={16} />}>
            Appearance
          </Tabs.Tab>
          <Tabs.Tab 
            value="debug" 
            leftSection={<IconBug size={16} />}
            rightSection={
              <Badge size="xs" variant="light" color="orange">
                Dev
              </Badge>
            }
          >
            Debug
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="general" pt="md">
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              General application settings
            </Text>
            
            <Divider />
            
            <Box>
              <Text size="sm" fw={500} mb="xs">Board Settings</Text>
              <Stack gap="sm">
                <Switch
                  label="Auto-save changes"
                  description="Automatically save changes to cards and board"
                  defaultChecked
                />
                
                <Switch
                  label="Show card images"
                  description="Display images on cards when available"
                  defaultChecked
                />
                
                <Switch
                  label="Enable animations"
                  description="Enable smooth transitions and animations"
                  defaultChecked
                />
              </Stack>
            </Box>
            
            <Divider />
            
            <Box>
              <Text size="sm" fw={500} mb="xs">Card Defaults</Text>
              <Stack gap="sm">
                <Select
                  label="Default Priority"
                  placeholder="Select default priority"
                  data={[
                    { value: 'low', label: 'Low' },
                    { value: 'medium', label: 'Medium' },
                    { value: 'high', label: 'High' },
                    { value: 'critical', label: 'Critical' },
                  ]}
                  defaultValue="medium"
                />
                
                <NumberInput
                  label="Default Story Points"
                  placeholder="0"
                  min={0}
                  max={100}
                  defaultValue={0}
                />
              </Stack>
            </Box>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="appearance" pt="md">
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              Customize the appearance of the board
            </Text>
            
            <Divider />
            
            <Box>
              <Text size="sm" fw={500} mb="xs">Display Options</Text>
              <Stack gap="sm">
                <Switch
                  label="Compact mode"
                  description="Use a more compact layout to show more cards"
                />
                
                <Switch
                  label="Show card IDs"
                  description="Display card IDs on cards"
                />
                
                <Switch
                  label="Show breadcrumbs"
                  description="Display navigation breadcrumbs"
                  defaultChecked
                />
              </Stack>
            </Box>
            
            <Divider />
            
            <Box>
              <Text size="sm" fw={500} mb="xs">Scaling</Text>
              <ScaleControls />
            </Box>

            <Divider />
            
            <Box>
              <Text size="sm" fw={500} mb="xs">Theme</Text>
              <Select
                label="Color Theme"
                placeholder="Select theme"
                data={[
                  { value: 'light', label: 'Light' },
                  { value: 'dark', label: 'Dark' },
                  { value: 'auto', label: 'Auto (System)' },
                ]}
                defaultValue="light"
              />
            </Box>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="debug" pt="md">
          <Stack gap="md">
            <Group gap="xs">
              <Badge variant="light" color="orange">Developer Tools</Badge>
              <Text size="sm" c="dimmed">
                Debug and performance monitoring options
              </Text>
            </Group>
            
            <Divider />
            
            <Box>
              <Text size="sm" fw={500} mb="xs">Performance Monitoring</Text>
              <Stack gap="sm">
                <Switch
                  label="Show Performance Monitor"
                  description="Display real-time undo/redo system performance metrics"
                  checked={showPerformanceMonitor}
                  onChange={(event) => onTogglePerformanceMonitor(event.currentTarget.checked)}
                />
                
                <Text size="xs" c="dimmed" pl="md">
                  When enabled, shows memory usage, action count, and efficiency metrics
                  in the bottom-right corner of the screen.
                </Text>
              </Stack>
            </Box>
            
            <Divider />
            
            <Box>
              <Text size="sm" fw={500} mb="xs">Developer Options</Text>
              <Stack gap="sm">
                <Switch
                  label="Enable debug logs"
                  description="Log debug information to browser console"
                />
                
                <Switch
                  label="Show component boundaries"
                  description="Highlight component boundaries for debugging"
                />
                
                <Switch
                  label="Performance profiling"
                  description="Enable React DevTools profiling"
                />
              </Stack>
            </Box>
            
            <Divider />
            
            <Box>
              <Text size="sm" fw={500} mb="xs">Undo/Redo Configuration</Text>
              <Stack gap="sm">
                <NumberInput
                  label="Max Undo Stack Size"
                  description="Maximum number of actions to keep in history"
                  placeholder="50"
                  min={10}
                  max={200}
                  defaultValue={50}
                />
                
                <NumberInput
                  label="Memory Limit (MB)"
                  description="Maximum memory for undo/redo system"
                  placeholder="5"
                  min={1}
                  max={50}
                  defaultValue={5}
                  step={1}
                />
                
                <NumberInput
                  label="Action Grouping Window (ms)"
                  description="Time window to group similar actions"
                  placeholder="1000"
                  min={100}
                  max={5000}
                  defaultValue={1000}
                  step={100}
                />
              </Stack>
            </Box>
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </Modal>
  );
};
