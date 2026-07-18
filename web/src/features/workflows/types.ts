/**
 * Workflow-integration contract (mockup, round 2 — graph-derived).
 *
 * The graph carries its own nexus8 interface: typed asset nodes declare what
 * content enters (Self, Entity Reference, Asset Query) and leaves (Output,
 * Pin) a workflow. nexus8 derives the run form by scanning the graph;
 * Control Surface Views contribute only parameter exposure. These types
 * mirror the future intent API: resolve (pure) → confirm (creates a Run
 * Intent that pins everything, including materialized query sets and which
 * pins are armed).
 */

export type AttachmentMode = 'iterate' | 'derive' | 'custom';
export type VersionPolicy = 'approved' | 'latest' | 'pinned';

export interface WorkflowSummary {
  code: string;
  name: string;
  version: number;
  /** Symlink or version ref the attachment pins ("approved", "v7"). */
  ref: string;
  engine: 'nodegraph' | 'comfyui';
  processes: string[];
  description: string;
}

export interface ExposedParam {
  name: string;
  label: string;
  kind: 'text' | 'number' | 'slider' | 'seed';
  default: string | number;
  min?: number;
  max?: number;
  step?: number;
}

// ---- Asset nodes: the graph's nexus8 interface ----

export type AssetNodeKind = 'self' | 'entity_ref' | 'asset_query' | 'output' | 'pin';

interface AssetNodeBase {
  /** Stable node id in the graph document. */
  id: string;
  kind: AssetNodeKind;
}

/** What media a droppable input accepts. */
export type AcceptedMedia = 'image' | 'video' | 'any';

/** The asset the run targets — auto-bound at launch. */
export interface SelfNode extends AssetNodeBase {
  kind: 'self';
  label: string;
  accepts: AcceptedMedia;
}

/** A context entity resolved through a named reference slot. */
export interface EntityRefNode extends AssetNodeBase {
  kind: 'entity_ref';
  label: string;
  /** Context role resolved from the shot ('character', 'set', 'prop'…). */
  role: string;
  /** Named reference slot on the resolved entity ('turnaround', 'ref_sheet'). */
  referenceSlot: string;
  policy: VersionPolicy;
  accepts: AcceptedMedia;
}

/** Criteria → list, materialized and pinned at intent time. */
export interface AssetQueryNode extends AssetNodeBase {
  kind: 'asset_query';
  label: string;
  criteria: {
    process: string;
    /** Node id of the EntityRefNode this query depends on. */
    relatedTo: string;
    ref: VersionPolicy;
  };
  accepts: AcceptedMedia;
}

/** Declares a deliverable slot — attach-time bindings map slots → targets. */
export interface OutputNode extends AssetNodeBase {
  kind: 'output';
  slot: string;
}

/** Declares a keepable intermediate; each run arms or skips it. */
export interface PinNode extends AssetNodeBase {
  kind: 'pin';
  label: string;
  dataType: string;
}

export type AssetNode = SelfNode | EntityRefNode | AssetQueryNode | OutputNode | PinNode;

/** The scanned nexus8 interface of a published workflow graph. */
export interface WorkflowGraphInterface {
  nodes: AssetNode[];
  /** Views available for parameter exposure; attachment picks one. */
  views: Array<{ name: string; params: ExposedParam[] }>;
}

/** Declared destination for one Output slot — never named by the engine. */
export interface OutputBinding {
  slot: string;
  target: 'new_version_of_self' | 'new_asset' | 'discard';
  /** For new_asset: deterministic template from the source, e.g. "{source}_depth". */
  nameTemplate?: string;
  process?: string;
}

export interface WorkflowAttachment {
  id: string;
  workflow: WorkflowSummary;
  level: 'process' | 'asset' | 'container';
  mode: AttachmentMode;
  graph: WorkflowGraphInterface;
  /** Which view renders the parameter section of the run form. */
  viewName: string;
  outputs: OutputBinding[];
}

// ---- Resolve phase (pure) ----

/** One concrete entity/asset/version an input resolved to. */
export interface ResolvedCandidate {
  entityCode: string;
  entityName: string;
  category: string;
  assetCode: string;
  referenceSlot?: string;
  version: number;
  policy: VersionPolicy;
  thumb: string;
}

export interface QuerySetItem {
  assetCode: string;
  version: number;
  thumb: string;
}

export type InputResolution =
  | { node: SelfNode | EntityRefNode; status: 'resolved'; chosen: ResolvedCandidate[] }
  | { node: EntityRefNode; status: 'ambiguous'; candidates: ResolvedCandidate[] }
  | {
      node: AssetQueryNode;
      status: 'query';
      /** "12 storyboard images of Rex · approved" — or null until deps resolve. */
      summary: string | null;
      set: QuerySetItem[];
    };

export interface PlannedOutcome {
  /** Plain-language line shown to the artist ("Will create v4 of …"). */
  description: string;
  targetCode: string;
  targetVersion: number | null;
}

/** Result of the pure resolve phase — nothing is created yet. */
export interface ResolutionProposal {
  attachmentId: string;
  target: { code: string; name: string };
  /** Where context came from, e.g. "shot sh010". */
  contextLabel: string | null;
  inputs: InputResolution[];
  /** Pin nodes available for per-run arming (default off). */
  pins: PinNode[];
  /** Derived from Output nodes + the attachment's output bindings. */
  outcomes: PlannedOutcome[];
  viewName: string;
}

// ---- Confirm phase ----

export interface RunNodeStatus {
  node: string;
  status: 'pending' | 'running' | 'done';
}

export interface RunIntent {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'pending';
  nodes: RunNodeStatus[];
  outcomes: PlannedOutcome[];
  /** Labels of Pin nodes armed for this run. */
  armedPins: string[];
  seed: number;
  engineRunId: string;
  errorMessage: string;
  createdAt: string;
}

// ---- Fan-out ----

export interface FanOutRow {
  frameCode: string;
  frameName: string;
  thumb: string;
  outcome: PlannedOutcome;
  status: 'pending' | 'queued' | 'running' | 'done';
}

export interface FanOutPlan {
  shotCode: string;
  attachment: WorkflowAttachment;
  /** Context inputs shared by every row, shown once. */
  shared: InputResolution[];
  rows: FanOutRow[];
}

// ---- Reference slots (entity pages) ----

/** A curated named reference slot on an entity (character.turnaround, …). */
export interface ReferenceSlotEntry {
  slot: string;
  assetCode: string;
  assetName: string;
  version: number;
  policy: VersionPolicy;
  thumb: string;
}
