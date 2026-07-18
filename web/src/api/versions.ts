import { http, type AssetSummary } from './library';

// -- version history ----------------------------------------------------------

export interface VersionNode {
  id: number;
  version_number: number;
  created_at: string;
  created_by: string;
  content_hash: string;
  file_path: string;
  thumbnails: Record<string, string>;
  symlinks: string[];
  intentId: string | null;
}

export interface LineageEdge {
  role: string;
  entity_id: number;
  entity_name: string;
  version_number: number;
}

export interface VersionHistory {
  asset_id: number;
  versions: VersionNode[];
  derived_from: LineageEdge[];
  derives: LineageEdge[];
}

export async function getVersionHistory(assetId: number): Promise<VersionHistory> {
  const { data } = await http.get(`/trackables/api/library/assets/${assetId}/versions/`);
  return data;
}

// -- provenance (Tier-3 reproduction manifest) --------------------------------

export interface ProvenanceIngredient {
  code: string;
  entity_type: string;
  symlink_used: string;
  pinned_version: number;
  content_hash: string;
}

export interface Provenance {
  output: { code: string; version: number; seed: number | null; content_hash: string };
  batch: {
    code: string;
    version: number;
    published_at: string;
    params: { environment?: Record<string, string>; seeds?: Record<string, number> };
  };
  ingredients: Record<string, ProvenanceIngredient>;
}

/** Forward lineage: what run/workflow/checkpoint/seed produced this asset.
 *  Returns `{ provenance: null }` for assets not generated through nexus8. */
export async function getProvenance(
  assetId: number,
): Promise<Provenance | { provenance: null }> {
  const { data } = await http.get(`/trackables/api/library/assets/${assetId}/provenance/`);
  return data;
}

/** Re-run the workflow that produced this asset, pinned to its manifest.
 *  Proxied through nexus8 to the nodegraph engine; returns the new run id. */
export async function reproduceAsset(
  assetCode: string,
): Promise<{ status: string; runId: string; workflow: string }> {
  const { data } = await http.post('/trackables/api/runs/reproduce/', { asset_code: assetCode });
  return data;
}

export async function uploadVersion(
  assetId: number,
  file: File,
): Promise<{ version_number: number; created: boolean; asset: AssetSummary }> {
  const form = new FormData();
  form.append('file', file);
  const { data } = await http.post(`/trackables/api/library/assets/${assetId}/versions/`, form);
  return data;
}

export function versionImage(version: VersionNode): string {
  return version.thumbnails['1024'] || version.thumbnails['256'] || version.file_path;
}

// -- recommendations -----------------------------------------------------------

export async function getRecommendations(
  seedIds: number[],
  limit = 12,
): Promise<{ basis: string; results: (AssetSummary & { similarity?: number })[] }> {
  const { data } = await http.get('/trackables/api/library/recommendations/', {
    params: { assets: seedIds.join(','), limit },
  });
  return data;
}

// -- discussions (activity) ----------------------------------------------------

export interface DiscussionSummary {
  id: number;
  title: string;
  status: string;
  comment_count?: number;
}

export interface CommentNode {
  id: number;
  content: string;
  author: string;
  created_at: string;
  replies?: CommentNode[];
}

export async function getAssetDiscussions(assetId: number): Promise<DiscussionSummary[]> {
  const { data } = await http.get('/discussions/api/discussions/by_object/', {
    params: { object_type: 'entity', object_id: assetId },
  });
  return data;
}

export async function createDiscussion(
  assetId: number,
  title: string,
): Promise<DiscussionSummary> {
  const { data } = await http.post('/discussions/api/discussions/', {
    title,
    discussion_type: 'review',
    versioned_entity_id: assetId,
    created_by: 'dev',
  });
  return data;
}

export async function getComments(discussionId: number): Promise<CommentNode[]> {
  const { data } = await http.get(`/discussions/api/discussions/${discussionId}/comments/`);
  return data;
}

export async function addComment(discussionId: number, content: string): Promise<CommentNode> {
  const { data } = await http.post(`/discussions/api/discussions/${discussionId}/add_comment/`, {
    content,
  });
  return data;
}
