import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import dagre from 'dagre';
import { Background, Controls, ReactFlow, type Edge, type Node, Position } from '@xyflow/react';
import { Group, Loader, SegmentedControl, Text } from '@mantine/core';
import '@xyflow/react/dist/style.css';
import { getNeighbors, type GraphEdge, type GraphNode, type GraphDirection } from '../../api/graph';

const NODE_W = 188;
const NODE_H = 54;
// Above this many same-role siblings under one parent, collapse them into a
// single aggregate node that expands on click.
const AGG_THRESHOLD = 8;

const EDGE_COLOR: Record<string, string> = {
  uses: '#5eead4',
  depends_on: '#38bdf8',
  imports: '#a78bfa',
  references: '#f472b6',
  extends: '#fbbf24',
};

type Hop = { nodes: GraphNode[]; edges: GraphEdge[] };
const bucketKey = (parentId: string, role: string) => `${parentId}::${role || '—'}`;

// A node's revealed children in the current direction, paired with their edge.
function childrenOf(parentId: string, hop: Hop, direction: GraphDirection) {
  return hop.edges
    .filter((e) =>
      direction === 'downstream'
        ? e.source === parentId
        : direction === 'upstream'
          ? e.target === parentId
          : e.source === parentId || e.target === parentId,
    )
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
  direction: GraphDirection,
): BuildResult {
  // Index every node we've ever fetched so we can render any revealed id.
  const nodeById = new Map<string, GraphNode>();
  for (const hop of Object.values(hops)) for (const n of hop.nodes) nodeById.set(n.id, n);

  const visibleReal = new Set<string>([rootId]);
  const aggregates = new Map<string, { parentId: string; role: string; count: number }>();
  const edges = new Map<string, GraphEdge>();

  // BFS from the root through the set of expanded nodes.
  const queue = [rootId];
  const seen = new Set<string>();
  while (queue.length) {
    const p = queue.shift()!;
    if (seen.has(p)) continue;
    seen.add(p);
    if (!expanded.has(p)) continue;
    const hop = hops[p];
    if (!hop) continue;

    const byRole = new Map<string, { childId: string; edge: GraphEdge }[]>();
    for (const c of childrenOf(p, hop, direction)) {
      const arr = byRole.get(c.edge.role) ?? [];
      arr.push(c);
      byRole.set(c.edge.role, arr);
    }

    for (const [role, members] of byRole) {
      const key = bucketKey(p, role);
      const collapsed = members.length > AGG_THRESHOLD && !openedBuckets.has(key);
      if (collapsed) {
        aggregates.set(key, { parentId: p, role, count: members.length });
        const aggId = `agg::${key}`;
        edges.set(`${p}->${aggId}`, { id: `${p}->${aggId}`, source: p, target: aggId, relationship_type: 'depends_on', role });
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
    const isExpanded = expanded.has(id);
    const hasChildren = (n.child_count ?? 0) > 0;
    rfNodes.push({
      id,
      position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      data: {
        kind: 'real',
        label: (
          <div style={{ lineHeight: 1.2 }}>
            <Text size="xs" fw={600} truncate>
              {hasChildren ? (isExpanded ? '▾ ' : '▸ ') : ''}
              {n.entity_name} · v{n.version_number}
            </Text>
            <Text size="10px" c="dimmed" truncate>
              {n.entity_type}
              {hasChildren && !isExpanded ? `  ·  +${n.child_count}` : ''}
            </Text>
          </div>
        ),
      },
      style: {
        width: NODE_W,
        height: NODE_H,
        borderRadius: 10,
        border: isRoot ? '1.5px solid #5eead4' : '1px solid rgba(148,163,184,0.25)',
        background: isRoot ? 'rgba(94,234,212,0.12)' : 'rgba(15,23,42,0.9)',
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
              {agg.count} × {agg.role || 'items'}
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
    const color = EDGE_COLOR[e.relationship_type] ?? '#64748b';
    const toAgg = e.target.startsWith('agg::');
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      label: toAgg ? undefined : e.role || e.relationship_type,
      labelStyle: { fill: '#94a3b8', fontSize: 10 },
      labelBgStyle: { fill: '#020617' },
      style: { stroke: color, strokeWidth: 1.5, strokeDasharray: toAgg ? '4 3' : undefined },
      markerEnd: { type: 'arrowclosed', color } as Edge['markerEnd'],
    };
  });

  return { rfNodes, rfEdges, count: visibleReal.size };
}

export interface DependencyGraphProps {
  /** Version id to center the graph on. */
  versionId: number;
  /** Double-clicking a node hands back its entity id (e.g. to navigate). */
  onOpenEntity?: (entityId: number) => void;
  height?: number | string;
}

export function DependencyGraph({ versionId, onOpenEntity, height = '100%' }: DependencyGraphProps) {
  const qc = useQueryClient();
  const rootId = String(versionId);

  const [direction, setDirection] = useState<GraphDirection>('downstream');
  const [hops, setHops] = useState<Record<string, Hop>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [openedBuckets, setOpenedBuckets] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch one hop (cached + deduped via react-query) and stash it.
  const fetchHop = useCallback(
    async (vid: string) => {
      setLoading(true);
      try {
        const data = await qc.fetchQuery({
          queryKey: ['graph-hop', vid, direction],
          queryFn: () => getNeighbors(Number(vid), direction),
          staleTime: 60_000,
        });
        setHops((prev) => ({ ...prev, [vid]: { nodes: data.nodes, edges: data.edges } }));
      } finally {
        setLoading(false);
      }
    },
    [qc, direction],
  );

  // Reset to root + its first hop whenever the root or direction changes.
  useEffect(() => {
    setHops({});
    setExpanded(new Set([rootId]));
    setOpenedBuckets(new Set());
    fetchHop(rootId);
  }, [rootId, direction, fetchHop]);

  const toggleExpand = useCallback(
    (vid: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(vid)) next.delete(vid);
        else next.add(vid);
        return next;
      });
      if (!hops[vid]) fetchHop(vid);
    },
    [hops, fetchHop],
  );

  const { rfNodes, rfEdges, count } = useMemo(
    () => build(rootId, hops, expanded, openedBuckets, direction),
    [rootId, hops, expanded, openedBuckets, direction],
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
      if (found) onOpenEntity?.(found.entity_id);
    },
    [hops, onOpenEntity],
  );

  return (
    <div style={{ width: '100%', height, position: 'relative' }}>
      <Group gap="xs" style={{ position: 'absolute', top: 12, left: 12, zIndex: 5 }}>
        <SegmentedControl
          size="xs"
          value={direction}
          onChange={(v) => setDirection(v as GraphDirection)}
          data={[
            { label: 'Uses', value: 'downstream' },
            { label: 'Used by', value: 'upstream' },
            { label: 'Both', value: 'both' },
          ]}
        />
        {loading && <Loader size={16} />}
      </Group>

      <Text
        size="xs"
        c="dimmed"
        style={{ position: 'absolute', bottom: 12, left: 12, zIndex: 5 }}
      >
        {count} node{count === 1 ? '' : 's'} shown · click to expand · double-click to open
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
