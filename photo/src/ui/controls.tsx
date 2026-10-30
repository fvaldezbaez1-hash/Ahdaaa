import type { ReactNode } from 'react'
import { Icon } from './Icon'

export function Segmented<T extends string>({
  value, options, onChange, label, className,
}: {
  value: T
  options: { value: T; label: ReactNode; title?: string }[]
  onChange: (v: T) => void
  label: string
  className?: string
}) {
  return (
    <div className={className ? `segmented ${className}` : 'segmented'} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" title={o.title} aria-pressed={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
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

export function Field({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="muted small">{hint}</small>}
    </label>
  )
}

export function SearchBox({ value, onChange, placeholder, autoFocus }: { value: string; onChange: (v: string) => void; placeholder: string; autoFocus?: boolean }) {
  return (
    <label className="field search" style={{ gap: 0 }}>
      <span className="sr-only">{placeholder}</span>
      <Icon name="search" size={15} />
      <input type="search" value={value} placeholder={placeholder} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} enterKeyHint="search" autoCorrect="off" />
    </label>
  )
}

/** Five tappable stars; tapping the current rating clears it. */
export function Stars({ value, onChange, size = 14, label = 'Rating' }: { value: number; onChange?: (v: number) => void; size?: number; label?: string }) {
  return (
    <div role="group" aria-label={`${label}: ${value} of 5`} style={{ display: 'flex' }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={!onChange}
          aria-label={`${n} star${n === 1 ? '' : 's'}`}
          aria-pressed={n <= value}
          onClick={() => onChange?.(value === n ? 0 : n)}
          style={{ width: size + 6, height: size + 10, display: 'grid', placeItems: 'center', color: n <= value ? 'var(--accent)' : 'var(--text-3)', opacity: 1 }}
        >
          <Icon name={n <= value ? 'starFill' : 'star'} size={size} />
        </button>
      ))}
    </div>
  )
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <div className="spinner" role="status" aria-label={label} />
}

export function Empty({ children, icon }: { children: ReactNode; icon?: Parameters<typeof Icon>[0]['name'] }) {
  return (
    <div className="empty">
      {icon && (
        <div style={{ marginBottom: 10, opacity: 0.7 }}>
          <Icon name={icon} size={32} />
        </div>
      )}
      {children}
    </div>
  )
}
