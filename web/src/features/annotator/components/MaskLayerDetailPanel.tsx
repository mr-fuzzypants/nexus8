import { useEffect, useState } from 'react'
import type { AnnotationLayer, GenMode, LayerOp, MaskOp } from '../core/annotations/types'

const MASK_OPS: { value: MaskOp; label: string }[] = [
  { value: 'inpaint', label: 'Inpaint' },
  { value: 'outpaint', label: 'Outpaint' },
  { value: 'background_replace', label: 'Background replace' },
  { value: 'remove', label: 'Remove' },
  { value: 'segment', label: 'Segment' },
  { value: 'scribble', label: 'Scribble to image' },
  { value: 'sketch_inpaint', label: 'Sketch inpaint' },
]

// Ops with a generation runner behind the Regenerate button.
const RUNNABLE_OPS: MaskOp[] = ['inpaint', 'scribble', 'sketch_inpaint', 'remove']

/** Per-take provenance for one op: the values its pinned take was made with. */
export interface TakeParamsInfo {
  label: string
  values: Record<string, unknown>
}

/** Read-only "parameters used" record for an op's pinned take. */
function TakeParams({ info }: { info?: TakeParamsInfo }) {
  if (!info) return null
  const entries = Object.entries(info.values).filter(
    ([, v]) => v !== null && v !== undefined && v !== '',
  )
  if (entries.length === 0) return null
  return (
    <details className="mask-layer-detail-panel__take-params">
      <summary>Parameters used — take {info.label}</summary>
      <dl>
        {entries.map(([key, value]) => (
          <div key={key} className="mask-layer-detail-panel__take-param">
            <dt>{key}</dt>
            <dd>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</dd>
          </div>
        ))}
      </dl>
    </details>
  )
}

interface Props {
  layer: AnnotationLayer | null
  onUpdate: (
    fields: Partial<Pick<AnnotationLayer, 'mask_op' | 'prompt' | 'negative_prompt' | 'reference' | 'gen_mode' | 'controlnet_scale' | 'guidance_scale' | 'num_inference_steps' | 'scribble_scope' | 'seed' | 'num_variants' | 'denoise_strength' | 'reference_scale'>>,
  ) => void
  /** Trigger a fresh generation of this layer's mask_op. */
  onRegenerate?: () => void
  /** True while a generation is saving/running — disables the Regenerate button. */
  busy?: boolean
  /** Seed the backend used for the last completed run (server-generated when random). */
  lastSeed?: number
  /** Bump to force the local slider state to re-sync from the layer (e.g. after
   *  a history recipe is applied — layer switch is the only other sync point). */
  resyncKey?: number
  /** Video mask layer: hide still-image op machinery; params render per op
   *  in the layer's serial op stack (layer.ops). */
  isVideo?: boolean
  /** Merge params into one of the layer's stack ops (video, op-centric). */
  onUpdateOp?: (opId: string, params: NonNullable<LayerOp['params']>) => void
  /** Pinned-take provenance per op family: shown as a read-only
   *  "parameters used" record under the op's editable params. */
  takeParams?: { mask?: TakeParamsInfo; remove?: TakeParamsInfo }
}

