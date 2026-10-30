import { useId, useRef, useState, type CSSProperties } from 'react'

export interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  /** Value restored by double-click / double-tap and the R key. */
  defaultValue?: number
  /** Decimal places for the readout. */
  dp?: number
  /** Show "+" for positive values (bipolar sliders). Default: min < 0. */
  signed?: boolean
  unit?: string
  /** CSS background for the track (e.g. a temperature gradient). */
  track?: string
  /** Format the readout yourself (e.g. Kelvin). */
  format?: (v: number) => string
  /** Map typed text back to a value when `format` is used. */
  parse?: (text: string) => number | undefined
  /** Live change while dragging. */
  onChange: (v: number) => void
  /** Called once when a drag / keyboard change / reset finishes (one undo step). */
  onCommit?: (v: number) => void
  disabled?: boolean
  compact?: boolean
}

export function formatValue(v: number, dp = 0, signed = false, unit = ''): string {
  const r = dp ? Number(v).toFixed(dp) : String(Math.round(v))
  const n = Number(r)
  const s = n > 0 ? (signed ? `+${r}` : r) : n < 0 ? `−${r.replace('-', '')}` : dp ? Number(0).toFixed(dp) : '0'
  return unit ? `${s}${unit === '%' || unit === '°' ? '' : ' '}${unit}` : s
}

/**
 * Labeled slider with an editable readout. Double-click (or double-tap) resets;
 * hold Alt/Option while dragging for fine control; arrow keys step (Shift = ×10).
 */
export function Slider({
  label, value, min, max, step = 1, defaultValue = 0, dp = 0, signed, unit = '', track, format, parse, onChange, onCommit, disabled, compact,
}: SliderProps) {
  const id = useId()
  const isSigned = signed ?? min < 0
  const text = format ? format(value) : formatValue(value, dp, isSigned, unit)
  const [editing, setEditing] = useState<string | null>(null)
  const dragging = useRef(false)
  const fine = useRef<{ x: number; v: number } | null>(null)
  const lastTap = useRef(0)
  const changed = Math.abs(value - defaultValue) > step / 2

  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step))
  const commit = (v: number) => onCommit?.(v)
  const reset = () => {
    onChange(defaultValue)
    commit(defaultValue)
  }

  const submitText = (t: string) => {
    setEditing(null)
    const parsed = parse ? parse(t) : Number(t.replace('−', '-').replace(',', '.').replace(/[^\d.+-]/g, ''))
    if (parsed === undefined || !Number.isFinite(parsed)) return
    const v = clamp(parsed)
    onChange(v)
    commit(v)
  }

  const style = { '--track': track } as CSSProperties

  return (
    <div className="slider" style={compact ? { padding: '2px 0', gap: 5 } : undefined}>
      <div className="slider-head">
        <label htmlFor={id}>{label}</label>
        {editing !== null ? (
          <input
            className="slider-value"
            autoFocus
            value={editing}
            inputMode="decimal"
            aria-label={`${label} value`}
            onChange={(e) => setEditing(e.target.value)}
            onBlur={() => submitText(editing)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitText(editing)
              if (e.key === 'Escape') setEditing(null)
            }}
          />
        ) : (
          <button
            type="button"
            className={changed ? 'slider-value changed' : 'slider-value'}
            onClick={() => !disabled && setEditing(format ? text : String(Number(value.toFixed(dp))))}
            aria-label={`${label}: ${text}. Click to type a value`}
            disabled={disabled}
          >
            {text}
          </button>
        )}
      </div>
      <input
        id={id}
        className="range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        style={style}
        aria-valuetext={text}
        onChange={(e) => {
          let v = Number(e.target.value)
          if (fine.current) v = clamp(fine.current.v + (v - fine.current.v) * 0.2)
          onChange(v)
        }}
        onPointerDown={(e) => {
          dragging.current = true
          fine.current = e.altKey ? { x: e.clientX, v: value } : null
          const now = Date.now()
          if (e.pointerType !== 'mouse' && now - lastTap.current < 300) {
            e.preventDefault()
            reset()
          }
          lastTap.current = now
        }}
        onPointerUp={() => {
          if (dragging.current) commit(value)
          dragging.current = false
          fine.current = null
        }}
        onKeyUp={(e) => {
          if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(e.key)) commit(value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'r' || e.key === 'R') {
            e.preventDefault()
            reset()
          }
          if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
            e.preventDefault()
            onChange(clamp(value + (e.key === 'ArrowRight' ? 10 : -10) * step))
          }
        }}
        onDoubleClick={reset}
      />
    </div>
  )
}
