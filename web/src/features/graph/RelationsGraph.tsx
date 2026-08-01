import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import dagre from 'dagre';
import { Background, Controls, ReactFlow, type Edge, type Node, Position } from '@xyflow/react';
import { ActionIcon, Chip, Group, Loader, SegmentedControl, Text, Tooltip } from '@mantine/core';
import { IconArrowLeft, IconSitemap } from '@tabler/icons-react';
import '@xyflow/react/dist/style.css';
import {
  getRelationsHop,
  type EdgeKind,
  type RelationEdge,
  type RelationNode,
  type RelationsDirection,
  type RelationsView,
} from '../../api/relationsGraph';

const NODE_W = 188;
const NODE_H = 54;
// Above this many same-(kind,role) siblings under one parent, collapse them
// into a single aggregate node that expands on click.
const AGG_THRESHOLD = 8;

const KIND_STYLE: Record<EdgeKind, { color: string; dash?: string }> = {
  dependency: { color: '#5eead4' },
  relation: { color: '#94a3b8', dash: '2 4' },
  lineage: { color: '#fb923c', dash: '6 3' },
  pointer: { color: '#4ade80', dash: '2 4' },
  layer: { color: '#fbbf24' },
};

const ALL_KINDS: EdgeKind[] = ['dependency', 'relation', 'lineage', 'pointer', 'layer'];

const KIND_CHIPS: { value: EdgeKind; label: string }[] = [
  { value: 'dependency', label: 'Dependencies' },
  { value: 'relation', label: 'Attachments' },
  { value: 'lineage', label: 'Provenance' },
  { value: 'pointer', label: 'Pointers' },
];

// Dependency edges keep the per-type palette from the dependency graph.
const DEP_TYPE_COLOR: Record<string, string> = {
  uses: '#5eead4',
  depends_on: '#38bdf8',
  imports: '#a78bfa',
  references: '#f472b6',
  extends: '#fbbf24',
};

type Hop = { nodes: RelationNode[]; edges: RelationEdge[] };
const bucketKey = (parentId: string, kind: string, role: string) =>
  `${parentId}::${kind}::${role || '—'}`;

function edgeLabel(e: RelationEdge): string | undefined {
  if (e.kind === 'layer') return undefined; // the layer node carries the name
  const base = e.role || e.kind;
  if (e.context.candidates) return `${base} · ${e.context.candidates} takes`;
  const layer = e.context.layer_id;
  return layer ? `${base} · ${layer.slice(0, 8)}` : base;
}

// A node's revealed neighbours, paired with their edge, regardless of which
// side of the edge the parent is on (attachments are direction-agnostic).
function neighborsOf(parentId: string, allEdges: Map<string, RelationEdge>, kinds: Set<EdgeKind>) {
  return [...allEdges.values()]
    .filter((e) => kinds.has(e.kind) && (e.source === parentId || e.target === parentId))
    .map((e) => ({ childId: e.source === parentId ? e.target : e.source, edge: e }));
}

interface BuildResult {
  rfNodes: Node[];
  rfEdges: Edge[];
  count: number;
}

