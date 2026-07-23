import type { AnnotationLayer, MaskOp } from '../core/annotations/types'

const MASK_OPS: { value: MaskOp; label: string }[] = [
  { value: 'inpaint', label: 'Inpaint' },
  { value: 'outpaint', label: 'Outpaint' },
  { value: 'background_replace', label: 'Background replace' },
  { value: 'remove', label: 'Remove' },
  { value: 'segment', label: 'Segment' },
]

interface Props {
  layer: AnnotationLayer | null
  onUpdate: (fields: Partial<Pick<AnnotationLayer, 'mask_op' | 'prompt' | 'reference'>>) => void
}

export function MaskLayerDetailPanel({ layer, onUpdate }: Props) {
  if (!layer) return null

  return (
    <div className="mask-layer-detail-panel">
      <div className="mask-layer-detail-panel__title">{layer.name}</div>

      <label className="mask-layer-detail-panel__field">
        <span className="mask-layer-detail-panel__label">Operation</span>
        <select
          className="mask-layer-detail-panel__select"
          value={layer.mask_op ?? ''}
          onChange={(e) => onUpdate({ mask_op: (e.target.value as MaskOp) || undefined })}
        >
          <option value="">— none —</option>
          {MASK_OPS.map((op) => (
            <option key={op.value} value={op.value}>{op.label}</option>
          ))}
        </select>
      </label>

      <label className="mask-layer-detail-panel__field">
        <span className="mask-layer-detail-panel__label">Prompt</span>
        <textarea
          className="mask-layer-detail-panel__textarea"
          placeholder="Describe what to generate…"
          value={layer.prompt ?? ''}
          rows={3}
          onChange={(e) => onUpdate({ prompt: e.target.value || undefined })}
        />
      </label>

      <label className="mask-layer-detail-panel__field">
        <span className="mask-layer-detail-panel__label">Reference</span>
        <input
          className="mask-layer-detail-panel__input"
          type="text"
          placeholder="nexus8://asset/…"
          value={layer.reference ?? ''}
          onChange={(e) => onUpdate({ reference: e.target.value || undefined })}
        />
      </label>
    </div>
  )
}
