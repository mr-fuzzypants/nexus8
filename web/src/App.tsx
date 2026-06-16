import { lazy, Suspense } from 'react';
import { Route, Switch } from 'wouter';
import { Shell } from './components/Shell';
import { SearchPage } from './features/search/SearchPage';
import { BoardsPage } from './features/boards/BoardsPage';
import { BoardPage } from './features/boards/BoardPage';
import { CollectionsPage } from './features/collections/CollectionsPage';
import { EntitiesPage } from './features/entities/EntitiesPage';
import { EntityPage } from './features/entities/EntityPage';
import { ProjectsPage } from './features/projects/ProjectsPage';
import { ProjectPage } from './features/projects/ProjectPage';
import { ProjectProvider } from './features/projects/ProjectContext';
import { LandingOrRedirect } from './components/LandingOrRedirect';
import { GraphPage } from './features/graph/GraphPage';
import { FavoritesPage } from './pages/FavoritesPage';
import { RecentPage } from './pages/RecentPage';
import { StubPage } from './pages/StubPage';

const AnnotatorPage = lazy(() => import('./features/annotator/AnnotatorPage'));

export default function App() {
  return (
    <Switch>
      {/* Full-screen annotator workspace, rendered outside the app Shell but
          inside a project so "back" returns to the project. */}
      <Route path="/p/:code/annotate/:assetId">
        {(params) => (
          <Suspense fallback={null}>
            <AnnotatorPage params={params as { code: string; assetId: string }} />
          </Suspense>
        )}
      </Route>

      {/* Project workspace: every management page is gated behind /p/:code and
          scoped to that project. Nested routing makes child links relative. */}
      <Route path="/p/:code" nest>
        {(params) => (
          <ProjectProvider code={(params as { code: string }).code}>
            <Shell>
              <Switch>
                <Route path="/" component={SearchPage} />
                <Route path="/overview" component={ProjectPage} />
                <Route path="/collections" component={CollectionsPage} />
                <Route path="/boards" component={BoardsPage} />
                <Route path="/boards/:id" component={BoardPage} />
                <Route path="/entities" component={EntitiesPage} />
                <Route path="/entities/:id" component={EntityPage} />
                <Route path="/graph/:versionId" component={GraphPage} />
                <Route path="/favorites" component={FavoritesPage} />
                <Route path="/recent" component={RecentPage} />
                <Route>
                  <StubPage title="Not found" note="This page does not exist." />
                </Route>
              </Switch>
            </Shell>
          </ProjectProvider>
        )}
      </Route>

      {/* Landing: project chooser, no workspace shell. */}
      <Route path="/" component={ProjectsPage} />
      <Route path="/projects" component={ProjectsPage} />
      {/* Unknown path: chooser, or redirect a legacy workspace link into the
          last-opened project. */}
      <Route>
        <LandingOrRedirect />
      </Route>
    </Switch>
  );
}