function build(
  rootId: string,
  hops: Record<string, Hop>,
  expanded: Set<string>,
  openedBuckets: Set<string>,
  kinds: Set<EdgeKind>,
): BuildResult {
  const nodeById = new Map<string, RelationNode>();
  const allEdges = new Map<string, RelationEdge>();
  for (const hop of Object.values(hops)) {
    for (const n of hop.nodes) nodeById.set(n.id, n);
    for (const e of hop.edges) allEdges.set(e.id, e);
  }

  const visibleReal = new Set<string>([rootId]);
  const aggregates = new Map<string, { parentId: string; kind: EdgeKind; role: string; count: number }>();
  const edges = new Map<string, RelationEdge>();

  // BFS from the root through the set of expanded nodes. Layer group nodes
  // are synthetic containers delivered with their parent's hop — they have
  // no hop of their own and are always expanded.
  const queue = [rootId];
  const seen = new Set<string>();
  while (queue.length) {
    const p = queue.shift()!;
    if (seen.has(p)) continue;
    seen.add(p);
    const isLayer = nodeById.get(p)?.node_kind === 'layer';
    if (!expanded.has(p) && !isLayer) continue;

    const byBucket = new Map<string, { childId: string; edge: RelationEdge }[]>();
    for (const c of neighborsOf(p, allEdges, kinds)) {
      const key = bucketKey(p, c.edge.kind, c.edge.role);
      const arr = byBucket.get(key) ?? [];
      arr.push(c);
      byBucket.set(key, arr);
    }

    for (const [key, members] of byBucket) {
      const collapsed = members.length > AGG_THRESHOLD && !openedBuckets.has(key);
      if (collapsed) {
        const { kind, role } = members[0].edge;
        aggregates.set(key, { parentId: p, kind, role, count: members.length });
        const aggId = `agg::${key}`;
        edges.set(`${p}->${aggId}`, {
          id: `${p}->${aggId}`,
          source: p,
          target: aggId,
          kind,
          role,
          scope: 'version',
          context: {},
        });
      } else {
        for (const { childId, edge } of members) {
          visibleReal.add(childId);
          edges.set(edge.id, edge);
          queue.push(childId);
        }
      }
    }
  }

  // --- dagre layout over real + aggregate nodes ---
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: 28, ranksep: 60 });
  g.setDefaultEdgeLabel(() => ({}));

  const ids = new Set<string>([...visibleReal, ...[...aggregates.keys()].map((k) => `agg::${k}`)]);
  ids.forEach((id) => g.setNode(id, { width: NODE_W, height: NODE_H }));
  const drawableEdges = [...edges.values()].filter((e) => ids.has(e.source) && ids.has(e.target));
  drawableEdges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);

  const rfNodes: Node[] = [];

  for (const id of visibleReal) {
    const n = nodeById.get(id);
    const pos = g.node(id);
    if (!n || !pos) continue;
    const isRoot = id === rootId;
    const isLayer = n.node_kind === 'layer';
    const isExpanded = isLayer || expanded.has(id);
    const hasChildren = !isLayer && (n.child_count ?? 0) > 0;
    const isEntity = n.node_kind === 'entity';
    const versionLabel =
      n.version_number != null
        ? ` · v${n.version_number}${n.variation_number ? `.${n.variation_number}` : ''}`
        : '';
    rfNodes.push({
      id,
      position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      data: {
        kind: 'real',
        label: (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {n.thumb && (
              <img
                src={n.thumb}
                alt=""
                loading="lazy"
                style={{
                  width: 36,
                  height: 36,
                  objectFit: 'cover',
                  borderRadius: 6,
                  flexShrink: 0,
                  background: 'rgba(148,163,184,0.1)',
                }}
              />
            )}
            <div style={{ lineHeight: 1.2, minWidth: 0 }}>
              <Text size="xs" fw={600} truncate>
                {hasChildren ? (isExpanded ? '▾ ' : '▸ ') : ''}
                {n.entity_name}
                {versionLabel}
              </Text>
              <Text size="10px" c="dimmed" truncate>
                {n.entity_type}
                {isEntity ? ' · all versions' : ''}
                {hasChildren && !isExpanded ? `  ·  +${n.child_count}` : ''}
              </Text>
            </div>
          </div>
        ),
      },
      style: {
        width: NODE_W,
        height: NODE_H,
        borderRadius: 10,
        // Entity nodes are dashed: their edges belong to the asset as a
        // whole, not to one version (scope flag, H1). Layer nodes are amber
        // grouping containers (curated view).
        border: isRoot
          ? '1.5px solid #5eead4'
          : isLayer
            ? '1px solid rgba(251,191,36,0.55)'
            : isEntity
              ? '1px dashed rgba(148,163,184,0.55)'
              : '1px solid rgba(148,163,184,0.25)',
        background: isRoot
          ? 'rgba(94,234,212,0.12)'
          : isLayer
            ? 'rgba(251,191,36,0.08)'
            : 'rgba(15,23,42,0.9)',
        color: '#e2e8f0',
        padding: '6px 10px',
        cursor: hasChildren ? 'pointer' : 'default',
        boxShadow: isRoot ? '0 0 0 3px rgba(94,234,212,0.18)' : undefined,
      },
    });
  }

  for (const [key, agg] of aggregates) {
    const id = `agg::${key}`;
    const pos = g.node(id);
    if (!pos) continue;
    rfNodes.push({
      id,
      position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      data: {
        kind: 'aggregate',
        bucketKey: key,
        label: (
          <div style={{ lineHeight: 1.2, textAlign: 'center' }}>
            <Text size="xs" fw={600} truncate>
              {agg.count} × {agg.role || agg.kind}
            </Text>
            <Text size="10px" c="dimmed">
              click to expand
            </Text>
          </div>
        ),
      },
      style: {
        width: NODE_W,
        height: NODE_H,
        borderRadius: 10,
        border: '1.5px dashed rgba(148,163,184,0.5)',
        background: 'rgba(30,41,59,0.7)',
        color: '#cbd5e1',
        padding: '6px 10px',
        cursor: 'pointer',
      },
    });
  }

  const rfEdges: Edge[] = drawableEdges.map((e) => {
    const style = KIND_STYLE[e.kind];
    const color =
      e.kind === 'dependency'
        ? (DEP_TYPE_COLOR[e.context.relationship_type ?? ''] ?? style.color)
        : style.color;
    const toAgg = e.target.startsWith('agg::');
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      label: toAgg ? undefined : edgeLabel(e),
      labelStyle: { fill: '#94a3b8', fontSize: 10 },
      labelBgStyle: { fill: '#020617' },
      style: {
        stroke: color,
        strokeWidth: 1.5,
        strokeDasharray: toAgg ? '4 3' : style.dash,
      },
      markerEnd: { type: 'arrowclosed', color } as Edge['markerEnd'],
    };
  });

  return { rfNodes, rfEdges, count: visibleReal.size };
}

