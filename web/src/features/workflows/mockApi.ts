/**
 * API-shaped seam for the workflow system.
 *
 * When WORKFLOW_MOCK_ENABLED is true (default in dev), all calls return
 * fixture data so the UI can be developed without backend data.
 *
 * When WORKFLOW_MOCK_ENABLED is false, calls route to the real Django
 * intent API at /trackables/api/intents/…
 *
 * Fan-out (getFanOutPlan) is still fixture-only until Phase 4.
 */

import * as realApi from '../../api/intents';
import type { AssetSummary } from '../../api/library';
import { thumbUrl } from '../../api/library';
import type {
  FanOutPlan,
  InputResolution,
  ResolutionProposal,
  RunIntent,
  WorkflowAttachment,
} from './types';
import {
  CHARACTERS,
  DINER_SET,
  FRAME_ATTACHMENT,
  RUN_NODES,
  SHOT_ATTACHMENT,
  SHOT_CODE,
  SHOT_CONTEXT_LABEL,
  SHOT_FRAMES,
  WORKFLOW_MOCK_ENABLED,
  storyboardQuerySet,
} from './fixtures';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let intentCounter = 40;

/** Attachments offered for an asset (process-level defaults + pins). */
export async function getAttachmentsForAsset(asset: AssetSummary): Promise<WorkflowAttachment[]> {
  if (!WORKFLOW_MOCK_ENABLED) {
    return realApi.getAttachments(asset.code);
  }
  await delay(250);
  return [FRAME_ATTACHMENT];
}

/** Attachments offered on a shot container (fan-out entry point). */
export async function getAttachmentsForShot(_shotCode: string): Promise<WorkflowAttachment[]> {
  // Fan-out is still fixture-only (Phase 4).
  await delay(250);
  return [SHOT_ATTACHMENT];
}

/**
 * Scan the graph's context nodes (everything except Self) into resolutions.
 * `selections` maps node id → chosen entity code; query nodes materialize
 * only once the node they depend on has a resolution.
 */
function scanContextNodes(
  attachment: WorkflowAttachment,
  selections: Record<string, string>,
): InputResolution[] {
  const resolutions: InputResolution[] = [];
  for (const node of attachment.graph.nodes) {
    if (node.kind === 'entity_ref' && node.role === 'character') {
      // Two characters in the shot, node takes one → ambiguous.
      resolutions.push({ node, status: 'ambiguous', candidates: CHARACTERS });
    } else if (node.kind === 'entity_ref') {
      resolutions.push({ node, status: 'resolved', chosen: [DINER_SET] });
    } else if (node.kind === 'asset_query') {
      const dependsOn = selections[node.criteria.relatedTo];
      const chosen = CHARACTERS.find((candidate) => candidate.entityCode === dependsOn);
      if (!chosen) {
        resolutions.push({ node, status: 'query', summary: null, set: [] });
      } else {
        const set = storyboardQuerySet(chosen.entityCode);
        resolutions.push({
          node,
          status: 'query',
          summary: `${set.length} ${node.criteria.process} images of ${chosen.entityName} · ${node.criteria.ref}`,
          set,
        });
      }
    }
  }
  return resolutions;
}

/**
 * Phase 1 — resolve (pure, no side effects): scan the graph's asset nodes,
 * bind Self to the launched asset, resolve context from the shot, materialize
 * query sets against current selections, and derive planned outcomes from the
 * Output nodes + attach-time bindings. Ambiguities are surfaced, never guessed.
 */
export async function resolveRun(
  attachment: WorkflowAttachment,
  asset: AssetSummary,
  nextVersion: number | null,
  selections: Record<string, string>,
): Promise<ResolutionProposal> {
  if (!WORKFLOW_MOCK_ENABLED) {
    return realApi.resolve(Number(attachment.id), asset.code, selections);
  }
  await delay(400);
  const inputs: InputResolution[] = [];

  const selfNode = attachment.graph.nodes.find((node) => node.kind === 'self');
  if (selfNode && selfNode.kind === 'self') {
    inputs.push({
      node: selfNode,
      status: 'resolved',
      chosen: [
        {
          entityCode: asset.code,
          entityName: asset.name,
          category: 'asset',
          assetCode: asset.code,
          version: nextVersion ? nextVersion - 1 : 1,
          policy: 'latest',
          thumb: thumbUrl(asset, 128) || asset.placeholder,
        },
      ],
    });
  }
  inputs.push(...scanContextNodes(attachment, selections));

  const pins = attachment.graph.nodes.filter((node) => node.kind === 'pin');

  const outcomes = attachment.graph.nodes
    .filter((node) => node.kind === 'output')
    .map((node) => {
      const binding = attachment.outputs.find((b) => b.slot === node.slot);
      if (binding?.target === 'new_version_of_self') {
        return {
          description: nextVersion
            ? `${node.slot} → will create v${nextVersion} of ${asset.code}`
            : `${node.slot} → will create a new version of ${asset.code}`,
          targetCode: asset.code,
          targetVersion: nextVersion,
        };
      }
      if (binding?.target === 'new_asset') {
        const name = (binding.nameTemplate ?? '{source}_out').replace('{source}', asset.code);
        return { description: `${node.slot} → new asset ${name}`, targetCode: name, targetVersion: 1 };
      }
      return { description: `${node.slot} → discarded`, targetCode: node.slot, targetVersion: null };
    });

  return {
    attachmentId: attachment.id,
    target: { code: asset.code, name: asset.name },
    contextLabel: SHOT_CONTEXT_LABEL,
    inputs,
    pins,
    outcomes,
    viewName: attachment.viewName,
  };
}

/**
 * Phase 2 — confirm: selections + params + armed pins become a Run Intent.
 * Everything the run will do — including the exact materialized query-set
 * versions — is pinned before the engine starts.
 */
export async function createIntent(
  proposal: ResolutionProposal,
  seed: number,
  armedPins: string[],
  params?: Record<string, unknown>,
  selections?: Record<string, string>,
): Promise<RunIntent> {
  if (!WORKFLOW_MOCK_ENABLED) {
    const intent = await realApi.createIntent({
      attachmentId: Number(proposal.attachmentId),
      targetAssetCode: proposal.target.code,
      selections: selections ?? {},
      params: params ?? {},
      seed,
      armedPins,
    });
    // Dispatch the intent to nodegraph now that it's confirmed.
    await realApi.dispatchIntent(intent.id);
    return intent;
  }
  await delay(350);
  intentCounter += 1;
  return {
    id: `ri-2026-${intentCounter}`,
    status: 'running',
    nodes: RUN_NODES.map((node) => ({ node, status: 'pending' })),
    outcomes: proposal.outcomes,
    armedPins,
    seed,
  };
}

/** Fan-out plan for a shot: shared context once, one row per frame. */
export async function getFanOutPlan(
  shotCode: string,
  selections: Record<string, string>,
): Promise<FanOutPlan> {
  await delay(400);
  return {
    shotCode: shotCode || SHOT_CODE,
    attachment: SHOT_ATTACHMENT,
    shared: scanContextNodes(SHOT_ATTACHMENT, selections),
    rows: SHOT_FRAMES.map((row) => ({ ...row })),
  };
}
