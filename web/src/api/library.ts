import axios from 'axios';

// Same-origin in dev: Vite proxies /trackables and /media to Django.
export const http = axios.create({ baseURL: '/' });

export interface AssetSummary {
  id: number;
  code: string;
  name: string;
  description: string;
  media_type: string;
  file_path: string;
  thumbnails: Record<string, string>;
  placeholder: string;
  width: number | null;
  height: number | null;
  // Video-only fields (null for images); used to seed the frame-accurate viewer.
  duration?: number | null;
  fps?: number | null;
  nb_frames?: number | null;
  codec?: string | null;
  tags: string[];
  ai_description: string;
  ai_analysis_status: string;
  project_code: string;
  created_at: string;
}

export interface FacetValue {
  value: string;
  count: number;
}

export interface EntityFacet {
  role: string;
  value: string;
  count: number;
}

export interface SearchFacets {
  tags: FacetValue[];
  media_type: FacetValue[];
  status: FacetValue[];
  entities?: EntityFacet[];
}

export interface SearchResponse {
  count: number;
  page: number;
  num_pages: number;
  results: AssetSummary[];
  facets: SearchFacets;
}

export interface SearchParams {
  q?: string;
  tags?: string[];
  mediaType?: string;
  project?: string;
  page?: number;
  pageSize?: number;
}

export async function searchLibrary(params: SearchParams): Promise<SearchResponse> {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  for (const tag of params.tags ?? []) query.append('tag', tag);
  if (params.mediaType) query.set('media_type', params.mediaType);
  if (params.project) query.set('project', params.project);
  query.set('page', String(params.page ?? 1));
  query.set('page_size', String(params.pageSize ?? 60));
  const { data } = await http.get<SearchResponse>(
    `/trackables/api/library/search/?${query.toString()}`,
  );
  return data;
}

export interface UploadResponse {
  created: AssetSummary[];
  duplicates: AssetSummary[];
}

export async function uploadFiles(files: File[], project?: string): Promise<UploadResponse> {
  const form = new FormData();
  for (const file of files) form.append('files', file);
  if (project) form.append('project', project);
  const { data } = await http.post<UploadResponse>('/trackables/api/library/upload/', form);
  return data;
}

/** Best rendition for a card at the given display width. */
export function thumbUrl(asset: AssetSummary, displayWidth: number): string {
  const { thumbnails, file_path } = asset;
  if (displayWidth <= 280 && thumbnails['256']) return thumbnails['256'];
  if (thumbnails['1024']) return thumbnails['1024'];
  return thumbnails['256'] ?? file_path;
}

/** Largest available rendition for the detail panel. */
export function previewUrl(asset: AssetSummary): string {
  return asset.thumbnails['1024'] ?? asset.file_path;
}
