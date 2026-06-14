import { useCallback, useEffect, useRef, useState } from 'react';
import { Layer, Stage, Transformer } from 'react-konva';
import type Konva from 'konva';
import { useElementSize } from '@mantine/hooks';
import type { AssetSummary } from '../../api/library';
import type { CanvasDoc, CanvasItem } from '../../api/boards';
import { BoardImage } from './BoardImage';

const ZOOM_FACTOR = 1.06;
const MIN_SCALE = 0.05;
const MAX_SCALE = 8;

function computeFitView(items: CanvasItem[], width: number, height: number) {
  const xs = items.flatMap((i) => [i.x, i.x + i.width]);
  const ys = items.flatMap((i) => [i.y, i.y + i.height]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const pad = 80;
  const scale = Math.min(
    MAX_SCALE,
    Math.max(
      MIN_SCALE,
      Math.min((width - pad * 2) / (maxX - minX || 1), (height - pad * 2) / (maxY - minY || 1)),
    ),
  );
  return {
    scale,
    x: (width - (maxX - minX) * scale) / 2 - minX * scale,
    y: (height - (maxY - minY) * scale) / 2 - minY * scale,
  };
}

export interface BoardCanvasHandle {
  zoomToFit: () => void;
}

interface BoardCanvasProps {
  doc: CanvasDoc;
  assets: Record<number, AssetSummary>;
  onChange: (doc: CanvasDoc) => void;
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
  fitSignal: number;
}

export function BoardCanvas({
  doc,
  assets,
  onChange,
  selectedIds,
  onSelect,
  fitSignal,
}: BoardCanvasProps) {
  const { ref: sizeRef, width, height } = useElementSize();
  const stageRef = useRef<Konva.Stage | null>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const nodesRef = useRef(new Map<string, Konva.Image>());
  const [view, setView] = useState({ scale: 1, x: 60, y: 60 });

  const registerNode = useCallback((id: string, node: Konva.Image | null) => {
    if (node) nodesRef.current.set(id, node);
    else nodesRef.current.delete(id);
  }, []);

  // Attach the transformer to the selected Konva nodes.
  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) return;
    const nodes = selectedIds
      .map((id) => nodesRef.current.get(id))
      .filter((n): n is Konva.Image => Boolean(n));
    transformer.nodes(nodes);
  }, [selectedIds, doc.items]);

  const updateItem = useCallback(
    (updated: CanvasItem) => {
      onChange({
        ...doc,
        items: doc.items.map((item) => (item.id === updated.id ? updated : item)),
      });
    },
    [doc, onChange],
  );

  const handleWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    setView((view) => {
      const direction = e.evt.deltaY > 0 ? -1 : 1;
      const scale = Math.min(
        MAX_SCALE,
        Math.max(MIN_SCALE, direction > 0 ? view.scale * ZOOM_FACTOR : view.scale / ZOOM_FACTOR),
      );
      const worldX = (pointer.x - view.x) / view.scale;
      const worldY = (pointer.y - view.y) / view.scale;
      return { scale, x: pointer.x - worldX * scale, y: pointer.y - worldY * scale };
    });
  }, []);

  // Parent bumps fitSignal to request zoom-to-fit (initial load, Fit button).
  // Consumed during render (not in an effect) and only once the canvas has a
  // measured size, so a fit requested before layout still applies correctly.
  const [consumedFit, setConsumedFit] = useState(0);
  if (fitSignal !== consumedFit && width > 0 && height > 0 && doc.items.length > 0) {
    setConsumedFit(fitSignal);
    setView(computeFitView(doc.items, width, height));
  }

  return (
    <div className="board-canvas-wrap" ref={sizeRef}>
      <Stage
        ref={stageRef}
        width={width}
        height={height}
        scaleX={view.scale}
        scaleY={view.scale}
        x={view.x}
        y={view.y}
        draggable
        onWheel={handleWheel}
        onDragEnd={(e) => {
          if (e.target === stageRef.current) {
            setView((v) => ({ ...v, x: e.target.x(), y: e.target.y() }));
          }
        }}
        onMouseDown={(e) => {
          if (e.target === stageRef.current) onSelect([]);
        }}
        onTouchStart={(e) => {
          if (e.target === stageRef.current) onSelect([]);
        }}
      >
        <Layer>
          {doc.items.map((item) => (
            <BoardImage
              key={item.id}
              item={item}
              asset={assets[item.asset_id]}
              selected={selectedIds.includes(item.id)}
              onSelect={(id, additive) =>
                onSelect(
                  additive
                    ? selectedIds.includes(id)
                      ? selectedIds.filter((s) => s !== id)
                      : [...selectedIds, id]
                    : [id],
                )
              }
              onChange={updateItem}
              registerNode={registerNode}
            />
          ))}
          <Transformer
            ref={transformerRef}
            rotateEnabled
            flipEnabled={false}
            borderStroke="#5eead4"
            anchorStroke="#5eead4"
            anchorFill="#020617"
            anchorSize={8}
          />
        </Layer>
      </Stage>
    </div>
  );
}
