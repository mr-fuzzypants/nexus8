import { assetIs3DModel, assetIsVideo, type AssetSummary } from '../../api/library'
import type { ViewerAdapter } from '../annotator/core/viewers/adapters'
import { createTiledImageViewerAdapter } from '../annotator/core/viewers/tiledImageAdapter'
import { createVideoViewerAdapter } from '../annotator/core/viewers/videoAdapter'

export type AssetMediaKind = 'image' | 'video' | 'model'

/** Classify an asset into the viewer it should open in. */
export function assetMediaKind(asset: AssetSummary): AssetMediaKind {
  if (assetIsVideo(asset)) return 'video'
  if (assetIs3DModel(asset)) return 'model'
  return 'image'
}

export interface CreateAssetAdapterOptions {
  asset: AssetSummary
  /** Override the media source, e.g. a specific version's file_path. */
  src?: string
  /** Annotation binding id; defaults to `asset-<id>` so docs round-trip per asset. */
  targetId?: string
  label?: string
}

/**
 * Build the correct viewer adapter (2D tiled / video / 3D model) for an asset or
 * one of its versions. The three.js adapter is dynamically imported so image and
 * video views never pull the 3D bundle. Shared by the editing annotator and the
 * read-only floating viewer so viewer selection lives in exactly one place.
 */
export async function createAssetViewerAdapter({
  asset,
  src,
  targetId,
  label,
}: CreateAssetAdapterOptions): Promise<{ adapter: ViewerAdapter; kind: AssetMediaKind }> {
  const kind = assetMediaKind(asset)
  const resolvedTarget = targetId ?? `asset-${asset.id}`
  const resolvedSrc = src ?? asset.file_path
  const resolvedLabel = label ?? asset.name

  if (kind === 'model') {
    const { createThreeModelViewerAdapter } = await import(
      '../annotator/core/viewers/threeModelViewerAdapter'
    )
    return {
      kind,
      adapter: createThreeModelViewerAdapter({
        src: resolvedSrc,
        targetId: resolvedTarget,
        label: resolvedLabel,
      }),
    }
  }

  if (kind === 'video') {
    return {
      kind,
      adapter: createVideoViewerAdapter(
        [{ id: resolvedTarget, src: resolvedSrc, label: resolvedLabel }],
        { targetId: resolvedTarget, frameRate: asset.fps ?? undefined },
      ),
    }
  }

  return {
    kind,
    adapter: createTiledImageViewerAdapter({
      imageUrl: resolvedSrc,
      targetId: resolvedTarget,
      width: asset.width ?? undefined,
      height: asset.height ?? undefined,
    }),
  }
}
