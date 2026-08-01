import { http } from './library';

const BASE = '/trackables/api/';

export type RelationsDirection = 'downstream' | 'upstream' | 'both';

/** Which store an edge came from (SRED_DEPENDENCYVIS_EXPERIMENT.md).
 * 'layer' edges join a version to a synthetic layer group (curated view). */
export type EdgeKind = 'dependency' | 'relation' | 'lineage' | 'pointer' | 'layer';

/** 'curated' aggregates to artist concepts (inputs/layers/outputs);
 * 'raw' returns every store-level edge (debugging surface). */
export type RelationsView = 'curated' | 'raw';

/** Node ids are prefixed: "v{id}" version, "e{id}" entity, "L{uuid}" layer group. */
export interface RelationNode {
  id: string;
  node_kind: 'version' | 'entity' | 'layer';
  entity_id: number;
  entity_name: string;
  entity_type: string;
  version_id: number | null;
  version_number: number | null;
  variation_number: number | null;
  /** Small image proxy (256px rendition); entity nodes use their newest version's. */
  thumb: string | null;
  /** Direct neighbours across all stores (for "expand +N" affordance). */
  child_count: number;
}

export interface RelationEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  role: string;
  /** "entity"-scoped edges belong to the asset as a whole, not one version. */
  scope: 'version' | 'entity';
  context: {
    relationship_type?: string;
    layer_id?: string;
    confidence?: number;
    source?: string;
    /** Total render candidates behind a collapsed output/selected-render edge. */
    candidates?: number;
    runs?: number;
  };
}

export interface RelationsHopResponse {
  root: string;
  direction: RelationsDirection;
  nodes: RelationNode[];
  edges: RelationEdge[];
}

/** One hop of every relationship around a node, across all stores. */
export async function getRelationsHop(
  nodeId: string,
  direction: RelationsDirection = 'both',
  view: RelationsView = 'curated',
): Promise<RelationsHopResponse> {
  const { data } = await http.get(`${BASE}relations-graph/`, {
    params: { node: nodeId, direction, view },
  });
  return data;
}
