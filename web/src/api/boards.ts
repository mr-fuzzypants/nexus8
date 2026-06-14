import { http, type AssetSummary } from './library';

export interface CanvasItem {
  id: string;
  asset_id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

export interface CanvasDoc {
  items: CanvasItem[];
}

export interface BoardSummary {
  id: number;
  code: string;
  name: string;
  item_count: number;
  updated_at: string;
  created_at: string;
  preview_thumbs?: string[];
}

export interface BoardDetail extends BoardSummary {
  canvas: CanvasDoc;
  assets: Record<number, AssetSummary>;
  snapshot_version: number | null;
}

const BASE = '/trackables/api/library/boards/';

export async function listBoards(): Promise<BoardSummary[]> {
  const { data } = await http.get<BoardSummary[]>(BASE);
  return data;
}

export async function createBoard(name: string, canvas?: CanvasDoc): Promise<BoardDetail> {
  const { data } = await http.post<BoardDetail>(BASE, { name, canvas });
  return data;
}

export async function getBoard(id: number): Promise<BoardDetail> {
  const { data } = await http.get<BoardDetail>(`${BASE}${id}/`);
  return data;
}

export async function saveBoard(
  id: number,
  patch: { name?: string; canvas?: CanvasDoc },
): Promise<BoardSummary> {
  const { data } = await http.patch<BoardSummary>(`${BASE}${id}/`, patch);
  return data;
}

export async function snapshotBoard(id: number): Promise<{ version_number: number }> {
  const { data } = await http.post<{ version_number: number }>(`${BASE}${id}/snapshot/`);
  return data;
}

export async function deleteBoard(id: number): Promise<void> {
  await http.delete(`${BASE}${id}/`);
}

export async function createCollection(
  name: string,
  assetIds: number[],
): Promise<{ id: number; code: string; name: string }> {
  const { data } = await http.post('/trackables/api/library/collections/', {
    name,
    asset_ids: assetIds,
  });
  return data;
}
