import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listProjects, type ProjectSummary } from '../../api/projects';

/** localStorage key for the most recently opened project (legacy-link redirects). */
export const LAST_PROJECT_KEY = 'nexus-last-project';

interface ProjectContextValue {
  /** Active project code, from the /p/:code route segment. */
  code: string;
  /** The active project's summary, once the projects list has loaded. */
  project?: ProjectSummary;
  /** All projects, for the workspace switcher. */
  projects: ProjectSummary[];
}

const ProjectCtx = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({ code, children }: { code: string; children: ReactNode }) {
  const query = useQuery({ queryKey: ['projects'], queryFn: listProjects });
  const projects = query.data ?? [];
  const project = projects.find((p) => p.code === code);

  // Remember the active project so legacy top-level links can redirect into it.
  useEffect(() => {
    try {
      localStorage.setItem(LAST_PROJECT_KEY, code);
    } catch {
      /* ignore unavailable storage */
    }
  }, [code]);

  return (
    <ProjectCtx.Provider value={{ code, project, projects }}>{children}</ProjectCtx.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useProject(): ProjectContextValue {
  const ctx = useContext(ProjectCtx);
  if (!ctx) throw new Error('useProject must be used within a ProjectProvider');
  return ctx;
}
