import React from 'react';
import { MantineProvider, createTheme, MantineColorsTuple } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';

interface KanbanThemeProviderProps {
  children: React.ReactNode;
}

// Custom color palette for Kanban
const kanbanBlue: MantineColorsTuple = [
  '#e3f2fd',
  '#bbdefb',
  '#90caf9',
  '#64b5f6',
  '#42a5f5',
  '#2196f3',
  '#1e88e5',
  '#1976d2',
  '#1565c0',
  '#0d47a1'
];

const kanbanGreen: MantineColorsTuple = [
  '#e8f5e8',
  '#c8e6c9',
  '#a5d6a7',
  '#81c784',
  '#66bb6a',
  '#4caf50',
  '#43a047',
  '#388e3c',
  '#2e7d32',
  '#1b5e20'
];

const kanbanOrange: MantineColorsTuple = [
  '#fff3e0',
  '#ffe0b2',
  '#ffcc02',
  '#ffb74d',
  '#ffa726',
  '#ff9800',
  '#fb8c00',
  '#f57c00',
  '#ef6c00',
  '#e65100'
];

// Custom theme for Kanban
const kanbanTheme = createTheme({
  colors: {
    kanbanBlue,
    kanbanGreen,
    kanbanOrange,
  },
  primaryColor: 'kanbanBlue',
  fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif',
  headings: {
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif',
    fontWeight: '600',
  },
  spacing: {
    xs: '8px',
    sm: '12px',
    md: '16px',
    lg: '20px',
    xl: '24px',
  },
  radius: {
    xs: '4px',
    sm: '6px',
    md: '8px',
    lg: '12px',
    xl: '16px',
  },
  shadows: {
    xs: '0 1px 3px rgba(0, 0, 0, 0.05)',
    sm: '0 1px 3px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06)',
    md: '0 4px 6px rgba(0, 0, 0, 0.07), 0 2px 4px rgba(0, 0, 0, 0.06)',
    lg: '0 10px 15px rgba(0, 0, 0, 0.1), 0 4px 6px rgba(0, 0, 0, 0.05)',
    xl: '0 20px 25px rgba(0, 0, 0, 0.1), 0 10px 10px rgba(0, 0, 0, 0.04)',
  },
  components: {
    Card: {
      defaultProps: {
        shadow: 'sm',
        radius: 'md',
        withBorder: true,
      },
      styles: {
        root: {
          borderColor: 'var(--mantine-color-gray-2)',
          transition: 'all 150ms ease',
          '&:hover': {
            borderColor: 'var(--mantine-color-gray-4)',
            transform: 'translateY(-1px)',
            boxShadow: 'var(--mantine-shadow-md)',
          },
        },
      },
    },
    Button: {
      defaultProps: {
        radius: 'md',
      },
      styles: {
        root: {
          fontWeight: 500,
        },
      },
    },
    ActionIcon: {
      defaultProps: {
        radius: 'md',
      },
    },
    Badge: {
      defaultProps: {
        radius: 'sm',
      },
    },
    Paper: {
      defaultProps: {
        shadow: 'xs',
        radius: 'md',
      },
    },
  },
});

export const KanbanThemeProvider: React.FC<KanbanThemeProviderProps> = ({ children }) => {
  return (
    <MantineProvider theme={kanbanTheme}>
      <ModalsProvider>
        <Notifications position="top-right" />
        {children}
      </ModalsProvider>
    </MantineProvider>
  );
};

export default KanbanThemeProvider;