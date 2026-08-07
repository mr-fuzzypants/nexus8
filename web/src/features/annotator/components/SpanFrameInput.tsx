import { useState, type KeyboardEvent } from 'react'

/**
 * Frame-number field for one end of a span. Keeps its own text while focused
 * so typing isn't fought by re-renders; commits on Enter/blur, reverts on
 * Escape or invalid input.
 */
export function SpanFrameInput({
  value,
  placeholder,
  label,
  className,
  onCommit,
}: {
  value: number | null
  placeholder: string
  label: string
  className: string
  onCommit: (frame: number) => void
}) {
  const [text, setText] = useState<string | null>(null)
  const displayed = text ?? (value != null ? String(value) : '')

  const commit = () => {
    if (text != null && text.trim() !== '') {
      const parsed = Number(text)
      if (Number.isFinite(parsed)) {
        onCommit(Math.round(parsed))
      }
    }
    setText(null)
  }
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commit()
      event.currentTarget.blur()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setText(null)
      event.currentTarget.blur()
    }
  }

  return (
    <input
      className={className}
      type="number"
      min={0}
      inputMode="numeric"
      placeholder={placeholder}
      aria-label={label}
      title={label}
      value={displayed}
      onChange={(event) => setText(event.currentTarget.value)}
      onFocus={() => setText(displayed)}
      onBlur={commit}
      onKeyDown={handleKeyDown}
    />
  )
}
