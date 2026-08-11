import { Fragment, useRef, useState } from 'react'
import { Eye, EyeOff, ChevronUp, ChevronDown, CornerDownRight, Eraser, GitBranch, Image, ImageOff, Plus, Stamp, Trash2, Wand2, Stethoscope, X } from 'lucide-react'
import type { AnnotationLayer, LayerOpType } from '../core/annotations/types'
import type { MaskTrackVersionSummary } from '../../../api/videoMasks'

/** Short label for a mask take: how the version was produced. */
function maskTakeLabel(t: MaskTrackVersionSummary): string {
  if (t.manual) return 'manual'
  const model = t.model ?? '?'
  if (t.manual_correction) return `${model}+paint`
  if (t.corrected) return `${model}+corr`
  return model
}

const LAYER_OP_LABELS: Record<LayerOpType, string> = {
  automask: 'Automask · SAM 2',
  manual_mask: 'Manual mask',
  remove: 'Remove',
}

/** A durable removal-result take (one generation run) shown on a result row. */
export interface ResultTakeSummary {
  run: number
  spanStart: number
  spanEnd: number
  tier?: string
}

interface MaskLayersPanelProps {
  layers: AnnotationLayer[]
  activeLayerId: string | null
  maskGenerateState: Record<string, 'idle' | 'working' | string>
  isVideo?: boolean
  onSelectLayer: (id: string) => void
  onAddLayer: () => void
  onRemoveLayer: (id: string) => void
  onRenameLayer: (id: string, name: string) => void
  onToggleVisibility: (id: string) => void
  onToggleRenderVisibility: (id: string) => void
  onMoveLayerUp: (id: string) => void
  onMoveLayerDown: (id: string) => void
  onGenerateMask: (id: string) => void
  onPropagateMask?: (id: string) => void
  /** Span-limited re-propagation from the earliest edited frame. */
  onCorrectMask?: (id: string) => void
  /** Generative removal of the tracked object (tier from the layer's Gen mode). */
  onRemoveObject?: (id: string) => void
  /** Bake: store the layer's paint directly as a mask-track version (no GPU).
   *  With pending edits on an existing track, overlays them as corrections. */
  onBakeMask?: (id: string) => void
  /** Append an operation to the layer's serial op stack (the + op menu). */
  onAppendOp?: (layerId: string, type: LayerOpType) => void
  /** Remove a never-run op from the stack. */
  onRemoveOp?: (layerId: string, opId: string) => void
  /** Create a chained layer operating on this layer's pinned removal take.
   *  With opType (full-stack appender), the op is appended in the same gesture. */
  onChainFromResult?: (layerId: string, opType?: LayerOpType) => void
  /** Takes of each layer's mask track (one per version) — the Mask row. */
  maskTakes?: Record<string, MaskTrackVersionSummary[]>
  /** Pin a mask take (the version the overlay serves and removal consumes). */
  onSelectMaskTake?: (layerId: string, versionId: string) => void
  /** Layer ids that already have a propagated track (enables Correct). */
  trackedLayerIds?: Record<string, boolean>
  /** Durable removal results per layer — rendered as nested result rows with
   *  a take selector (one take per generation run). Video only. */
  resultTracks?: Record<string, { takes: ResultTakeSummary[]; selectedRun: number | null }>
  /** Switch the pinned take for a layer's result track. */
  onSelectResultTake?: (layerId: string, run: number) => void
  /** Click on a result row: select the layer AND seek to the take's span. */
  onFocusResult?: (layerId: string) => void
  /** SAM mask overlay opacity (0–1; 0 = hidden). */
  maskOverlayOpacity?: number
  onMaskOverlayOpacityChange?: (v: number) => void
  /** Prompt display: 'result' (clean mask) | 'edit' (markers) | 'soloNeg'. */
  promptDisplay?: 'result' | 'edit' | 'soloNeg'
  onPromptDisplayChange?: (mode: 'result' | 'edit' | 'soloNeg') => void
  /** Delete the active layer's negative strokes on the current frame. */
  onClearNegatives?: (layerId: string) => void
}

