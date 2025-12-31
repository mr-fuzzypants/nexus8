import React from 'react';
import { MantineProvider, createTheme } from '@mantine/core';

interface KanbanThemeProviderProps {
  children: React.ReactNode;
}

export const KanbanThemeProvider: React.FC<KanbanThemeProviderProps> = ({ children }) => {
  const theme = createTheme({
    primaryColor: 'blue',
    components: {
      Paper: {
        defaultProps: {
          radius: 'md',
        },
      },
      Card: {
        defaultProps: {
          radius: 'md',
        },
      },
    },
  });

  return (
    <MantineProvider theme={theme}>
      {children}
    </MantineProvider>
  );
};
