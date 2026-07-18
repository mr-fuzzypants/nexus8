/**
 * Fixture world for the workflow-integration UI mockup (round 2 —
 * graph-derived). Frontend-only: nothing here touches the backend;
 * thumbnails are generated SVGs.
 *
 * The world: shot sh010 (8 storyboard frames) referencing characters
 * Rex & Mabel and the diner set. The workflow's fixture graph carries its
 * own nexus8 interface as asset nodes: Self, EntityRef(character.turnaround)
 * — deliberately ambiguous (two characters in the shot), EntityRef(set),
 * AssetQuery(storyboard images related to {character}), Output(board_frame),
 * Pin(latent@final). The run form is derived by scanning these nodes.
 */

import type {
  FanOutRow,
  QuerySetItem,
  ReferenceSlotEntry,
  ResolvedCandidate,
  WorkflowAttachment,
  WorkflowSummary,
} from './types';

/** Master switch for all mocked workflow UI. Set to false to use the real Django intent API. */
export const WORKFLOW_MOCK_ENABLED = false;

/** Labeled SVG placeholder as a data URI — no binary assets needed. */
export function placeholderThumb(label: string, hue: number): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128">` +
    `<rect width="128" height="128" fill="hsl(${hue},35%,22%)"/>` +
    `<circle cx="64" cy="50" r="26" fill="hsl(${hue},45%,38%)"/>` +
    `<text x="64" y="112" text-anchor="middle" font-family="sans-serif" font-size="15" fill="hsl(${hue},30%,80%)">${label}</text>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export const CHARACTERS: ResolvedCandidate[] = [
  {
    entityCode: 'rex',
    entityName: 'Rex',
    category: 'character',
    assetCode: 'rex_turnaround',
    referenceSlot: 'turnaround',
    version: 5,
    policy: 'approved',
    thumb: placeholderThumb('Rex', 12),
  },
  {
    entityCode: 'mabel',
    entityName: 'Mabel',
    category: 'character',
    assetCode: 'mabel_turnaround',
    referenceSlot: 'turnaround',
    version: 3,
    policy: 'approved',
    thumb: placeholderThumb('Mabel', 285),
  },
];

export const DINER_SET: ResolvedCandidate = {
  entityCode: 'diner',
  entityName: 'Diner interior',
  category: 'location',
  assetCode: 'diner_ref_sheet',
  referenceSlot: 'ref_sheet',
  version: 3,
  policy: 'approved',
  thumb: placeholderThumb('Diner', 200),
};

/** Materialized query sets per character: Rex has 12 boards, Mabel 8. */
export function storyboardQuerySet(entityCode: string): QuerySetItem[] {
  const count = entityCode === 'rex' ? 12 : 8;
  const baseHue = entityCode === 'rex' ? 20 : 280;
  return Array.from({ length: count }, (_, i) => ({
    assetCode: `${entityCode}_sb_${String(i + 1).padStart(3, '0')}`,
    version: (i % 3) + 1,
    thumb: placeholderThumb(`sb${i + 1}`, baseHue + i * 9),
  }));
}

const WORKFLOW: WorkflowSummary = {
  code: 'storyboard_frame_gen',
  name: 'Storyboard frame generator',
  version: 8,
  ref: 'approved',
  engine: 'nodegraph',
  processes: ['storyboard'],
  description: 'Sketch → rendered board frame, conditioned on shot context.',
};

/**
 * The scanned nexus8 interface of the fixture graph. In the real system this
 * comes from scanning the published graph document for asset nodes.
 */
export const FRAME_ATTACHMENT: WorkflowAttachment = {
  id: 'att-frame-gen',
  workflow: WORKFLOW,
  level: 'process',
  mode: 'iterate',
  graph: {
    nodes: [
      { id: 'n_self', kind: 'self', label: 'Frame sketch', accepts: 'any' },
      {
        id: 'n_char',
        kind: 'entity_ref',
        label: 'Character',
        role: 'character',
        referenceSlot: 'turnaround',
        policy: 'approved',
        accepts: 'image',
      },
      {
        id: 'n_set',
        kind: 'entity_ref',
        label: 'Set',
        role: 'set',
        referenceSlot: 'ref_sheet',
        policy: 'approved',
        accepts: 'image',
      },
      {
        id: 'n_query',
        kind: 'asset_query',
        label: 'Prior boards',
        criteria: { process: 'storyboard', relatedTo: 'n_char', ref: 'approved' },
        accepts: 'image',
      },
      { id: 'n_out', kind: 'output', slot: 'board_frame' },
      { id: 'n_pin', kind: 'pin', label: 'latent@final', dataType: 'latent' },
    ],
    views: [
      {
        name: 'artist_simple',
        params: [
          {
            name: 'prompt',
            label: 'Prompt',
            kind: 'text',
            default: 'rex slides into the corner booth, low angle, dusk light through blinds',
          },
          {
            name: 'denoise',
            label: 'Denoise',
            kind: 'slider',
            default: 0.55,
            min: 0,
            max: 1,
            step: 0.05,
          },
          { name: 'seed', label: 'Seed', kind: 'seed', default: 421 },
        ],
      },
    ],
  },
  viewName: 'artist_simple',
  outputs: [{ slot: 'board_frame', target: 'new_version_of_self' }],
};

/** Container-level attachment used for the shot fan-out plan. */
export const SHOT_ATTACHMENT: WorkflowAttachment = {
  ...FRAME_ATTACHMENT,
  id: 'att-shot-fan-out',
  level: 'container',
};

export const SHOT_CODE = 'sh010';
export const SHOT_CONTEXT_LABEL = 'shot sh010';

/** The shot's 8 storyboard frames, each with its own next version. */
export const SHOT_FRAMES: FanOutRow[] = Array.from({ length: 8 }, (_, i) => {
  const n = i + 1;
  const code = `sb_sh010_fr${String(n).padStart(2, '0')}`;
  const nextVersion = (n % 3) + 2; // v2–v4, varied so rows read realistically
  return {
    frameCode: code,
    frameName: `Frame ${n}`,
    thumb: placeholderThumb(`fr${String(n).padStart(2, '0')}`, 160 + n * 12),
    outcome: {
      description: `Will create v${nextVersion} of ${code}`,
      targetCode: code,
      targetVersion: nextVersion,
    },
    status: 'pending',
  };
});

/** Simulated nodegraph trace for a run of storyboard_frame_gen. */
export const RUN_NODES = [
  'load references',
  'materialize query set',
  'encode prompt',
  'sample (k-euler, 28 steps)',
  'decode latent',
  'deliver outputs',
];

/** Curated reference slots shown on entity pages, keyed by entity category. */
export function referenceSlotsFor(category: string, entityCode: string): ReferenceSlotEntry[] {
  const base = (slot: string, version: number, policy: ReferenceSlotEntry['policy'], hue: number) => ({
    slot,
    assetCode: `${entityCode}_${slot}`,
    assetName: `${entityCode} ${slot.replace('_', ' ')}`,
    version,
    policy,
    thumb: placeholderThumb(slot, hue),
  });
  switch (category) {
    case 'character':
      return [base('turnaround', 5, 'approved', 12), base('ref_sheet', 2, 'latest', 30), base('model', 1, 'pinned', 260)];
    case 'costume':
      return [base('ref_sheet', 2, 'approved', 320)];
    case 'location':
    case 'scene':
      return [base('ref_sheet', 3, 'approved', 200), base('lighting_key', 1, 'latest', 220)];
    case 'prop':
      return [base('ref_sheet', 1, 'latest', 45), base('model', 1, 'pinned', 70)];
    case 'style':
      return [base('style_board', 4, 'approved', 150)];
    default:
      return [];
  }
}
