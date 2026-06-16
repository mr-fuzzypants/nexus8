import { Redirect, useLocation, useSearch } from 'wouter';
import { ProjectsPage } from '../features/projects/ProjectsPage';
import { LAST_PROJECT_KEY } from '../features/projects/ProjectContext';

// Top-level paths that used to be workspace pages before project gating.
const LEGACY_PREFIXES = [
  '/entities',
  '/boards',
  '/collections',
  '/graph',
  '/favorites',
  '/recent',
  '/overview',
];

function lastProject(): string | null {
  try {
    return localStorage.getItem(LAST_PROJECT_KEY);
  } catch {
    return null;
  }
}

/**
 * Catch-all for the landing router. A bare/unknown path shows the project
 * chooser, but a legacy workspace link (e.g. /boards/5) redirects into the
 * last-opened project, preserving the sub-path and query string.
 */
export function LandingOrRedirect() {
  const [location] = useLocation();
  const search = useSearch();
  const code = lastProject();

  const isLegacy = LEGACY_PREFIXES.some(
    (prefix) => location === prefix || location.startsWith(`${prefix}/`),
  );

  if (code && isLegacy) {
    const qs = search ? `?${search}` : '';
    return <Redirect to={`/p/${code}${location}${qs}`} replace />;
  }

  return <ProjectsPage />;
}
