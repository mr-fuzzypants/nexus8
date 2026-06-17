import { useEffect, useState } from 'react'
import { ActionIcon, Tooltip } from '@mantine/core'
import { IconEye, IconEyeOff } from '@tabler/icons-react'
import type { AssetSummary } from '../../api/library'
import type { VersionNode } from '../../api/versions'
import type { AnnotationEntity } from '../annotator/core/annotations/types'
import type { ViewerAdapter } from '../annotator/core/viewers/adapters'
import { createAssetViewerAdapter } from './createAssetAdapter'
import { loadReadOnlyAnnotations } from './loadReadOnlyAnnotations'
import { ViewerSurface } from './ViewerSurface'
import './viewer.css'

interface AssetViewerProps {
  asset: AssetSummary
  /** View a specific version's media instead of the asset's current file. */
  version?: VersionNode | null
}

/**
 * Self-contained, read-only viewer for an asset (or one of its versions). Picks
 * the right surface (2D / video / 3D), overlays the asset's annotations with a
 * show/hide toggle, and owns nothing about authoring. Drop it anywhere — a detail
 * panel, a floating window, a full-screen route.
 */
export function AssetViewer({ asset, version }: AssetViewerProps) {
  const src = version?.file_path ?? asset.file_path
  const [adapter, setAdapter] = useState<ViewerAdapter | null>(null)
  const [annotations, setAnnotations] = useState<AnnotationEntity[]>([])
  const [showAnnotations, setShowAnnotations] = useState(true)

  // Build the adapter for this asset/version. Disposal of the live surface is
  // handled inside ViewerSurface when the adapter reference changes; the previous
  // adapter stays mounted until the next resolves (no flash of empty surface).
  useEffect(() => {
    let cancelled = false
    createAssetViewerAdapter({ asset, src, label: asset.name }).then(({ adapter: next }) => {
      if (!cancelled) {
        setAdapter(next)
      }
    })
    return () => {
      cancelled = true
    }
  }, [asset, src])

  // Annotations bind to the asset (not a version), so load them per asset. Stale
  // annotations from a previous asset are filtered out by ViewerSurface (targetId).
  useEffect(() => {
    let cancelled = false
    loadReadOnlyAnnotations(asset.id)
      .then((next) => {
        if (!cancelled) {
          setAnnotations(next)
        }
      })
      .catch(() => {
        // View still works without annotations.
      })
    return () => {
      cancelled = true
    }
  }, [asset.id])

  return (
    <div className="asset-viewer">
      <div className="asset-viewer__chrome">
        <Tooltip label={showAnnotations ? 'Hide annotations' : 'Show annotations'}>
          <ActionIcon
            variant={showAnnotations ? 'light' : 'subtle'}
            color="teal"
            size="md"
            onClick={() => setShowAnnotations((value) => !value)}
            disabled={annotations.length === 0}
            aria-label="Toggle annotations"
          >
            {showAnnotations ? <IconEye size={17} stroke={1.75} /> : <IconEyeOff size={17} stroke={1.75} />}
          </ActionIcon>
        </Tooltip>
        {annotations.length > 0 ? (
          <span className="asset-viewer__count">{annotations.length} annotation{annotations.length === 1 ? '' : 's'}</span>
        ) : null}
      </div>
      <div className="asset-viewer__body">
        {adapter ? (
          <ViewerSurface adapter={adapter} annotations={annotations} showAnnotations={showAnnotations} />
        ) : (
          <div className="asset-viewer__placeholder">
            <span className="viewer-loading-spinner" aria-hidden />
            <span>Preparing viewer…</span>
          </div>
        )}
      </div>
    </div>
  )
}
