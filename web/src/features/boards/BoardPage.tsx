import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'wouter';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ActionIcon, Badge, Button, Text, TextInput, Tooltip } from '@mantine/core';
import {
  IconArrowLeft,
  IconCamera,
  IconLayoutGrid,
  IconShoppingBagPlus,
  IconZoomScan,
} from '@tabler/icons-react';
import {
  getBoard,
  saveBoard,
  snapshotBoard,
  type CanvasDoc,
  type CanvasItem,
} from '../../api/boards';
import type { AssetSummary } from '../../api/library';
import { basketToCanvas, useBasketStore } from '../../stores/basket';
import { BoardCanvas } from './BoardCanvas';

const AUTOSAVE_MS = 1000;
const TIDY_ROW_HEIGHT = 260;
const TIDY_ROW_WIDTH = 1700;
const TIDY_GAP = 24;

function tidy(items: CanvasItem[]): CanvasItem[] {
  let x = 0;
  let y = 0;
  let rowMax = 0;
  return items.map((item) => {
    const ratio = item.width / item.height || 1;
    const width = TIDY_ROW_HEIGHT * ratio;
    if (x + width > TIDY_ROW_WIDTH && x > 0) {
      y += rowMax + TIDY_GAP;
      x = 0;
      rowMax = 0;
    }
    const placed = { ...item, x, y, width, height: TIDY_ROW_HEIGHT, rotation: 0 };
    x += width + TIDY_GAP;
    rowMax = Math.max(rowMax, TIDY_ROW_HEIGHT);
    return placed;
  });
}

export function BoardPage() {
  const params = useParams<{ id: string }>();
  const boardId = Number(params.id);
  const basketItems = useBasketStore((s) => s.items);

  const [doc, setDoc] = useState<CanvasDoc | null>(null);
  const [assets, setAssets] = useState<Record<number, AssetSummary>>({});
  const [name, setName] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [fitSignal, setFitSignal] = useState(0);
  const [saveState, setSaveState] = useState<'saved' | 'dirty' | 'saving'>('saved');
  const [snapshotVersion, setSnapshotVersion] = useState<number | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const board = useQuery({
    queryKey: ['board', boardId],
    queryFn: () => getBoard(boardId),
    enabled: Number.isFinite(boardId),
  });

  // Hydrate local editing state when board data arrives (render-phase derived
  // state — runs once per board id, before children render).
  const [hydratedId, setHydratedId] = useState<number | null>(null);
  if (board.data && hydratedId !== board.data.id) {
    setHydratedId(board.data.id);
    setDoc(board.data.canvas);
    setAssets(board.data.assets);
    setName(board.data.name);
    setSnapshotVersion(board.data.snapshot_version);
    setFitSignal((n) => n + 1);
  }

  const persist = useMutation({
    mutationFn: (patch: { name?: string; canvas?: CanvasDoc }) => saveBoard(boardId, patch),
    onMutate: () => setSaveState('saving'),
    onSuccess: () => setSaveState('saved'),
    onError: () => setSaveState('dirty'),
  });

  const scheduleSave = useCallback(
    (canvas: CanvasDoc) => {
      setSaveState('dirty');
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => persist.mutate({ canvas }), AUTOSAVE_MS);
    },
    [persist],
  );

  const changeDoc = useCallback(
    (next: CanvasDoc) => {
      setDoc(next);
      scheduleSave(next);
    },
    [scheduleSave],
  );

  const snapshot = useMutation({
    mutationFn: () => snapshotBoard(boardId),
    onSuccess: (res) => setSnapshotVersion(res.version_number),
  });

  // Delete/Backspace removes selection (unless typing in an input).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const tag = (document.activeElement?.tagName ?? '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if (!doc || selectedIds.length === 0) return;
      e.preventDefault();
      changeDoc({ ...doc, items: doc.items.filter((i) => !selectedIds.includes(i.id)) });
      setSelectedIds([]);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [doc, selectedIds, changeDoc]);

  const addBasketItems = () => {
    if (!doc || basketItems.length === 0) return;
    // Place the basket cluster to the right of existing content.
    const offsetX = doc.items.length
      ? Math.max(...doc.items.map((i) => i.x + i.width)) + 120
      : 0;
    const cluster = basketToCanvas(basketItems);
    const placed = cluster.items.map((item) => ({ ...item, x: item.x + offsetX }));
    const newAssets = Object.fromEntries(basketItems.map(({ asset }) => [asset.id, asset]));
    setAssets((prev) => ({ ...prev, ...newAssets }));
    changeDoc({ ...doc, items: [...doc.items, ...placed] });
    setFitSignal((n) => n + 1);
  };

  if (board.isError) {
    return (
      <div className="empty-state">
        <p>Board not found.</p>
        <Link href="/boards">Back to boards</Link>
      </div>
    );
  }

  return (
    <>
      <div className="board-toolbar">
        <Tooltip label="All boards">
          <ActionIcon component={Link} href="/boards" variant="subtle" aria-label="Back to boards">
            <IconArrowLeft size={17} stroke={1.75} />
          </ActionIcon>
        </Tooltip>
        <TextInput
          size="xs"
          variant="unstyled"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          onBlur={() => name.trim() && persist.mutate({ name })}
          styles={{ input: { fontWeight: 600, fontSize: '0.9rem', width: 260 } }}
          aria-label="Board name"
        />
        <Text size="xs" c="dimmed">
          {doc?.items.length ?? 0} item{(doc?.items.length ?? 0) === 1 ? '' : 's'}
        </Text>
        <Text size="xs" c="dimmed" aria-live="polite">
          {saveState === 'saved' ? 'Saved' : saveState === 'saving' ? 'Saving…' : 'Unsaved'}
        </Text>
        <div style={{ flex: 1 }} />
        <Button
          size="xs"
          variant="light"
          leftSection={<IconShoppingBagPlus size={15} stroke={1.75} />}
          disabled={basketItems.length === 0}
          onClick={addBasketItems}
        >
          Add basket ({basketItems.length})
        </Button>
        <Tooltip label="Tidy into rows">
          <ActionIcon
            variant="subtle"
            aria-label="Tidy items"
            onClick={() => {
              if (!doc) return;
              changeDoc({ ...doc, items: tidy(doc.items) });
              setFitSignal((n) => n + 1);
            }}
          >
            <IconLayoutGrid size={17} stroke={1.75} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Zoom to fit">
          <ActionIcon
            variant="subtle"
            aria-label="Zoom to fit"
            onClick={() => setFitSignal((n) => n + 1)}
          >
            <IconZoomScan size={17} stroke={1.75} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Publish an immutable snapshot version">
          <Button
            size="xs"
            variant="light"
            leftSection={<IconCamera size={15} stroke={1.75} />}
            loading={snapshot.isPending}
            onClick={() => snapshot.mutate()}
          >
            Snapshot
          </Button>
        </Tooltip>
        {snapshotVersion !== null && <Badge variant="light">v{snapshotVersion}</Badge>}
      </div>

      {doc && (
        <BoardCanvas
          doc={doc}
          assets={assets}
          onChange={changeDoc}
          selectedIds={selectedIds}
          onSelect={setSelectedIds}
          fitSignal={fitSignal}
        />
      )}
    </>
  );
}
