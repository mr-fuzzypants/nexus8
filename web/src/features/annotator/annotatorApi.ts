import { http, type AssetSummary } from '../../api/library'

export interface AnnotationDoc {
  id: number
  code: string
  name: string
  target_asset_id: number
  target_asset_version_number: number | null
  room_id: string
  /** base64 Y.encodeStateAsUpdate of the last saved/published document state. */
  doc_state: string
  snapshot_version: number | null
}

/** Fetch a single asset summary by id (used to seed the viewer from a route param). */
export async function getAsset(assetId: number): Promise<AssetSummary> {
  const { data } = await http.get<AssetSummary>(`/trackables/api/library/assets/${assetId}/`)
  return data
}

/** Find the annotation document bound to an asset (and optionally a specific version), creating it on first open. */
export async function getOrCreateAnnotationDoc(
  assetId: number,
  versionNumber?: number | null,
): Promise<AnnotationDoc> {
  const { data } = await http.post<AnnotationDoc>('/trackables/api/library/annotations/', {
    target_asset_id: assetId,
    ...(versionNumber != null ? { target_asset_version_number: versionNumber } : {}),
  })
  return data
}

/** Persist the working CRDT state (base64 Yjs update) without publishing a version. */
export async function saveDocState(docId: number, docState: string): Promise<void> {
  await http.patch(`/trackables/api/library/annotations/${docId}/`, { doc_state: docState })
}

/** Publish the current document state as a new immutable Version. */
export async function snapshotAnnotationDoc(
  docId: number,
): Promise<{ version_number: number; created_at: string }> {
  const { data } = await http.post<{ version_number: number; created_at: string }>(
    `/trackables/api/library/annotations/${docId}/snapshot/`,
  )
  return data
}

/** Upload a rasterized mask PNG as a new asset linked to the source (role="mask"). */
export async function saveMask(
  assetId: number,
  maskBlob: Blob,
  options: { annotationId?: number; name?: string; versionNumber?: number | null } = {},
): Promise<AssetSummary> {
  const form = new FormData()
  form.append('mask', maskBlob, options.name ? `${options.name}.png` : 'mask.png')
  if (options.annotationId != null) {
    form.append('annotation_id', String(options.annotationId))
  }
  if (options.versionNumber != null) {
    form.append('version_number', String(options.versionNumber))
  }
  const { data } = await http.post<AssetSummary>(
    `/trackables/api/library/assets/${assetId}/mask/`,
    form,
  )
  return data
}

/** List masks linked to an asset. Pass versionNumber to scope to a specific version. */
export async function listMasks(
  assetId: number,
  versionNumber?: number | null,
): Promise<AssetSummary[]> {
  const params = versionNumber != null ? { version_number: versionNumber } : {}
  const { data } = await http.get<AssetSummary[]>(
    `/trackables/api/library/assets/${assetId}/masks/`,
    { params },
  )
  return data
}
