import { useCallback, useEffect, useState } from 'react'
import { getRenderGrid, selectRender, type RenderGrid } from '../annotatorApi'
import type { AnnotationLayer, GenMode, MaskOp } from '../core/annotations/types'

/** Layer fields a stored render's generation record can restore. */
export type AppliableRenderParams = Partial<
  Pick<
    AnnotationLayer,
    | 'mask_op'
    | 'prompt'
    | 'negative_prompt'
    | 'reference'
    | 'gen_mode'
    | 'controlnet_scale'
    | 'guidance_scale'
    | 'num_inference_steps'
    | 'scribble_scope'
    | 'seed'
    | 'num_variants'
    | 'denoise_strength'
    | 'reference_scale'
  >
>

export interface MaskRegion {
  x: number
  y: number
  w: number
  h: number
}

interface Props {
  assetId: number
  layerId: string
  /** Bump to refetch (e.g. after a generation completes). */
  refreshKey?: number
  /** The star moved: a cell click re-pinned the layer's selected render. */
  onSelectionChanged?: () => void
  /** Write a stored render's recipe back into the layer controls. */
  onApplyParams?: (fields: AppliableRenderParams) => void
  /** Replace the layer's current mask strokes with the run's input strokes. */
  onRestoreMask?: (shapes: unknown[]) => void
}

interface GenerationRecord {
  op?: string
  mask_dims?: MaskRegion
  /** Input strokes at dispatch — present on variation 0 of a run only. */
  mask_shapes?: unknown[]
  prompt?: string
  negative_prompt?: string
  seed?: number
  run_seed?: number
  controlnet_scale?: number
  guidance_scale?: number
  num_inference_steps?: number
  denoise_strength?: number
  reference?: string
  reference_scale?: number
  num_variants?: number
  scribble_mode?: string
  mode?: string
  latency_s?: number
}

/** Backend op strings → the layer's MaskOp values ('erase' runs as 'remove'). */
const OP_TO_MASK_OP: Record<string, MaskOp> = {
  inpaint: 'inpaint',
  scribble: 'scribble',
  sketch_inpaint: 'sketch_inpaint',
  erase: 'remove',
}

function toLayerFields(gen: GenerationRecord, includeSeed: boolean): AppliableRenderParams {
  const fields: AppliableRenderParams = {}
  const op = gen.op ? OP_TO_MASK_OP[gen.op] : undefined
  if (op) fields.mask_op = op
  if (gen.prompt != null) fields.prompt = gen.prompt
  if (gen.negative_prompt != null) fields.negative_prompt = gen.negative_prompt
  if (gen.reference != null) fields.reference = gen.reference
  if (gen.mode === 'fast' || gen.mode === 'quality') fields.gen_mode = gen.mode as GenMode
  if (gen.controlnet_scale != null) fields.controlnet_scale = gen.controlnet_scale
  if (gen.guidance_scale != null) fields.guidance_scale = gen.guidance_scale
  if (gen.num_inference_steps != null) fields.num_inference_steps = gen.num_inference_steps
  if (gen.scribble_mode === 'full' || gen.scribble_mode === 'region') {
    fields.scribble_scope = gen.scribble_mode
  }
  if (gen.num_variants != null) fields.num_variants = gen.num_variants
  if (gen.denoise_strength != null) fields.denoise_strength = gen.denoise_strength
  if (gen.reference_scale != null) fields.reference_scale = gen.reference_scale
  if (includeSeed && gen.seed != null) fields.seed = gen.seed
  return fields
}

/** The readout rows shown in the details card, in display order. */
function paramRows(gen: GenerationRecord): [string, string][] {
  const rows: [string, string][] = []
  const push = (label: string, value: unknown) => {
    if (value != null && value !== '') rows.push([label, String(value)])
  }
  push('op', gen.op)
  push('prompt', gen.prompt)
  push('negative', gen.negative_prompt)
  push('seed', gen.seed)
  push('guidance', gen.guidance_scale)
  push('steps', gen.num_inference_steps)
  push('controlnet', gen.controlnet_scale)
  push('denoise', gen.denoise_strength)
  push('mode', gen.mode)
  push('scope', gen.scribble_mode)
  push('reference', gen.reference)
  push('ref scale', gen.reference_scale)
  push('latency', gen.latency_s != null ? `${gen.latency_s}s` : null)
  return rows
}