export function MaskLayerDetailPanel({ layer, onUpdate, onRegenerate, busy, lastSeed, resyncKey, isVideo, onUpdateOp, takeParams }: Props) {
  // Local slider state avoids the slider snapping back during the Yjs round-trip
  // (onChange → upsertLayer → setSnapshot → re-render). Syncs from props on layer switch.
  const [controlnetScale, setControlnetScale] = useState(layer?.controlnet_scale ?? 0.4)
  const [guidanceScale, setGuidanceScale] = useState(layer?.guidance_scale ?? 7.5)
  const [denoiseStrength, setDenoiseStrength] = useState(layer?.denoise_strength ?? 1.0)
  const [referenceScale, setReferenceScale] = useState(layer?.reference_scale ?? 0.5)

  useEffect(() => {
    setControlnetScale(layer?.controlnet_scale ?? (layer?.mask_op === 'sketch_inpaint' ? 0.4 : 0.6))
    setGuidanceScale(layer?.guidance_scale ?? (layer?.mask_op === 'sketch_inpaint' ? 7.5 : 1.0))
    setDenoiseStrength(layer?.denoise_strength ?? 1.0)
    setReferenceScale(layer?.reference_scale ?? 0.5)
  }, [layer?.id, resyncKey])

  if (!layer) return null

  const isScribble = layer.mask_op === 'scribble'
  const isSketchInpaint = layer.mask_op === 'sketch_inpaint'
  const isRemove = layer.mask_op === 'remove'
  const isRunnable = layer.mask_op != null && RUNNABLE_OPS.includes(layer.mask_op)
  const missingPrompt = isRunnable && !isRemove && !layer.prompt?.trim()

  return (
    <div className="mask-layer-detail-panel">
      <div className="mask-layer-detail-panel__title">{layer.name}</div>

      {!isVideo && (
        <label className="mask-layer-detail-panel__field">
          <span className="mask-layer-detail-panel__label">Operation</span>
          <select
            className="mask-layer-detail-panel__select"
            value={layer.mask_op ?? ''}
            onChange={(e) =>
              // Steps ranges differ per op (scribble 1–8, sketch inpaint 10–50),
              // so reset to the new op's default on switch.
              onUpdate({ mask_op: (e.target.value as MaskOp) || undefined, num_inference_steps: undefined })
            }
          >
            <option value="">— none —</option>
            {MASK_OPS.map((op) => (
              <option key={op.value} value={op.value}>{op.label}</option>
            ))}
          </select>
        </label>
      )}

      {!isVideo && !isRemove && (
        <label className="mask-layer-detail-panel__field">
          <span className="mask-layer-detail-panel__label">Prompt</span>
          <textarea
            className="mask-layer-detail-panel__textarea"
            placeholder={
              isScribble ? 'Describe what to generate from the sketch…'
              : isSketchInpaint ? 'Describe what to place in the sketched region…'
              : 'Describe what to generate…'
            }
            value={layer.prompt ?? ''}
            rows={3}
            onChange={(e) => onUpdate({ prompt: e.target.value || undefined })}
          />
        </label>
      )}

      {/* Video: per-op parameter sections, one per entry in the layer's
          serial op stack (appended from the panel's + op menu). */}
      {isVideo && (layer.ops?.length ? (
        layer.ops.map((op) => (
          <div key={op.id} className="mask-layer-detail-panel__op-section">
            <div className="mask-layer-detail-panel__op-title">
              {op.type === 'automask' ? 'Automask · SAM 2'
                : op.type === 'manual_mask' ? 'Manual mask'
                : 'Remove'}
            </div>

            {op.type === 'automask' && (
              <>
                <label className="mask-layer-detail-panel__field">
                  <span className="mask-layer-detail-panel__label">Prompt kind</span>
                  <select
                    className="mask-layer-detail-panel__select"
                    value={op.params?.prompt_mode ?? 'points'}
                    onChange={(e) => onUpdateOp?.(op.id, { prompt_mode: e.target.value as 'points' | 'mask' })}
                  >
                    <option value="points">Points — dab to select; SAM infers the extent</option>
                    <option value="mask">Mask — your painted boundary conditions SAM</option>
                  </select>
                </label>
                <label className="mask-layer-detail-panel__field">
                  <span className="mask-layer-detail-panel__label">Staging resolution</span>
                  <select
                    className="mask-layer-detail-panel__select"
                    value={op.params?.staging_tier ?? 'preview_480p'}
                    onChange={(e) => onUpdateOp?.(op.id, { staging_tier: e.target.value as 'preview_480p' | 'preview_720p' | 'native' })}
                  >
                    <option value="preview_480p">480p — fast</option>
                    <option value="preview_720p">720p</option>
                    <option value="native">Native — best (thin trims, fingers)</option>
                  </select>
                  <span style={{ fontSize: 11, color: 'rgba(148,163,184,0.5)' }}>
                    Higher preserves fine mask detail at more upload/GPU cost
                  </span>
                </label>
              </>
            )}

            {op.type === 'manual_mask' && (
              <label className="mask-layer-detail-panel__field">
                <span className="mask-layer-detail-panel__label">Between keyframes</span>
                <select
                  className="mask-layer-detail-panel__select"
                  value={op.params?.fill_policy ?? 'hold'}
                  onChange={(e) => onUpdateOp?.(op.id, { fill_policy: e.target.value as 'hold' | 'none' })}
                >
                  <option value="hold">Hold — each painted mask persists until the next keyframe</option>
                  <option value="none">Empty — only painted frames have a mask</option>
                </select>
                <span style={{ fontSize: 11, color: 'rgba(148,163,184,0.5)' }}>
                  Hold = garbage-matte semantics: one painted frame covers a locked-off shot
                </span>
              </label>
            )}

            {op.type === 'remove' && (
              <>
                <label className="mask-layer-detail-panel__field">
                  <span className="mask-layer-detail-panel__label">Tier</span>
                  <select
                    className="mask-layer-detail-panel__select"
                    value={op.params?.tier ?? 'quality'}
                    onChange={(e) => onUpdateOp?.(op.id, { tier: e.target.value as 'fast' | 'quality' | 'eraser' })}
                  >
                    <option value="quality">Quality — VOID, true removal (~3–4 min)</option>
                    <option value="fast">Fast — VACE preview (~1–2 min; re-fills implied subjects)</option>
                    <option value="eraser">Eraser — DiffuEraser, promptless flow fill (benchmark only)</option>
                  </select>
                  <span style={{ fontSize: 11, color: 'rgba(148,163,184,0.5)' }}>
                    Removing a person or anything the scene implies? Use Quality.
                  </span>
                </label>
                <label className="mask-layer-detail-panel__field">
                  <span className="mask-layer-detail-panel__label">Prompt</span>
                  <textarea
                    className="mask-layer-detail-panel__textarea"
                    placeholder="DESCRIBE the background behind the object (not an instruction)…"
                    value={op.params?.prompt ?? ''}
                    rows={3}
                    onChange={(e) => onUpdateOp?.(op.id, { prompt: e.target.value || undefined })}
                  />
                </label>
                <label className="mask-layer-detail-panel__field">
                  <span className="mask-layer-detail-panel__label">Negative prompt</span>
                  <textarea
                    className="mask-layer-detail-panel__textarea"
                    placeholder="Fast tier only — e.g. person, figure, silhouette…"
                    value={op.params?.negative_prompt ?? ''}
                    rows={2}
                    onChange={(e) => onUpdateOp?.(op.id, { negative_prompt: e.target.value || undefined })}
                  />
                </label>
                <label className="mask-layer-detail-panel__field">
                  <span className="mask-layer-detail-panel__label">Seed</span>
                  <input
                    className="mask-layer-detail-panel__input"
                    type="number"
                    min={0}
                    max={2147483647}
                    step={1}
                    placeholder="random"
                    value={op.params?.seed ?? ''}
                    onChange={(e) =>
                      onUpdateOp?.(op.id, { seed: e.target.value === '' ? undefined : parseInt(e.target.value, 10) })
                    }
                  />
                  <span style={{ fontSize: 11, color: 'rgba(148,163,184,0.5)' }}>
                    Empty = random each run · Set to reproduce a result
                  </span>
                </label>
              </>
            )}

            <TakeParams info={op.type === 'remove' ? takeParams?.remove : takeParams?.mask} />
          </div>
        ))
      ) : (
        <p style={{ fontSize: 11, color: 'rgba(148,163,184,0.5)', margin: '4px 0 0' }}>
          No operations yet — append one from the layer's <strong>+ op</strong> menu
          (Automask for SAM 2 tracking, Manual mask to paint the matte yourself).
        </p>
      ))}

      {isSketchInpaint && (
        <>
          <label className="mask-layer-detail-panel__field">
            <span className="mask-layer-detail-panel__label">Negative prompt</span>
            <textarea
              className="mask-layer-detail-panel__textarea"
              placeholder="What to avoid — e.g. blurry, low quality, extra limbs…"
              value={layer.negative_prompt ?? ''}
              rows={2}
              onChange={(e) => onUpdate({ negative_prompt: e.target.value || undefined })}
            />
          </label>

          <label className="mask-layer-detail-panel__field">
            <span className="mask-layer-detail-panel__label">
              ControlNet strength
              <span style={{ marginLeft: 6, fontWeight: 400, color: 'rgba(148,163,184,0.65)' }}>
                {controlnetScale.toFixed(2)}
              </span>
            </span>
            <input
              type="range"
              min={0.3}
              max={1.0}
              step={0.05}
              value={controlnetScale}
              onChange={(e) => {
                const v = parseFloat(e.target.value)
                setControlnetScale(v)
                onUpdate({ controlnet_scale: v })
              }}
              style={{ width: '100%', cursor: 'pointer' }}
            />
            <span style={{ fontSize: 11, color: 'rgba(148,163,184,0.5)' }}>
              Low = creative freedom · High = follow strokes tightly
            </span>
          </label>

          <label className="mask-layer-detail-panel__field">
            <span className="mask-layer-detail-panel__label">
              Guidance scale
              <span style={{ marginLeft: 6, fontWeight: 400, color: 'rgba(148,163,184,0.65)' }}>
                {guidanceScale.toFixed(1)}
              </span>
            </span>
            <input
              type="range"
              min={1.0}
              max={15.0}
              step={0.5}
              value={guidanceScale}
              onChange={(e) => {
                const v = parseFloat(e.target.value)
                setGuidanceScale(v)
                onUpdate({ guidance_scale: v })
              }}
              style={{ width: '100%', cursor: 'pointer' }}
            />
            <span style={{ fontSize: 11, color: 'rgba(148,163,184,0.5)' }}>
              Low = looser/creative · High = strict prompt adherence
            </span>
          </label>

          <label className="mask-layer-detail-panel__field">
            <span className="mask-layer-detail-panel__label">
              Steps
              <span style={{ marginLeft: 6, fontWeight: 400, color: 'rgba(148,163,184,0.65)' }}>
                {layer.num_inference_steps ?? 20}
              </span>
            </span>
            <input
              type="range"
              min={10}
              max={50}
              step={5}
              value={layer.num_inference_steps ?? 20}
              onChange={(e) => onUpdate({ num_inference_steps: parseInt(e.target.value, 10) })}
              style={{ width: '100%', cursor: 'pointer' }}
            />
            <span style={{ fontSize: 11, color: 'rgba(148,163,184,0.5)' }}>
              More steps = higher quality, slower generation
            </span>
          </label>

          <label className="mask-layer-detail-panel__field">
            <span className="mask-layer-detail-panel__label">
              Denoise strength
              <span style={{ marginLeft: 6, fontWeight: 400, color: 'rgba(148,163,184,0.65)' }}>
                {denoiseStrength.toFixed(2)}
              </span>
            </span>
            <input
              type="range"
              min={0.3}
              max={1.0}
              step={0.05}
              value={denoiseStrength}
              onChange={(e) => {
                const v = parseFloat(e.target.value)
                setDenoiseStrength(v)
                onUpdate({ denoise_strength: v === 1.0 ? undefined : v })
              }}
              style={{ width: '100%', cursor: 'pointer' }}
            />
            <span style={{ fontSize: 11, color: 'rgba(148,163,184,0.5)' }}>
              1.0 = replace region from noise · lower = keep original structure (raise steps to compensate)
            </span>
          </label>

          {layer.reference?.trim() && (
            <label className="mask-layer-detail-panel__field">
              <span className="mask-layer-detail-panel__label">
                Reference influence
                <span style={{ marginLeft: 6, fontWeight: 400, color: 'rgba(148,163,184,0.65)' }}>
                  {referenceScale.toFixed(2)}
                </span>
              </span>
              <input
                type="range"
                min={0.1}
                max={1.0}
                step={0.05}
                value={referenceScale}
                onChange={(e) => {
                  const v = parseFloat(e.target.value)
                  setReferenceScale(v)
                  onUpdate({ reference_scale: v })
                }}
                style={{ width: '100%', cursor: 'pointer' }}
              />
              <span style={{ fontSize: 11, color: 'rgba(148,163,184,0.5)' }}>
                How strongly the reference image steers the result · high can override the prompt
              </span>
            </label>
          )}

        </>
      )}

      {isScribble && (
        <label className="mask-layer-detail-panel__field">
          <span className="mask-layer-detail-panel__label">Scope</span>
          <select
            className="mask-layer-detail-panel__select"
            value={layer.scribble_scope ?? 'full'}
            onChange={(e) => onUpdate({ scribble_scope: e.target.value as 'full' | 'region' })}
          >
            <option value="full">Full image — replace entire canvas</option>
            <option value="region">Region only — inpaint sketch area</option>
          </select>
        </label>
      )}

      {isScribble && (
        <label className="mask-layer-detail-panel__field">
          <span className="mask-layer-detail-panel__label">Mode</span>
          <select
            className="mask-layer-detail-panel__select"
            value={layer.gen_mode ?? 'quality'}
            onChange={(e) =>
              onUpdate({ gen_mode: e.target.value === 'quality' ? undefined : (e.target.value as GenMode) })
            }
          >
            <option value="quality">Quality — 1024px, saved result</option>
            <option value="fast">Draft — ~576px, 2 steps, near-instant</option>
          </select>
          <span style={{ fontSize: 11, color: 'rgba(148,163,184,0.5)' }}>
            Draft skips saving and variations for speed — nothing is stored
          </span>
        </label>
      )}

      {isScribble && (
        <label className="mask-layer-detail-panel__field">
          <span className="mask-layer-detail-panel__label">
            ControlNet strength
            <span style={{ marginLeft: 6, fontWeight: 400, color: 'rgba(148,163,184,0.65)' }}>
              {controlnetScale.toFixed(2)}
            </span>
          </span>
          <input
            type="range"
            min={0.3}
            max={1.0}
            step={0.05}
            value={controlnetScale}
            onChange={(e) => {
              const v = parseFloat(e.target.value)
              setControlnetScale(v)
              onUpdate({ controlnet_scale: v })
            }}
            style={{ width: '100%', cursor: 'pointer' }}
          />
          <span style={{ fontSize: 11, color: 'rgba(148,163,184,0.5)' }}>
            Low = creative freedom · High = follow strokes tightly
          </span>
        </label>
      )}

      {isScribble && (
        <label className="mask-layer-detail-panel__field">
          <span className="mask-layer-detail-panel__label">
            Steps
            <span style={{ marginLeft: 6, fontWeight: 400, color: 'rgba(148,163,184,0.65)' }}>
              {layer.num_inference_steps ?? 4}
            </span>
          </span>
          <input
            type="range"
            min={1}
            max={8}
            step={1}
            value={layer.num_inference_steps ?? 4}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10)
              onUpdate({ num_inference_steps: v === 4 ? undefined : v })
            }}
            style={{ width: '100%', cursor: 'pointer' }}
          />
          <span style={{ fontSize: 11, color: 'rgba(148,163,184,0.5)' }}>
            4 = schnell's sweet spot · 2 = draft speed · above 4 adds little
          </span>
        </label>
      )}

      {(isScribble || isSketchInpaint) && (
        <label className="mask-layer-detail-panel__field">
          <span className="mask-layer-detail-panel__label">Variations</span>
          <select
            className="mask-layer-detail-panel__select"
            value={layer.num_variants ?? 1}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10)
              onUpdate({ num_variants: v === 1 ? undefined : v })
            }}
          >
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>{n === 1 ? '1 — single image' : `${n} images`}</option>
            ))}
          </select>
          <span style={{ fontSize: 11, color: 'rgba(148,163,184,0.5)' }}>
            Generated in one GPU batch · variant seeds = seed, seed+1, …
          </span>
        </label>
      )}

      {(isScribble || isSketchInpaint) && (
        <div className="mask-layer-detail-panel__field">
          <span className="mask-layer-detail-panel__label">Seed</span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              className="mask-layer-detail-panel__input"
              type="number"
              min={0}
              max={2147483647}
              step={1}
              placeholder="random"
              value={layer.seed ?? ''}
              onChange={(e) =>
                onUpdate({ seed: e.target.value === '' ? undefined : parseInt(e.target.value, 10) })
              }
              style={{ flex: 1 }}
            />
            <button
              type="button"
              title="Randomize seed"
              onClick={() => onUpdate({ seed: Math.floor(Math.random() * 2147483647) })}
              style={{
                padding: '4px 8px',
                fontSize: 13,
                background: 'rgba(148,163,184,0.1)',
                border: '1px solid rgba(148,163,184,0.2)',
                borderRadius: 4,
                color: 'rgba(148,163,184,0.8)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              ↻
            </button>
          </div>
          <span style={{ fontSize: 11, color: 'rgba(148,163,184,0.5)' }}>
            Empty = random each run · Set to reproduce a result
          </span>
          {lastSeed != null && layer.seed == null && (
            <span style={{ fontSize: 11, color: 'rgba(148,163,184,0.8)', marginTop: 2 }}>
              Last run seed: <span style={{ fontFamily: 'monospace' }}>{lastSeed}</span>
              <button
                type="button"
                title="Pin this seed to reproduce the last result"
                onClick={() => onUpdate({ seed: lastSeed })}
                style={{
                  marginLeft: 6,
                  padding: '1px 6px',
                  fontSize: 11,
                  background: 'rgba(148,163,184,0.1)',
                  border: '1px solid rgba(148,163,184,0.2)',
                  borderRadius: 4,
                  color: 'rgba(148,163,184,0.8)',
                  cursor: 'pointer',
                }}
              >
                pin
              </button>
            </span>
          )}
        </div>
      )}

      {!isVideo && !isScribble && !isRemove && (
        <>
          <label className="mask-layer-detail-panel__field">
            <span className="mask-layer-detail-panel__label">Generation</span>
            <select
              className="mask-layer-detail-panel__select"
              value={layer.gen_mode ?? ''}
              onChange={(e) => onUpdate({ gen_mode: (e.target.value as GenMode) || undefined })}
            >
              <option value="">Auto (quality when prompted)</option>
              <option value="quality">Quality — follows the prompt (~4s)</option>
              <option value="fast">Fast — harmonize/remove only (~2s)</option>
            </select>
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
        </>
      )}

      {!isVideo && isRemove && (
        <p style={{ fontSize: 11, color: 'rgba(148,163,184,0.5)', margin: '4px 0 0' }}>
          BigLaMa GAN fill — no prompt needed
        </p>
      )}

      {!isVideo && isRunnable && onRegenerate && (
        <div className="mask-layer-detail-panel__field">
          <button
            type="button"
            disabled={busy || missingPrompt}
            onClick={onRegenerate}
            title={missingPrompt ? 'Enter a prompt first' : 'Run a new generation'}
            style={{
              width: '100%',
              padding: '7px 10px',
              fontSize: 13,
              fontWeight: 600,
              background: busy || missingPrompt ? 'rgba(148,163,184,0.08)' : 'rgba(59,130,246,0.2)',
              border: '1px solid rgba(59,130,246,0.35)',
              borderRadius: 6,
              color: busy || missingPrompt ? 'rgba(148,163,184,0.5)' : '#bfdbfe',
              cursor: busy || missingPrompt ? 'default' : 'pointer',
            }}
          >
            {busy ? 'Generating…' : '↻ Regenerate'}
          </button>
        </div>
      )}
    </div>
  )
}
