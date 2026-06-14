import { useEffect, useRef, useState } from 'react';
import { Image as KonvaImage } from 'react-konva';
import type Konva from 'konva';
import type { AssetSummary } from '../../api/library';
import type { CanvasItem } from '../../api/boards';

interface BoardImageProps {
  item: CanvasItem;
  asset: AssetSummary | undefined;
  selected: boolean;
  onSelect: (id: string, additive: boolean) => void;
  onChange: (item: CanvasItem) => void;
  registerNode: (id: string, node: Konva.Image | null) => void;
}

function bestSource(asset: AssetSummary | undefined): string {
  if (!asset) return '';
  return asset.thumbnails['1024'] || asset.file_path || asset.thumbnails['256'] || '';
}

export function BoardImage({
  item,
  asset,
  selected,
  onSelect,
  onChange,
  registerNode,
}: BoardImageProps) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const nodeRef = useRef<Konva.Image | null>(null);

  useEffect(() => {
    const src = bestSource(asset);
    if (!src) return;
    const img = new window.Image();
    img.src = src;
    img.onload = () => setImage(img);
    return () => {
      img.onload = null;
    };
  }, [asset]);

  return (
    <KonvaImage
      ref={(node) => {
        nodeRef.current = node;
        registerNode(item.id, node);
      }}
      image={image ?? undefined}
      x={item.x}
      y={item.y}
      width={item.width}
      height={item.height}
      rotation={item.rotation}
      draggable
      stroke={selected ? '#5eead4' : undefined}
      strokeWidth={selected ? 2 : 0}
      strokeScaleEnabled={false}
      onClick={(e) => {
        e.cancelBubble = true;
        onSelect(item.id, e.evt.shiftKey);
      }}
      onTap={(e) => {
        e.cancelBubble = true;
        onSelect(item.id, false);
      }}
      onDragEnd={(e) => {
        onChange({ ...item, x: e.target.x(), y: e.target.y() });
      }}
      onTransformEnd={() => {
        const node = nodeRef.current;
        if (!node) return;
        const scaleX = node.scaleX();
        const scaleY = node.scaleY();
        node.scaleX(1);
        node.scaleY(1);
        onChange({
          ...item,
          x: node.x(),
          y: node.y(),
          width: Math.max(20, node.width() * scaleX),
          height: Math.max(20, node.height() * scaleY),
          rotation: node.rotation(),
        });
      }}
    />
  );
}