export interface RelationsGraphProps {
  /** Prefixed node id to center on: "v{versionId}" or "e{entityId}". */
  rootNodeId: string;
  /** Double-clicking a node hands back its entity id (e.g. to navigate). */
  onOpenEntity?: (entityId: number) => void;
  /** Root is a version node: navigate to the dependency graph for it. */
  onOpenDependencies?: (versionId: number) => void;
  /** When provided, renders a back button in the top-left toolbar. */
  onBack?: () => void;
  height?: number | string;
}

export function RelationsGraph({
  rootNodeId,
  onOpenEntity,
  onOpenDependencies,
  onBack,
  height = '100%',
}: RelationsGraphProps) {
  const qc = useQueryClient();

  const [direction, setDirection] = useState<RelationsDirection>('both');
  const [raw, setRaw] = useState(false);
  const [kinds, setKinds] = useState<EdgeKind[]>(KIND_CHIPS.map((c) => c.value));
  const view: RelationsView = raw ? 'raw' : 'curated';
  const [hops, setHops] = useState<Record<string, Hop>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [openedBuckets, setOpenedBuckets] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch one hop (cached + deduped via react-query) and stash it.
  const fetchHop = useCallback(
    async (nodeId: string) => {
      setLoading(true);
      try {
        const data = await qc.fetchQuery({
          queryKey: ['relations-hop', nodeId, direction, view],
          queryFn: () => getRelationsHop(nodeId, direction, view),
          staleTime: 60_000,
        });
        setHops((prev) => ({ ...prev, [nodeId]: { nodes: data.nodes, edges: data.edges } }));
      } finally {
        setLoading(false);
      }
    },
    [qc, direction, view],
  );

  // Reset to root + its first hop whenever the root or direction changes.
  useEffect(() => {
    setHops({});
    setExpanded(new Set([rootNodeId]));
    setOpenedBuckets(new Set());
    fetchHop(rootNodeId);
  }, [rootNodeId, direction, fetchHop]);

  const toggleExpand = useCallback(
    (nodeId: string) => {
      // Layer group nodes are synthetic containers: always expanded, no hop.
      if (nodeId.startsWith('L')) return;
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(nodeId)) next.delete(nodeId);
        else next.add(nodeId);
        return next;
      });
      if (!hops[nodeId]) fetchHop(nodeId);
    },
    [hops, fetchHop],
  );

  const kindSet = useMemo(() => new Set(raw ? kinds : ALL_KINDS), [raw, kinds]);
  const { rfNodes, rfEdges, count } = useMemo(
    () => build(rootNodeId, hops, expanded, openedBuckets, kindSet),
    [rootNodeId, hops, expanded, openedBuckets, kindSet],
  );

  const onNodeClick = useCallback(
    (_: unknown, node: Node) => {
      // Debounce so a double-click (navigate) doesn't also toggle expand.
      if (clickTimer.current) clearTimeout(clickTimer.current);
      clickTimer.current = setTimeout(() => {
        if (node.data?.kind === 'aggregate') {
          setOpenedBuckets((prev) => new Set(prev).add(node.data.bucketKey as string));
        } else {
          toggleExpand(node.id);
        }
      }, 200);
    },
    [toggleExpand],
  );

  const onNodeDoubleClick = useCallback(
    (_: unknown, node: Node) => {
      if (clickTimer.current) clearTimeout(clickTimer.current);
      if (node.data?.kind === 'aggregate') return;
      const found = Object.values(hops)
        .flatMap((h) => h.nodes)
        .find((n) => n.id === node.id);
      if (found && found.entity_id != null) onOpenEntity?.(found.entity_id);
    },
    [hops, onOpenEntity],
  );

  const rootVersionId = rootNodeId.startsWith('v') ? Number(rootNodeId.slice(1)) : null;

  return (
    <div style={{ width: '100%', height, position: 'relative' }}>
      <Group gap="xs" style={{ position: 'absolute', top: 12, left: 12, zIndex: 5 }}>
        {onBack && (
          <Tooltip label="Back">
            <ActionIcon variant="default" size="md" onClick={onBack} aria-label="Back">
              <IconArrowLeft size={17} stroke={1.75} />
            </ActionIcon>
          </Tooltip>
        )}
        {onOpenDependencies && rootVersionId != null && Number.isFinite(rootVersionId) && (
          <Tooltip label="Dependency graph">
            <ActionIcon
              variant="default"
              size="md"
              onClick={() => onOpenDependencies(rootVersionId)}
              aria-label="Dependency graph"
            >
              <IconSitemap size={17} stroke={1.75} />
            </ActionIcon>
          </Tooltip>
        )}
        <SegmentedControl
          size="xs"
          value={direction}
          onChange={(v) => setDirection(v as RelationsDirection)}
          data={[
            { label: 'Made of', value: 'downstream' },
            { label: 'Used in', value: 'upstream' },
            { label: 'Both', value: 'both' },
          ]}
        />
        <Chip size="xs" variant="light" color="orange" checked={raw} onChange={setRaw}>
          Raw edges
        </Chip>
        {raw && (
          <Chip.Group multiple value={kinds} onChange={(v) => setKinds(v as EdgeKind[])}>
            <Group gap={4}>
              {KIND_CHIPS.map((c) => (
                <Chip key={c.value} value={c.value} size="xs" variant="light">
                  {c.label}
                </Chip>
              ))}
            </Group>
          </Chip.Group>
        )}
        {loading && <Loader size={16} />}
      </Group>

      <Text
        size="xs"
        c="dimmed"
        style={{ position: 'absolute', bottom: 12, left: 12, zIndex: 5 }}
      >
        {count} node{count === 1 ? '' : 's'} shown · amber = layer · dashed border = all
        versions · click to expand · double-click to open
      </Text>

      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        fitView
        minZoom={0.2}
        nodesDraggable={false}
        onlyRenderVisibleElements
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="rgba(148,163,184,0.12)" gap={20} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
