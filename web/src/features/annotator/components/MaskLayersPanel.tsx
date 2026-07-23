import { useRef, useState } from 'react'
import { Eye, EyeOff, ChevronUp, ChevronDown, Plus, Trash2, Wand2 } from 'lucide-react'
import type { AnnotationLayer } from '../core/annotations/types'

interface MaskLayersPanelProps {
  layers: AnnotationLayer[]
  activeLayerId: string | null
  maskGenerateState: Record<string, 'idle' | 'working' | string>
  onSelectLayer: (id: string) => void
  onAddLayer: () => void
  onRemoveLayer: (id: string) => void
  onRenameLayer: (id: string, name: string) => void
  onToggleVisibility: (id: string) => void
  onMoveLayerUp: (id: string) => void
  onMoveLayerDown: (id: string) => void
  onGenerateMask: (id: string) => void
}

export function MaskLayersPanel({
  layers,
  activeLayerId,
  maskGenerateState,
  onSelectLayer,
  onAddLayer,
  onRemoveLayer,
  onRenameLayer,
  onToggleVisibility,
  onMoveLayerUp,
  onMoveLayerDown,
  onGenerateMask,
}: MaskLayersPanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
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

      {layers.length === 0 ? (
        <div className="mask-layers-panel__empty">
          No layers yet. Click + to add one.
        </div>
      ) : (
        <ul className="mask-layers-panel__list">
          {layers.map((layer, index) => {
            const generateState = maskGenerateState[layer.id] ?? 'idle'
            const isActive = layer.id === activeLayerId

            return (
              <li
                key={layer.id}
                className={[
                  'mask-layers-panel__layer',
                  isActive ? 'is-active' : '',
                  !layer.visible ? 'is-hidden' : '',
                ].filter(Boolean).join(' ')}
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

                {/* actions */}
                <div className="mask-layers-panel__actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="mask-layers-panel__action"
                    title={generateState === 'working' ? 'Generating…' : generateState !== 'idle' ? generateState : 'Generate mask'}
                    disabled={generateState === 'working'}
                    onClick={() => onGenerateMask(layer.id)}
                  >
                    <Wand2 size={13} strokeWidth={2} />
                  </button>
                  <button
                    type="button"
                    className="mask-layers-panel__action"
                    title={layer.visible ? 'Hide layer' : 'Show layer'}
                    onClick={() => onToggleVisibility(layer.id)}
                  >
                    {layer.visible ? <Eye size={13} strokeWidth={2} /> : <EyeOff size={13} strokeWidth={2} />}
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
            )
          })}
        </ul>
      )}
    </aside>
  )
}
