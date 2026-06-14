import { useEffect, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useElementSize, useMergedRef } from '@mantine/hooks';
import { Loader } from '@mantine/core';
import { IconPhotoSearch } from '@tabler/icons-react';
import type { AssetSummary } from '../../api/library';
import { AssetCard } from './AssetCard';
import { buildRows } from './layout';

const GAP = 10;

interface AssetGridProps {
  assets: AssetSummary[];
  onOpen: (asset: AssetSummary) => void;
  rowHeight?: number;
  hasMore?: boolean;
  isFetching?: boolean;
  fetchMore?: () => void;
  emptyMessage?: string;
}

export function AssetGrid({
  assets,
  onOpen,
  rowHeight = 220,
  hasMore = false,
  isFetching = false,
  fetchMore,
  emptyMessage = 'No assets found. Try a different search, or drop images anywhere to add them.',
}: AssetGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { ref: sizeRef, width } = useElementSize();
  const mergedRef = useMergedRef(scrollRef, sizeRef);

  // Grid padding is 1.25rem each side (see .grid-scroll).
  const innerWidth = Math.max(0, width - 40);

  const rows = useMemo(
    () => buildRows(assets, innerWidth, rowHeight, GAP),
    [assets, innerWidth, rowHeight],
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => rows[index].height + GAP,
    overscan: 5,
  });

  const virtualItems = virtualizer.getVirtualItems();

  useEffect(() => {
    const last = virtualItems[virtualItems.length - 1];
    if (last && hasMore && !isFetching && last.index >= rows.length - 3) {
      fetchMore?.();
    }
  }, [virtualItems, hasMore, isFetching, rows.length, fetchMore]);

  return (
    <div className="grid-scroll" ref={mergedRef}>
      {assets.length === 0 && !isFetching ? (
        <div className="empty-state">
          <IconPhotoSearch size={36} stroke={1.4} />
          <p style={{ maxWidth: 420, margin: 0 }}>{emptyMessage}</p>
        </div>
      ) : (
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualItems.map((virtualRow) => {
            const row = rows[virtualRow.index];
            return row.items.map(({ asset, left, width: itemWidth }) => (
              <AssetCard
                key={asset.id}
                asset={asset}
                left={left}
                top={virtualRow.start}
                width={itemWidth}
                height={row.height}
                onOpen={onOpen}
              />
            ));
          })}
        </div>
      )}
      {isFetching && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '1.5rem' }}>
          <Loader size="sm" type="oval" />
        </div>
      )}
    </div>
  );
}
