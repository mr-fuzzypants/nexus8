import { MantineProvider } from '@mantine/core';
import { KanbanDemo } from './demos/KanbanDemo';
import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import './index.css';

const App = () => {
  return (
    <MantineProvider>
      <KanbanDemo />
    </MantineProvider>
  );
};

export default App;
