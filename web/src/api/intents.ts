/**
 * Real API client for the intent-first orchestration system.
 * All functions call the Django backend at /trackables/api/intents/…
 *
 * Components import from mockApi.ts which routes here when
 * WORKFLOW_MOCK_ENABLED is false.
 */

import { http } from './library';
import type {
  ResolutionProposal,
  RunIntent,
  WorkflowAttachment,
  ReferenceSlotEntry,
} from '../features/workflows/types';

const BASE = '/trackables/api/intents';

// ---- Reference slots ----

export async function getReferenceSlots(entityCode: string): Promise<ReferenceSlotEntry[]> {
  const { data } = await http.get(`${BASE}/entities/${entityCode}/reference-slots/`);
  return data;
}

export async function setReferenceSlot(
  entityCode: string,
  slot: string,
  assetCode: string,
  policy: string,
): Promise<ReferenceSlotEntry> {
  const { data } = await http.post(`${BASE}/entities/${entityCode}/reference-slots/`, {
    slot,
    assetCode,
    policy,
  });
  return data;
}

export async function deleteReferenceSlot(entityCode: string, slot: string): Promise<void> {
  await http.delete(`${BASE}/entities/${entityCode}/reference-slots/${slot}/`);
}

// ---- Attachments ----

export async function getAttachments(targetEntityCode: string, process?: string): Promise<WorkflowAttachment[]> {
  const params: Record<string, string> = { target: targetEntityCode };
  if (process) params.process = process;
  const { data } = await http.get(`${BASE}/attachments/`, { params });
  return (data as Record<string, unknown>[]).map(_normaliseAttachment);
}

function _normaliseAttachment(raw: Record<string, unknown>): WorkflowAttachment {
  const graph = (raw.graph as Record<string, unknown>) ?? {};
  return {
    ...raw,
    id: String(raw.id),
    graph: {
      nodes: (graph.nodes as WorkflowAttachment['graph']['nodes']) ?? [],
      views: (graph.views as WorkflowAttachment['graph']['views']) ?? [],
    },
  } as WorkflowAttachment;
}

export async function createAttachment(body: {
  workflowCode: string;
  targetEntityCode?: string;
  targetProcess?: string;
  level?: string;
  mode?: string;
  viewName?: string;
  graphInterface?: object;
  outputBindings?: object[];
}): Promise<{ id: number }> {
  const { data } = await http.post(`${BASE}/attachments/`, body);
  return data;
}

// ---- Resolve (pure) ----

export async function resolve(
  attachmentId: number,
  targetAssetCode: string,
  selections: Record<string, string>,
): Promise<ResolutionProposal> {
  const { data } = await http.post(`${BASE}/resolve/`, {
    attachmentId,
    targetAssetCode,
    selections,
  });
  return data;
}

// ---- Intents ----

export async function createIntent(body: {
  attachmentId: number;
  targetAssetCode: string;
  selections: Record<string, string>;
  params: Record<string, unknown>;
  seed: number;
  armedPins: string[];
  onAmbiguity?: string;
}): Promise<RunIntent> {
  const { data } = await http.post(`${BASE}/`, body);
  return _normaliseIntent(data);
}

export async function getIntent(id: number | string): Promise<RunIntent> {
  const { data } = await http.get(`${BASE}/${id}/`);
  return _normaliseIntent(data);
}

export async function updateIntentStatus(
  id: number | string,
  status: string,
  opts?: { engineRunId?: string; errorMessage?: string },
): Promise<RunIntent> {
  const { data } = await http.patch(`${BASE}/${id}/status/`, {
    status,
    engineRunId: opts?.engineRunId,
    errorMessage: opts?.errorMessage,
  });
  return _normaliseIntent(data);
}

export async function dispatchIntent(
  id: number | string,
  opts?: { networkId?: string; nodeId?: string },
): Promise<{ intentId: number; status: string; engineRunId: string }> {
  const { data } = await http.post(`${BASE}/${id}/dispatch/`, opts ?? {});
  return data;
}

export async function cloneIntent(
  id: number | string,
  opts?: { newSeed?: number },
): Promise<RunIntent> {
  const { data } = await http.post(`${BASE}/${id}/clone/`, opts ?? {});
  return _normaliseIntent(data);
}

// ---- Browse (for nodegraph dev-mode pickers used from SPA tests) ----

export async function browse(params: {
  role?: string;
  slot?: string;
  policy?: string;
  project?: string;
  q?: string;
}): Promise<object[]> {
  const { data } = await http.get(`${BASE}/browse/`, { params });
  return data;
}

// ---- Normalisation ----

function _normaliseIntent(raw: Record<string, unknown>): RunIntent {
  return {
    id: String(raw.id),
    status: (raw.status as RunIntent['status']) ?? 'pending',
    nodes: [],
    outcomes: [],
    armedPins: (raw.armedPins as string[]) ?? [],
    seed: (raw.seed as number) ?? 0,
    engineRunId: String(raw.engineRunId ?? ''),
    errorMessage: String(raw.errorMessage ?? ''),
    createdAt: String(raw.createdAt ?? ''),
  };
}

export async function listIntents(targetAssetCode: string): Promise<RunIntent[]> {
  const { data } = await http.get(`${BASE}/`, { params: { targetAsset: targetAssetCode } });
  return (data as Record<string, unknown>[]).map(_normaliseIntent);
}
