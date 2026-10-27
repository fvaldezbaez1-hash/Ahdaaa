import { useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode } from 'react'
import { inputNum, parseNum } from '../lib/units'
import { Icon } from './Icon'

type NumProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: number | undefined
  onChange: (v: number | undefined) => void
  dp?: number
}

/**
 * Numeric text field that keeps what you type ("62." or "0,5") while focused
 * and reports parsed numbers. Uses the decimal keypad on phones.
 */
export function NumField({ value, onChange, dp = 2, onFocus, onBlur, ...rest }: NumProps) {
  const [text, setText] = useState(inputNum(value, dp))
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setText(inputNum(value, dp))
  }, [value, dp])
  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      enterKeyHint="done"
      value={text}
      onFocus={(e) => {
        focused.current = true
        e.currentTarget.select()
        onFocus?.(e)
      }}
      onBlur={(e) => {
        focused.current = false
        setText(inputNum(parseNum(text), dp))
        onBlur?.(e)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
      onChange={(e) => {
        const t = e.target.value
        if (!/^[0-9]*[.,]?[0-9]*$/.test(t)) return
        setText(t)
        onChange(parseNum(t))
      }}
    />
  )
}

/** "m:ss" duration field; a bare number means minutes when `bareMinutes`, else seconds. */
export function TimeField({
  value,
  onChange,
  bareMinutes,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: number | undefined
  onChange: (sec: number | undefined) => void
  bareMinutes?: boolean
}) {
  const fmt = (s: number | undefined) => {
    if (s === undefined) return ''
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = Math.round(s % 60)
    const pad = (n: number) => String(n).padStart(2, '0')
    return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
  }
  const parse = (t: string): number | undefined => {
    const s = t.trim()
    if (!s) return undefined
    const parts = s.split(':').map((p) => Number(p || '0'))
    if (parts.some((n) => !Number.isFinite(n))) return undefined
    if (parts.length === 1) return bareMinutes ? parts[0] * 60 : parts[0]
    if (parts.length === 2) return parts[0] * 60 + parts[1]
    return parts[0] * 3600 + parts[1] * 60 + parts[2]
  }
  const [text, setText] = useState(fmt(value))
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setText(fmt(value))
  }, [value])
  return (
    <input
      {...rest}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      value={text}
      onFocus={(e) => {
        focused.current = true
        e.currentTarget.select()
      }}
      onBlur={() => {
        focused.current = false
        setText(fmt(parse(text)))
      }}
      onChange={(e) => {
        const t = e.target.value
        if (!/^[0-9:]*$/.test(t)) return
        setText(t)
        onChange(parse(t))
      }}
    />
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  label?: string
}) {
  return (
    <div className="segmented" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          className={o.value === value ? 'on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" role="switch" checked={checked} aria-label={label} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </label>
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="muted small">{hint}</small>}
    </label>
  )
}

export function UnitInput({
  value,
  onChange,
  unit,
  placeholder,
  dp,
  autoFocus,
  ariaLabel,
}: {
  value: number | undefined
  onChange: (v: number | undefined) => void
  unit: string
  placeholder?: string
  dp?: number
  autoFocus?: boolean
  ariaLabel?: string
}) {
  return (
    <div className="input-unit">
      <NumField className="input" value={value} onChange={onChange} placeholder={placeholder} dp={dp} autoFocus={autoFocus} aria-label={ariaLabel} />
      <em>{unit}</em>
    </div>
  )
}

export function SearchBox({
  value,
  onChange,
  placeholder,
  onSubmit,
  autoFocus,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  onSubmit?: () => void
  autoFocus?: boolean
}) {
  return (
    <form
      className="search"
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        ;(document.activeElement as HTMLElement | null)?.blur()
        onSubmit?.()
      }}
    >
      <Icon name="search" size={18} />
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        enterKeyHint="search"
        autoCorrect="off"
        onChange={(e) => onChange(e.target.value)}
        aria-label={placeholder}
      />
      {value && (
        <button type="button" className="icon-btn clear" onClick={() => onChange('')} aria-label="Clear search">
          <Icon name="x" size={18} />
        </button>
      )}
    </form>
  )
}

export function Empty({ icon, children }: { icon?: Parameters<typeof Icon>[0]['name']; children: ReactNode }) {
  return (
    <div className="empty">
      {icon && <Icon name={icon} size={32} />}
      {children}
    </div>
  )
}

export function Stat({ label, value, unit, tile }: { label: string; value: ReactNode; unit?: string; tile?: boolean }) {
  return (
    <div className={tile ? 'stat stat-tile' : 'stat'}>
      <span className="label">{label}</span>
      <span className="value">
        {value}
        {unit && <small>{unit}</small>}
      </span>
    </div>
  )
}
