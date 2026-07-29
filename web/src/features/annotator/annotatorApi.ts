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

export interface SaveMaskOptions {
  annotationId?: number
  name?: string
  versionNumber?: number | null
  layerId?: string
  maskOp?: string
  prompt?: string
  reference?: string
  maskDims?: { x: number; y: number; w: number; h: number }
}

/** Upload a rasterized mask PNG. If layerId is provided the backend adds a new
 *  version to the existing mask asset for that layer rather than creating a new one. */
export async function saveMask(
  assetId: number,
  maskBlob: Blob,
  options: SaveMaskOptions = {},
): Promise<AssetSummary> {
  const form = new FormData()
  form.append('mask', maskBlob, options.name ? `${options.name}.png` : 'mask.png')
  if (options.annotationId != null) {
    form.append('annotation_id', String(options.annotationId))
  }
  if (options.versionNumber != null) {
    form.append('version_number', String(options.versionNumber))
  }
  if (options.layerId != null) {
    form.append('layer_id', options.layerId)
  }
  if (options.maskOp != null) {
    form.append('mask_op', options.maskOp)
  }
  if (options.prompt != null) {
    form.append('prompt', options.prompt)
  }
  if (options.reference != null) {
    form.append('reference', options.reference)
  }
  if (options.maskDims != null) {
    form.append('mask_dims', JSON.stringify(options.maskDims))
  }
  const { data } = await http.post<AssetSummary>(
    `/trackables/api/library/assets/${assetId}/mask/`,
    form,
  )
  return data
}

/** Resolve a nexus8:// reference URI to a same-origin download URL, or null if unresolvable.
 *  Accepts both `nexus8://{code}/{ref}` (canonical) and `nexus8://asset/{code}` (legacy docs). */
export async function resolveNexus8Uri(uri: string): Promise<string | null> {
  if (!uri.startsWith('nexus8://')) {
    return null
  }
  const rest = uri.slice('nexus8://'.length)
  let [code, ...refParts] = rest.split('/')
  let ref = refParts.join('/') || 'latest'
  if (code === 'asset' && refParts.length > 0) {
    ;[code, ...refParts] = refParts
    ref = refParts.join('/') || 'latest'
  }
  if (!code) {
    return null
  }
  try {
    const { data } = await http.get<{ download_url?: string }>('/trackables/api/blob/resolve/', {
      params: { code, ref },
    })
    return data.download_url ?? null
  } catch {
    return null
  }
}

export interface InpaintStatus {
  status: 'working' | 'done' | 'error'
  result?: AssetSummary
  dispatched_at?: string
  result_at?: string
  latency_s?: number
  detail?: string
  /** The seed the backend actually used — server-generated when the client sent none. */
  seed_used?: number
  /** All batch variants (one entry per generated image), each with its own seed. */
  results?: (AssetSummary & { seed?: number })[]
}

/** Dispatch a live inpaint generation for a layer's saved mask. */
export async function triggerInpaint(
  assetId: number,
  body: {
    layer_id: string
    prompt?: string
    num_inference_steps?: number
    mode?: 'fast' | 'quality'
  },
): Promise<{ call_id: string }> {
  const { data } = await http.post<{ call_id: string }>(
    `/trackables/api/library/assets/${assetId}/mask/inpaint/`,
    body,
  )
  return data
}

/** Poll the state of an in-flight inpaint generation. */
export async function getInpaintStatus(assetId: number, layerId: string): Promise<InpaintStatus> {
  const { data } = await http.get<InpaintStatus>(
    `/trackables/api/library/assets/${assetId}/mask/inpaint/status/`,
    { params: { layer_id: layerId } },
  )
  return data
}

/** Shared shape for all generative status poll responses. */
export type GenerativeStatus = InpaintStatus

/** Dispatch a scribble-to-image generation for a layer's saved scribble map. */
export async function triggerScribble(
  assetId: number,
  body: {
    layer_id: string
    prompt?: string
    controlnet_scale?: number
    guidance_scale?: number
    width?: number
    height?: number
    scribble_mode?: 'full' | 'region'
    mask_dims?: { x: number; y: number; w: number; h: number }
    seed?: number
    num_variants?: number
    num_inference_steps?: number
  },
): Promise<{ call_id: string }> {
  const { data } = await http.post<{ call_id: string }>(
    `/trackables/api/library/assets/${assetId}/scribble/`,
    body,
  )
  return data
}

