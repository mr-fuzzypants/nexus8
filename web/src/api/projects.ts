import { http, type AssetSummary } from './library';
import type { EntitySummary } from './intelligence';

const BASE = '/trackables/api/library/';

export const PROJECT_STATUSES = ['active', 'wip', 'archived'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export interface ProjectSummary {
  id: number;
  code: string;
  name: string;
  description: string;
  status: ProjectStatus;
  started_at: string;
  cover_thumb: string;
  asset_count: number | null;
  entity_count: number | null;
  updated_at: string;
}

export interface ProjectCategoryGroup {
  category: string;
  count: number;
  thumbs: string[];
  entities: EntitySummary[];
}

export interface ProjectDetail extends ProjectSummary {
  stats: {
    total_assets: number;
    total_entities: number;
    ai: Record<string, number>;
  };
  entities_by_category: ProjectCategoryGroup[];
  recent_assets: AssetSummary[];
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const { data } = await http.get(`${BASE}projects/`);
  return data;
}

export async function getProject(code: string): Promise<ProjectDetail> {
  const { data } = await http.get(`${BASE}projects/${code}/`);
  return data;
}

export async function createProject(
  name: string,
  opts: { description?: string; status?: ProjectStatus } = {},
): Promise<ProjectSummary> {
  const { data } = await http.post(`${BASE}projects/`, { name, ...opts });
  return data;
}

export async function assignToProject(
  code: string,
  entityIds: number[],
): Promise<{ updated: number; project_code: string | null }> {
  const { data } = await http.post(`${BASE}projects/${code}/assign/`, {
    entity_ids: entityIds,
  });
  return data;
}
