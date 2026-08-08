import { http } from './library'

/** Generic video operation jobs (segment, remove, …) — services/video_ops.py. */

export interface VideoOpDescriptor {
  name: string
  label: string
  kind: 'selection' | 'generative'
  requires_mask_track: boolean
  available: boolean
}

export interface VideoOpDispatchResponse {
  status: 'working'
  job_id: string
  op: string
  call_id: string
  dispatch_at_ms: number
  /** Inputs as resolved at dispatch (span, staging tier, track id…). */
  inputs: Record<string, unknown> & { span_start?: number; span_end?: number }
}

export interface VideoOpJobStatus {
  status: 'working' | 'done' | 'failed' | 'cancelled'
  job_id: string
  op?: string
  progress?: string
  elapsed_s?: number
  error?: string
  /** remove op, done: */
  render_asset_id?: number
  run?: number
  version_id?: string
  file_path?: string
  frames_processed?: number
  latency_s?: number
  span_start?: number
  span_end?: number
}

export async function listVideoOps(): Promise<VideoOpDescriptor[]> {
  const { data } = await http.get<{ ops: VideoOpDescriptor[] }>(
    '/trackables/api/library/video-ops/',
  )
  return data.ops
}

export async function dispatchVideoOp(
  assetId: number,
  body: {
    op: string
    layer_id?: string
    inputs?: Record<string, unknown>
    params?: Record<string, unknown>
  },
): Promise<VideoOpDispatchResponse> {
  const { data } = await http.post<VideoOpDispatchResponse>(
    `/trackables/api/library/assets/${assetId}/video-ops/`,
    body,
  )
  return data
}

export async function getVideoOpJob(
  assetId: number,
  jobId: string,
): Promise<VideoOpJobStatus> {
  const { data } = await http.get<VideoOpJobStatus>(
    `/trackables/api/library/assets/${assetId}/video-ops/${jobId}/`,
  )
  return data
}

export async function cancelVideoOp(assetId: number, jobId: string): Promise<void> {
  await http.post(`/trackables/api/library/assets/${assetId}/video-ops/${jobId}/cancel/`)
}
