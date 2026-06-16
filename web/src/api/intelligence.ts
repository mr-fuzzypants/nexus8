import { http, type AssetSummary } from './library';

const BASE = '/trackables/api/library/';

// -- similar ----------------------------------------------------------------

export interface SimilarResult extends AssetSummary {
  similarity: number;
}

export async function getSimilar(
  assetId: number,
  mode: 'embedding' | 'tags' = 'embedding',
  limit = 12,
): Promise<{ mode: string; results: SimilarResult[] }> {
  const { data } = await http.get(`${BASE}assets/${assetId}/similar/`, {
    params: { mode, limit },
  });
  return data;
}

// -- entities & relations ----------------------------------------------------

export const ENTITY_CATEGORIES = [
  'sequence',
  'shot',
  'character',
  'costume',
  'location',
  'prop',
  'scene',
  'style',
] as const;

export interface EntitySummary {
  id: number;
  code: string;
  name: string;
  category: string;
  description: string;
  asset_count: number | null;
  thumb?: string;
}

export interface EntityDetail extends EntitySummary {
  assets: AssetSummary[];
}

export interface Container {
  id: number;
  code: string;
  name: string;
  parent_id: number | null;
  children?: ContainerTreeNode[];
  entities?: EntitySummary[];
}

export interface ContainerTreeNode extends Container {
  children: ContainerTreeNode[];
}

export interface Relation {
  id: number;
  role: string;
  source: string;
  entity: EntitySummary;
}

export async function listEntities(
  category?: string,
  project?: string,
): Promise<EntitySummary[]> {
  const params: Record<string, string> = {};
  if (category) params.category = category;
  if (project) params.project = project;
  const { data } = await http.get(`${BASE}entities/`, { params });
  return data;
}

export async function getContainerTree(): Promise<ContainerTreeNode[]> {
  const { data } = await http.get(`${BASE}containers/tree/`);
  return data;
}

export async function createContainer(name: string, parentId?: number): Promise<Container> {
  const { data } = await http.post(`${BASE}containers/tree/`, { name, parent_id: parentId });
  return data;
}

export async function moveEntityToContainer(
  entityId: number,
  containerId?: number,
): Promise<EntitySummary> {
  const { data } = await http.post(`${BASE}entity-container/`, {
    entity_id: entityId,
    container_id: containerId,
  });
  return data;
}

export async function getRootEntities(
  category?: string,
  project?: string,
): Promise<EntitySummary[]> {
  const params: Record<string, string> = {};
  if (category) params.category = category;
  if (project) params.project = project;
  const { data } = await http.get(`${BASE}root-entities/`, { params });
  return data;
}

export async function createEntity(
  name: string,
  category: string,
  projectCode?: string,
): Promise<EntitySummary> {
  const { data } = await http.post(`${BASE}entities/`, {
    name,
    category,
    project_code: projectCode,
  });
  return data;
}

export async function getEntity(id: number): Promise<EntityDetail> {
  const { data } = await http.get(`${BASE}entities/${id}/`);
  return data;
}

export async function getRelations(assetId: number): Promise<Relation[]> {
  const { data } = await http.get(`${BASE}assets/${assetId}/relations/`);
  return data;
}

export async function addRelation(
  assetId: number,
  entityId: number,
  role?: string,
): Promise<Relation> {
  const { data } = await http.post(`${BASE}assets/${assetId}/relations/`, {
    entity_id: entityId,
    role,
  });
  return data;
}

export async function removeRelation(relationId: number): Promise<void> {
  await http.delete(`${BASE}relations/${relationId}/`);
}

// -- smart collections --------------------------------------------------------

export interface SmartCollectionSummary {
  id: number;
  name: string;
  query: string;
  created_at: string;
}

export async function listSmartCollections(
  project?: string,
): Promise<SmartCollectionSummary[]> {
  const { data } = await http.get(`${BASE}smart-collections/`, {
    params: project ? { project } : {},
  });
  return data;
}

export async function createSmartCollection(
  name: string,
  query: string,
  project?: string,
): Promise<SmartCollectionSummary> {
  const { data } = await http.post(`${BASE}smart-collections/`, { name, query, project });
  return data;
}

export async function deleteSmartCollection(id: number): Promise<void> {
  await http.delete(`${BASE}smart-collections/${id}/`);
}
