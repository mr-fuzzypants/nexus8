import { lazy, Suspense } from 'react';
import { Route, Switch } from 'wouter';
import { Shell } from './components/Shell';
import { SearchPage } from './features/search/SearchPage';
import { BoardsPage } from './features/boards/BoardsPage';
import { BoardPage } from './features/boards/BoardPage';
import { CollectionsPage } from './features/collections/CollectionsPage';
import { EntitiesPage } from './features/entities/EntitiesPage';
import { EntityPage } from './features/entities/EntityPage';
import { GraphPage } from './features/graph/GraphPage';
import { FavoritesPage } from './pages/FavoritesPage';
import { RecentPage } from './pages/RecentPage';
import { StubPage } from './pages/StubPage';

const AnnotatorPage = lazy(() => import('./features/annotator/AnnotatorPage'));

export default function App() {
  return (
    <Switch>
      {/* Full-screen annotator workspace, rendered outside the app Shell. */}
      <Route path="/annotate/:assetId">
        {(params) => (
          <Suspense fallback={null}>
            <AnnotatorPage params={params as { assetId: string }} />
          </Suspense>
        )}
      </Route>
      <Route>
        <Shell>
          <Switch>
            <Route path="/" component={SearchPage} />
            <Route path="/favorites" component={FavoritesPage} />
            <Route path="/recent" component={RecentPage} />
            <Route path="/collections" component={CollectionsPage} />
            <Route path="/boards" component={BoardsPage} />
            <Route path="/boards/:id" component={BoardPage} />
            <Route path="/entities" component={EntitiesPage} />
            <Route path="/entities/:id" component={EntityPage} />
            <Route path="/graph/:versionId" component={GraphPage} />
            <Route>
              <StubPage title="Not found" note="This page does not exist." />
            </Route>
          </Switch>
        </Shell>
      </Route>
    </Switch>
  );
}
