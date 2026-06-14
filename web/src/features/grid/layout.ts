import type { AssetSummary } from '../../api/library';

export interface PlacedItem {
  asset: AssetSummary;
  left: number;
  width: number;
}

export interface GridRow {
  items: PlacedItem[];
  height: number;
}

const MIN_RATIO = 0.45;
const MAX_RATIO = 3;

function aspectRatio(asset: AssetSummary): number {
  const { width, height } = asset;
  if (!width || !height) return 1;
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, width / height));
}

/**
 * Justified-rows layout (Flickr/Google Photos style): items keep their aspect
 * ratio, each row is scaled so it exactly fills the container width.
 */
export function buildRows(
  assets: AssetSummary[],
  containerWidth: number,
  targetHeight: number,
  gap: number,
): GridRow[] {
  if (containerWidth <= 0) return [];

  const rows: GridRow[] = [];
  let current: { asset: AssetSummary; ratio: number }[] = [];
  let ratioSum = 0;

  const flush = (justify: boolean) => {
    if (!current.length) return;
    const gaps = gap * (current.length - 1);
    const height = justify
      ? Math.min((containerWidth - gaps) / ratioSum, targetHeight * 1.8)
      : targetHeight;
    let left = 0;
    const items: PlacedItem[] = current.map(({ asset, ratio }) => {
      const width = height * ratio;
      const item = { asset, left, width };
      left += width + gap;
      return item;
    });
    rows.push({ items, height });
    current = [];
    ratioSum = 0;
  };

  for (const asset of assets) {
    const ratio = aspectRatio(asset);
    current.push({ asset, ratio });
    ratioSum += ratio;
    if (ratioSum * targetHeight + gap * (current.length - 1) >= containerWidth) {
      flush(true);
    }
  }
  flush(false);
  return rows;
}