function cellKey(v: number, m: number) {
  return `${v}.${m}`
}

/**
 * Contact sheet for a layer's stored renders: runs (rows, newest first) ×
 * variations (columns), from the versions × variations model
 * (LAYER_RENDER_SCHEMA.md). Clicking a cell pins it as the layer's selected
 * render (the audited symlink), which is what the canvas composite displays;
 * ⓘ opens the render's recipe with apply-to-layer actions.
 */
export function RenderHistoryPanel({
  assetId,
  layerId,
  refreshKey = 0,
  onSelectionChanged,
  onApplyParams,
  onRestoreMask,
}: Props) {
  const [grid, setGrid] = useState<RenderGrid | null>(null)
  const [loading, setLoading] = useState(false)
  const [detailsKey, setDetailsKey] = useState<string | null>(null)
  const [appliedNote, setAppliedNote] = useState<string | null>(null)

  const refetch = useCallback(async () => {
    setLoading(true)
    try {
      setGrid(await getRenderGrid(assetId, layerId))
    } catch {
      setGrid(null)
    } finally {
      setLoading(false)
    }
  }, [assetId, layerId])

  useEffect(() => {
    setGrid(null)
    setDetailsKey(null)
    setAppliedNote(null)
  }, [layerId])

  // Mounted only while the History tab is active, so fetch eagerly; refreshKey
  // bumps refetch in place when a generation completes mid-view.
  useEffect(() => {
    void refetch()
  }, [refreshKey, refetch])

  async function handleSelect(versionNumber: number, variationNumber: number) {
    try {
      await selectRender(assetId, layerId, versionNumber, variationNumber)
      setGrid((prev) =>
        prev
          ? {
              ...prev,
              selected: { version_number: versionNumber, variation_number: variationNumber },
            }
          : prev,
      )
      onSelectionChanged?.()
    } catch {
      // Selection failures are non-fatal — the grid keeps its prior state.
    }
  }

  function handleApply(gen: GenerationRecord, key: string, includeSeed: boolean) {
    if (!onApplyParams) return
    onApplyParams(toLayerFields(gen, includeSeed))
    setAppliedNote(`Applied v${key}${includeSeed ? '' : ' (no seed)'}`)
    window.setTimeout(() => setAppliedNote(null), 2000)
  }

  const runCount = grid?.runs.length ?? 0

  // The cell whose recipe is open in the details card.
  const detailsCell = detailsKey
    ? grid?.runs
        .flatMap((r) => r.results)
        .find(
          (c) => cellKey(c.version_number ?? 0, c.variation_number ?? 0) === detailsKey,
        )
    : null
  const detailsGen = (detailsCell?.generation ?? null) as GenerationRecord | null
  // Input strokes live on variation 0 of the run, whichever cell is open.
  const detailsRun = detailsKey
    ? grid?.runs.find((r) => String(r.run) === detailsKey.split('.')[0])
    : null
  const restoreShapes = (detailsRun?.results[0]?.generation as GenerationRecord | undefined)
    ?.mask_shapes

  return (
    <div className="render-history-panel">
      {loading && !grid ? (
        <p className="render-history-panel__empty">Loading…</p>
      ) : !grid || grid.runs.length === 0 ? (
        <p className="render-history-panel__empty">No stored renders for this layer yet.</p>
      ) : (
        <>
          <div className="render-history-panel__count">
            {runCount} run{runCount === 1 ? '' : 's'}
          </div>
          <div className="render-history-panel__runs">
            {grid.runs.map((run) => {
              const gen = run.results[0]?.generation as GenerationRecord | undefined
              return (
                <div key={run.run} className="render-history-panel__run">
                  <div className="render-history-panel__run-header" title={gen?.prompt}>
                    <span className="render-history-panel__run-label">v{run.run}</span>
                    <span className="render-history-panel__run-prompt">
                      {gen?.prompt ?? gen?.op ?? ''}
                    </span>
                  </div>
                  <div className="render-history-panel__cells">
                    {run.results.map((cell) => {
                      const vn = cell.version_number ?? run.run
                      const mn = cell.variation_number ?? 0
                      const key = cellKey(vn, mn)
                      const isSelected =
                        grid.selected?.version_number === vn &&
                        grid.selected?.variation_number === mn
                      const thumb = cell.thumbnails?.['256'] || cell.file_path || undefined
                      return (
                        <div
                          key={key}
                          className={
                            'render-history-panel__cell' +
                            (isSelected ? ' render-history-panel__cell--selected' : '')
                          }
                        >
                          <button
                            type="button"
                            className="render-history-panel__thumb"
                            title={
                              (cell.seed != null
                                ? `v${vn}.${mn} — seed ${cell.seed}`
                                : `v${vn}.${mn}`) + ' — click to display this render'
                            }
                            onClick={() => void handleSelect(vn, mn)}
                          >
                            {thumb ? (
                              <img src={thumb} alt={`v${vn}.${mn}`} loading="lazy" />
                            ) : (
                              <span className="render-history-panel__missing">?</span>
                            )}
                          </button>
                          {isSelected ? (
                            <span
                              className="render-history-panel__star render-history-panel__star--on"
                              title="The layer's selected render"
                            >
                              ★
                            </span>
                          ) : null}
                          {cell.generation ? (
                            <button
                              type="button"
                              className={
                                'render-history-panel__info' +
                                (detailsKey === key ? ' render-history-panel__info--on' : '')
                              }
                              title="View the parameters that created this render"
                              onClick={() =>
                                setDetailsKey((prev) => (prev === key ? null : key))
                              }
                            >
                              ⓘ
                            </button>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>

          {detailsKey && detailsGen ? (
            <div className="render-history-panel__details">
              <div className="render-history-panel__details-header">
                <span>v{detailsKey}</span>
                <button
                  type="button"
                  className="render-history-panel__details-close"
                  onClick={() => setDetailsKey(null)}
                >
                  ✕
                </button>
              </div>
              <dl className="render-history-panel__params">
                {paramRows(detailsGen).map(([label, value]) => (
                  <div key={label} className="render-history-panel__param">
                    <dt>{label}</dt>
                    <dd title={value}>{value}</dd>
                  </div>
                ))}
              </dl>
              {onApplyParams ? (
                <div className="render-history-panel__apply-row">
                  <button
                    type="button"
                    className="render-history-panel__apply"
                    title="Set the layer's op, prompt, seed and settings to this render's recipe"
                    onClick={() => handleApply(detailsGen, detailsKey, true)}
                  >
                    Apply to layer
                  </button>
                  <button
                    type="button"
                    className="render-history-panel__apply render-history-panel__apply--secondary"
                    title="Apply the recipe but keep the seed random"
                    onClick={() => handleApply(detailsGen, detailsKey, false)}
                  >
                    Without seed
                  </button>
                </div>
              ) : null}
              {onRestoreMask && restoreShapes?.length ? (
                <button
                  type="button"
                  className="render-history-panel__apply render-history-panel__apply--secondary"
                  title={`Replace this layer's strokes with the ${restoreShapes.length} stroke${restoreShapes.length === 1 ? '' : 's'} that produced run v${detailsRun?.run} (undo restores the current ones)`}
                  onClick={() => {
                    onRestoreMask(restoreShapes)
                    setAppliedNote(`Restored mask from v${detailsRun?.run}`)
                    window.setTimeout(() => setAppliedNote(null), 2000)
                  }}
                >
                  Restore mask ({restoreShapes.length} stroke{restoreShapes.length === 1 ? '' : 's'})
                </button>
              ) : null}
              {appliedNote ? (
                <p className="render-history-panel__applied-note">{appliedNote}</p>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
