import { http } from './library';

const BASE = '/trackables/api/';

export type GraphDirection = 'downstream' | 'upstream' | 'both';

export interface GraphNode {
  id: string;
  version_id: number;
  entity_id: number;
  entity_name: string;
  entity_type: string;
  version_number: number;
  /** Direct neighbours in the queried direction (for "expand +N" affordance). */
  child_count: number;
}

/** One hop of neighbours around a node — used for progressive expansion. */
export async function getNeighbors(
  versionId: number,
  direction: GraphDirection = 'downstream',
): Promise<DependencyGraphResponse> {
  return getDependencyGraph(versionId, direction, 1);
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relationship_type: string;
  role: string;
}

export interface DependencyGraphResponse {
  root: string;
  direction: GraphDirection;
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
}

/**
 * Transitive {nodes, edges} dependency graph around a version, for client-side
 * layout (xyflow + dagre). `downstream` = what it uses, `upstream` = what uses
 * it, `both` = union.
 */
export async function getDependencyGraph(
  versionId: number,
  direction: GraphDirection = 'downstream',
  maxDepth = 10,
): Promise<DependencyGraphResponse> {
  const { data } = await http.get(`${BASE}dependency-links/graph/`, {
    params: { version_id: versionId, direction, max_depth: maxDepth },
  });
  return data;
}