export function MaskLayersPanel({
  layers,
  activeLayerId,
  maskGenerateState,
  isVideo,
  onSelectLayer,
  onAddLayer,
  onRemoveLayer,
  onRenameLayer,
  onToggleVisibility,
  onToggleRenderVisibility,
  onMoveLayerUp,
  onMoveLayerDown,
  onGenerateMask,
  onPropagateMask,
  onCorrectMask,
  onRemoveObject,
  onBakeMask,
  onAppendOp,
  onRemoveOp,
  onChainFromResult,
  maskTakes,
  onSelectMaskTake,
  resultTracks,
  onSelectResultTake,
  onFocusResult,
  trackedLayerIds,
  maskOverlayOpacity = 0.45,
  onMaskOverlayOpacityChange,
  promptDisplay = 'result',
  onPromptDisplayChange,
  onClearNegatives,
}: MaskLayersPanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  // Per-layer op choice in the add-op sub-row (the + button appends it).
  const [pendingOpType, setPendingOpType] = useState<Record<string, LayerOpType>>({})
  const inputRef = useRef<HTMLInputElement>(null)

  function beginRename(layer: AnnotationLayer) {
    setEditingId(layer.id)
    setEditingName(layer.name)
    requestAnimationFrame(() => inputRef.current?.select())
  }

  function commitRename(id: string) {
    const trimmed = editingName.trim()
    if (trimmed) {
      onRenameLayer(id, trimmed)
    }
    setEditingId(null)
  }

  // Chained layers render nested under their source layer (depth-indented);
  // a layer whose source is missing from the doc falls back to top level.
  const layerEntries: Array<{ layer: AnnotationLayer; depth: number }> = []
  {
    const bySource = new Map<string, AnnotationLayer[]>()
    const roots: AnnotationLayer[] = []
    for (const l of layers) {
      const srcId = l.source?.layerId
      if (srcId && layers.some((x) => x.id === srcId)) {
        bySource.set(srcId, [...(bySource.get(srcId) ?? []), l])
      } else {
        roots.push(l)
      }
    }
    const visit = (l: AnnotationLayer, depth: number) => {
      layerEntries.push({ layer: l, depth })
      for (const child of bySource.get(l.id) ?? []) visit(child, depth + 1)
    }
    roots.forEach((l) => visit(l, 0))
  }

  return (
    <aside className="mask-layers-panel">
      <header className="mask-layers-panel__header">
        <span className="mask-layers-panel__title">Mask layers</span>
        <button
          className="mask-layers-panel__add"
          onClick={onAddLayer}
          title="Add mask layer"
          type="button"
        >
          <Plus size={14} strokeWidth={2.5} />
        </button>
      </header>

      {isVideo && onMaskOverlayOpacityChange ? (
        <div className="mask-layers-panel__prompt-mode">
          <span className="mask-layers-panel__prompt-mode-label">Mask</span>
          <input
            className="mask-layers-panel__opacity"
            type="range"
            min={0}
            max={100}
            value={Math.round(maskOverlayOpacity * 100)}
            onChange={(e) => onMaskOverlayOpacityChange(Number(e.target.value) / 100)}
            title="SAM mask overlay opacity (0 = hidden)"
          />
        </div>
      ) : null}

      {isVideo && onPromptDisplayChange ? (
        <div className="mask-layers-panel__prompt-mode" role="group" aria-label="Prompt display">
          <span className="mask-layers-panel__prompt-mode-label">Prompts</span>
          <div className="mask-layers-panel__prompt-mode-toggle">
            <button
              type="button"
              className={promptDisplay === 'result' ? 'is-active' : ''}
              onClick={() => onPromptDisplayChange('result')}
              title="Result: clean mask; erases shown as the mask receding, no stroke markers."
            >
              Result
            </button>
            <button
              type="button"
              className={promptDisplay === 'edit' ? 'is-active' : ''}
              onClick={() => onPromptDisplayChange('edit')}
              title="Edit: show positive + negative strokes as selectable markers (Select tool to delete)."
            >
              Edit
            </button>
            <button
              type="button"
              className={promptDisplay === 'soloNeg' ? 'is-active' : ''}
              onClick={() => onPromptDisplayChange('soloNeg')}
              title="Neg: show only negative (erase) strokes — isolate them to select and delete."
            >
              Neg
            </button>
          </div>
          {activeLayerId && onClearNegatives ? (
            <button
              type="button"
              className="mask-layers-panel__clear-neg"
              onClick={() => onClearNegatives(activeLayerId)}
              title="Delete this layer's negative strokes on the current frame"
            >
              Clear −
            </button>
          ) : null}
        </div>
      ) : null}

      {layers.length === 0 ? (
        <div className="mask-layers-panel__empty">
          No layers yet. Click + to add one.
        </div>
      ) : (
        <ul className="mask-layers-panel__list">
          {layerEntries.map(({ layer, depth }, index) => {
            const generateState = maskGenerateState[layer.id] ?? 'idle'
            const isActive = layer.id === activeLayerId
            const resultTrack = resultTracks?.[layer.id]
            const layerMaskTakes = maskTakes?.[layer.id]
            const pinnedMaskTake = layerMaskTakes?.find((t) => t.selected) ?? layerMaskTakes?.[0]
            const layerOps = layer.ops ?? []
            const hasMaskSourceOp = layerOps.some((o) => o.type === 'automask' || o.type === 'manual_mask')
            // The stack is typed: one mask-source op first, then generative ops.
            const appendableOps: LayerOpType[] = [
              ...(!hasMaskSourceOp ? (['automask', 'manual_mask'] as LayerOpType[]) : []),
              ...(hasMaskSourceOp && !layerOps.some((o) => o.type === 'remove')
                ? (['remove'] as LayerOpType[])
                : []),
            ]
            // Full stack: the appender stays visible offering ops "· on
            // result" — chaining continues the work on the removal output
            // (a nested chained layer, created with the op in one gesture).
            const isChainMenu = appendableOps.length === 0
              && layerOps.some((o) => o.type === 'remove')
              && Boolean(onChainFromResult)
            const menuOps: LayerOpType[] = isChainMenu
              ? (['automask', 'manual_mask'] as LayerOpType[])
              : appendableOps

            return (
              <Fragment key={layer.id}>
              <li
                className={[
                  'mask-layers-panel__layer',
                  isActive ? 'is-active' : '',
                  !layer.visible ? 'is-hidden' : '',
                ].filter(Boolean).join(' ')}
                style={depth > 0 ? { paddingLeft: 12 + depth * 14 } : undefined}
                onClick={() => onSelectLayer(layer.id)}
              >
                {/* color swatch */}
                <span
                  className="mask-layers-panel__swatch"
                  style={{ background: layer.color ?? '#5eead4' }}
                />

                {/* name (inline editable) */}
                {editingId === layer.id ? (
                  <input
                    ref={inputRef}
                    className="mask-layers-panel__name-input"
                    value={editingName}
                    onChange={(e) => setEditingName(e.currentTarget.value)}
                    onBlur={() => commitRename(layer.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename(layer.id)
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span
                    className="mask-layers-panel__name"
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      beginRename(layer)
                    }}
                    title="Double-click to rename"
                  >
                    {layer.name}
                  </span>
                )}

                {layer.source ? (
                  <span
                    className="mask-layers-panel__chain-badge"
                    title="Chained layer — its ops read the source layer's pinned removal result"
                  >
                    on result
                  </span>
                ) : null}

                {/* Op appender: pick an operation, + creates the sub-layer
                    (row + parameters). Lives in the layer header, always
                    visible; with a full stack it offers ops "· on result"
                    which chain onto the removal output. */}
                {isVideo && onAppendOp && menuOps.length > 0 ? (() => {
                  const chosen = pendingOpType[layer.id]
                  const selectedType = chosen && menuOps.includes(chosen) ? chosen : menuOps[0]
                  return (
                    <span className="mask-layers-panel__add-op" onClick={(e) => e.stopPropagation()}>
                      <select
                        className="mask-layers-panel__add-op-select"
                        value={selectedType}
                        onChange={(e) => {
                          // Read the value NOW — React nulls currentTarget after
                          // the handler returns, before the updater callback runs.
                          const type = e.currentTarget.value as LayerOpType
                          setPendingOpType((prev) => ({ ...prev, [layer.id]: type }))
                        }}
                        title={isChainMenu
                          ? 'Stack is complete — these ops chain onto the removal result (a nested layer)'
                          : 'Choose an operation, then + to add it as a sub-layer'}
                      >
                        {menuOps.map((type) => (
                          <option key={type} value={type}>
                            {LAYER_OP_LABELS[type]}{isChainMenu ? ' · on result' : ''}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="mask-layers-panel__add-op-btn"
                        title={isChainMenu
                          ? `Add ${LAYER_OP_LABELS[selectedType]} on this layer's removal result (creates a chained sub-layer)`
                          : `Add ${LAYER_OP_LABELS[selectedType]} — its parameters appear in the parameters panel`}
                        onClick={() => {
                          if (isChainMenu) {
                            onChainFromResult?.(layer.id, selectedType)
                          } else {
                            onSelectLayer(layer.id)
                            onAppendOp(layer.id, selectedType)
                          }
                        }}
                      >
                        <Plus size={12} strokeWidth={2.5} />
                      </button>
                    </span>
                  )
                })() : null}

                {/* actions */}
                <div className="mask-layers-panel__actions" onClick={(e) => e.stopPropagation()}>
                  {isVideo ? null : (
                    <button
                      type="button"
                      className="mask-layers-panel__action"
                      title={generateState === 'working' ? 'Generating…' : generateState !== 'idle' ? generateState : 'Generate mask'}
                      disabled={generateState === 'working'}
                      onClick={() => onGenerateMask(layer.id)}
                    >
                      <Wand2 size={13} strokeWidth={2} />
                    </button>
                  )}

                  <button
                    type="button"
                    className="mask-layers-panel__action"
                    title={layer.visible ? 'Hide mask strokes' : 'Show mask strokes'}
                    onClick={() => onToggleVisibility(layer.id)}
                  >
                    {layer.visible ? <Eye size={13} strokeWidth={2} /> : <EyeOff size={13} strokeWidth={2} />}
                  </button>
                  <button
                    type="button"
                    className="mask-layers-panel__action"
                    title={
                      layer.render_visible !== false
                        ? 'Hide render on canvas'
                        : 'Show render on canvas'
                    }
                    onClick={() => onToggleRenderVisibility(layer.id)}
                  >
                    {layer.render_visible !== false ? (
                      <Image size={13} strokeWidth={2} />
                    ) : (
                      <ImageOff size={13} strokeWidth={2} />
                    )}
                  </button>
                  <button
                    type="button"
                    className="mask-layers-panel__action"
                    title="Move up"
                    disabled={index === 0}
                    onClick={() => onMoveLayerUp(layer.id)}
                  >
                    <ChevronUp size={13} strokeWidth={2.5} />
                  </button>
                  <button
                    type="button"
                    className="mask-layers-panel__action"
                    title="Move down"
                    disabled={index === layers.length - 1}
                    onClick={() => onMoveLayerDown(layer.id)}
                  >
                    <ChevronDown size={13} strokeWidth={2.5} />
                  </button>
                  <button
                    type="button"
                    className="mask-layers-panel__action mask-layers-panel__action--danger"
                    title="Delete layer"
                    onClick={() => onRemoveLayer(layer.id)}
                  >
                    <Trash2 size={13} strokeWidth={2} />
                  </button>
                </div>
              </li>
              {isVideo ? layerOps.map((op) => {
                const isMaskSource = op.type === 'automask' || op.type === 'manual_mask'
                const hasTakes = isMaskSource
                  ? Boolean(layerMaskTakes?.length)
                  : Boolean(resultTrack?.takes.length)
                return (
                  <li
                    key={op.id}
                    className={[
                      'mask-layers-panel__result',
                      isActive ? 'is-active' : '',
                      (isMaskSource ? !layer.visible : layer.render_visible === false) ? 'is-hidden' : '',
                    ].filter(Boolean).join(' ')}
                    style={depth > 0 ? { paddingLeft: 26 + depth * 14 } : undefined}
                    onClick={() =>
                      op.type === 'remove' && hasTakes && onFocusResult
                        ? onFocusResult(layer.id)
                        : onSelectLayer(layer.id)
                    }
                    title={
                      op.type === 'automask' ? 'SAM 2 propagation — paint prompts on frames, then Run; params in the parameters panel'
                      : op.type === 'manual_mask' ? 'Manual mask — your paint IS the mask (no GPU); Run bakes the painted frames'
                      : 'Generative removal — consumes the pinned mask take; click to jump to the result, hold C to compare'
                    }
                  >
                    <CornerDownRight size={12} className="mask-layers-panel__result-connector" />
                    <span
                      className={
                        'mask-layers-panel__result-swatch' + (isMaskSource ? ' mask-layers-panel__result-swatch--mask' : '')
                      }
                      style={
                        isMaskSource
                          ? { background: layer.color ?? '#5eead4', borderColor: layer.color ?? '#5eead4' }
                          : { borderColor: layer.color ?? '#5eead4' }
                      }
                    />
                    <span className="mask-layers-panel__result-name">{LAYER_OP_LABELS[op.type]}</span>
                    {isMaskSource && layerMaskTakes?.length && pinnedMaskTake ? (
                      <select
                        className="mask-layers-panel__result-take"
                        value={pinnedMaskTake.version_id}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => onSelectMaskTake?.(layer.id, e.currentTarget.value)}
                        title="Take — one per version (manual bakes, SAM2 runs, corrections); switching re-pins durably"
                      >
                        {layerMaskTakes.map((t) => (
                          <option key={t.version_id} value={t.version_id}>
                            v{t.version_number} · {maskTakeLabel(t)} · {t.span_start}–{t.span_end}f
                          </option>
                        ))}
                      </select>
                    ) : null}
                    {op.type === 'remove' && resultTrack?.takes.length ? (
                      <select
                        className="mask-layers-panel__result-take"
                        value={resultTrack.selectedRun ?? resultTrack.takes[0].run}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => onSelectResultTake?.(layer.id, Number(e.currentTarget.value))}
                        title="Take — one per removal run; switching re-pins the stored selection"
                      >
                        {resultTrack.takes.map((t) => (
                          <option key={t.run} value={t.run}>
                            v{t.run} · {t.spanStart}–{t.spanEnd}f{t.tier ? ` · ${t.tier}` : ''}
                          </option>
                        ))}
                      </select>
                    ) : null}
                    <div className="mask-layers-panel__actions" onClick={(e) => e.stopPropagation()}>
                      {op.type === 'automask' ? (
                        <>
                          <button
                            type="button"
                            className="mask-layers-panel__action"
                            title={generateState === 'working' ? 'Propagating…' : generateState !== 'idle' ? generateState : 'Run: propagate the mask track (SAM 2)'}
                            disabled={generateState === 'working'}
                            onClick={() => onPropagateMask?.(layer.id)}
                          >
                            <Wand2 size={13} strokeWidth={2} />
                          </button>
                          {trackedLayerIds?.[layer.id] && onCorrectMask ? (
                            <button
                              type="button"
                              className="mask-layers-panel__action"
                              title="Correct: re-propagate from your edit forward, merging into the track"
                              disabled={generateState === 'working'}
                              onClick={() => onCorrectMask(layer.id)}
                            >
                              <Stethoscope size={13} strokeWidth={2} />
                            </button>
                          ) : null}
                          {trackedLayerIds?.[layer.id] && onBakeMask ? (
                            <button
                              type="button"
                              className="mask-layers-panel__action"
                              title="Bake fix: overlay your paint on the pinned take as a deterministic correction — no re-propagation"
                              disabled={generateState === 'working'}
                              onClick={() => onBakeMask(layer.id)}
                            >
                              <Stamp size={13} strokeWidth={2} />
                            </button>
                          ) : null}
                        </>
                      ) : null}
                      {op.type === 'manual_mask' && onBakeMask ? (
                        <button
                          type="button"
                          className="mask-layers-panel__action"
                          title={generateState === 'working' ? 'Baking…' : 'Run: bake your painted frames as the mask (no GPU)'}
                          disabled={generateState === 'working'}
                          onClick={() => onBakeMask(layer.id)}
                        >
                          <Stamp size={13} strokeWidth={2} />
                        </button>
                      ) : null}
                      {op.type === 'remove' ? (
                        <>
                          {onRemoveObject ? (
                            <button
                              type="button"
                              className="mask-layers-panel__action"
                              title={
                                trackedLayerIds?.[layer.id]
                                  ? 'Run: remove the masked object using the pinned mask take (params in the parameters panel)'
                                  : 'Run the mask op above first — removal consumes its pinned take'
                              }
                              disabled={generateState === 'working' || !trackedLayerIds?.[layer.id]}
                              onClick={() => onRemoveObject(layer.id)}
                            >
                              <Eraser size={13} strokeWidth={2} />
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="mask-layers-panel__action"
                            title={layer.render_visible !== false ? 'Hide result on canvas' : 'Show result on canvas'}
                            onClick={() => onToggleRenderVisibility(layer.id)}
                          >
                            {layer.render_visible !== false ? (
                              <Eye size={13} strokeWidth={2} />
                            ) : (
                              <EyeOff size={13} strokeWidth={2} />
                            )}
                          </button>
                          {resultTrack?.takes.length && onChainFromResult ? (
                            <button
                              type="button"
                              className="mask-layers-panel__action"
                              title="New chained layer on this result — mask or remove again on the removed clip"
                              onClick={() => onChainFromResult(layer.id)}
                            >
                              <GitBranch size={13} strokeWidth={2} />
                            </button>
                          ) : null}
                        </>
                      ) : null}
                      {!hasTakes && onRemoveOp ? (
                        <button
                          type="button"
                          className="mask-layers-panel__action mask-layers-panel__action--danger"
                          title="Remove this operation from the stack (it has no stored takes)"
                          onClick={() => onRemoveOp(layer.id, op.id)}
                        >
                          <X size={13} strokeWidth={2} />
                        </button>
                      ) : null}
                    </div>
                  </li>
                )
              }) : null}
              </Fragment>
            )
          })}
        </ul>
      )}
    </aside>
  )
}
