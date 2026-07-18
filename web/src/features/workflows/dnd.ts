/**
 * App-wide asset drag protocol. Any surface that shows an asset (grid cards,
 * basket items, …) can call startAssetDrag in onDragStart; any drop target
 * reads the payload back with readAssetDrag. Media type is mirrored into the
 * dataTransfer *type* list (payload data is unreadable during dragover), so
 * targets can accept/reject while the drag is still in flight.
 */

import type { DragEvent } from 'react';
import type { AssetSummary } from '../../api/library';
import { assetIs3DModel, assetIsVideo, thumbUrl } from '../../api/library';
import { useRunPanelStore } from './runPanelStore';

export const ASSET_DRAG_MIME = 'application/x-nexus8-asset';
const MEDIA_TYPE_PREFIX = 'application/x-nexus8-media-';

export interface DraggedAsset {
  id: number;
  code: string;
  name: string;
  /** Normalized: 'image' | 'video' | 'model' | 'file'. */
  mediaType: string;
  thumb: string;
}

function normalizedMediaType(asset: AssetSummary): string {
  if (assetIsVideo(asset)) return 'video';
  if (assetIs3DModel(asset)) return 'model';
  if (asset.media_type === 'image') return 'image';
  return asset.media_type || 'file';
}

export function startAssetDrag(event: DragEvent, asset: AssetSummary): void {
  const payload: DraggedAsset = {
    id: asset.id,
    code: asset.code,
    name: asset.name,
    mediaType: normalizedMediaType(asset),
    thumb: thumbUrl(asset, 128) || asset.placeholder,
  };
  event.dataTransfer.setData(ASSET_DRAG_MIME, JSON.stringify(payload));
  event.dataTransfer.setData(`${MEDIA_TYPE_PREFIX}${payload.mediaType}`, '1');
  event.dataTransfer.effectAllowed = 'copy';
  useRunPanelStore.getState().setDragging(true);
}

export function endAssetDrag(): void {
  useRunPanelStore.getState().setDragging(false);
}

export function dragHasAsset(event: DragEvent): boolean {
  return event.dataTransfer.types.includes(ASSET_DRAG_MIME);
}

/** Readable during dragover (payload data is not). */
export function draggedMediaType(event: DragEvent): string | null {
  const type = event.dataTransfer.types.find((t) => t.startsWith(MEDIA_TYPE_PREFIX));
  return type ? type.slice(MEDIA_TYPE_PREFIX.length) : null;
}

export function dragAccepted(event: DragEvent, accepts: 'image' | 'video' | 'any'): boolean {
  if (!dragHasAsset(event)) return false;
  if (accepts === 'any') return true;
  const mediaType = draggedMediaType(event);
  // Unknown media type (foreign drag source): be permissive, validate on drop.
  return mediaType === null || mediaType === accepts;
}

export function readAssetDrag(event: DragEvent): DraggedAsset | null {
  const raw = event.dataTransfer.getData(ASSET_DRAG_MIME);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DraggedAsset;
  } catch {
    return null;
  }
}