/** Synchronous draft generation: scribble bytes in, JPEG straight back.
 *  No asset storage on either side and no polling — the near-realtime path.
 *  Returns an object URL for the draft image; callers own revoking it. */
export async function triggerScribbleDraft(
  assetId: number,
  form: {
    scribble: Blob
    prompt: string
    controlnet_scale?: number
    num_inference_steps?: number
    seed?: number
    width: number
    height: number
    scribble_mode?: 'full' | 'region'
    mask_dims?: { x: number; y: number; w: number; h: number }
  },
): Promise<{ imageUrl: string; seedUsed?: number }> {
  const fd = new FormData()
  fd.append('scribble', form.scribble, 'scribble.png')
  fd.append('prompt', form.prompt)
  fd.append('width', String(form.width))
  fd.append('height', String(form.height))
  if (form.controlnet_scale != null) fd.append('controlnet_scale', String(form.controlnet_scale))
  if (form.num_inference_steps != null) fd.append('num_inference_steps', String(form.num_inference_steps))
  if (form.seed != null) fd.append('seed', String(form.seed))
  if (form.scribble_mode) fd.append('scribble_mode', form.scribble_mode)
  if (form.mask_dims) fd.append('mask_dims', JSON.stringify(form.mask_dims))
  const response = await http.post<Blob>(
    `/trackables/api/library/assets/${assetId}/scribble/draft/`,
    fd,
    { responseType: 'blob' },
  )
  const seedHeader = response.headers['x-seed-used']
  return {
    imageUrl: URL.createObjectURL(response.data),
    seedUsed: seedHeader != null ? parseInt(String(seedHeader), 10) : undefined,
  }
}

/** Poll the state of an in-flight scribble generation. */
export async function getScribbleStatus(
  assetId: number,
  layerId: string,
): Promise<GenerativeStatus> {
  const { data } = await http.get<GenerativeStatus>(
    `/trackables/api/library/assets/${assetId}/scribble/status/`,
    { params: { layer_id: layerId } },
  )
  return data
}

/** Dispatch a BigLaMa erase for a layer's saved mask. */
export async function triggerErase(
  assetId: number,
  body: { layer_id: string },
): Promise<{ call_id: string }> {
  const { data } = await http.post<{ call_id: string }>(
    `/trackables/api/library/assets/${assetId}/erase/`,
    body,
  )
  return data
}

/** Dispatch a sketch-guided inpaint generation for a layer's saved sketch map. */
export async function triggerSketchInpaint(
  assetId: number,
  body: {
    layer_id: string
    prompt?: string
    negative_prompt?: string
    controlnet_scale?: number
    guidance_scale?: number
    num_inference_steps?: number
    mask_dims: { x: number; y: number; w: number; h: number }
    seed?: number
    num_variants?: number
    denoise_strength?: number
    reference?: string
    reference_scale?: number
  },
): Promise<{ call_id: string }> {
  const { data } = await http.post<{ call_id: string }>(
    `/trackables/api/library/assets/${assetId}/sketch-inpaint/`,
    body,
  )
  return data
}

/** Poll the state of an in-flight sketch inpaint generation. */
export async function getSketchInpaintStatus(
  assetId: number,
  layerId: string,
): Promise<GenerativeStatus> {
  const { data } = await http.get<GenerativeStatus>(
    `/trackables/api/library/assets/${assetId}/sketch-inpaint/status/`,
    { params: { layer_id: layerId } },
  )
  return data
}

/** Poll the state of an in-flight erase generation. */
export async function getEraseStatus(
  assetId: number,
  layerId: string,
): Promise<GenerativeStatus> {
  const { data } = await http.get<GenerativeStatus>(
    `/trackables/api/library/assets/${assetId}/erase/status/`,
    { params: { layer_id: layerId } },
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
