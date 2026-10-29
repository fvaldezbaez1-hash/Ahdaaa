import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'

let openCount = 0

/** Modal dialog: centered on large screens, a bottom sheet on phones. Escape or the backdrop closes it. */
export function Sheet({
  title,
  onClose,
  children,
  footer,
  wide,
  headerExtra,
}: {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
  headerExtra?: ReactNode
}) {
  const closeRef = useRef(onClose)
  const panel = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useLayoutEffect(() => {
    closeRef.current = onClose
  })

  useEffect(() => {
    openCount++
    document.body.style.overflow = 'hidden'
    const prev = document.activeElement as HTMLElement | null
    panel.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        closeRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (--openCount === 0) document.body.style.overflow = ''
      prev?.focus?.()
    }
  }, [])

  return createPortal(
    <div
      className="sheet-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div ref={panel} tabIndex={-1} className={wide ? 'sheet wide' : 'sheet'} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="sheet-head">
          <h2 id={titleId}>{title}</h2>
          {headerExtra}
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

export interface MenuItem {
  label: string
  icon?: Parameters<typeof Icon>[0]['name']
  danger?: boolean
  disabled?: boolean
  onClick: () => void
}

/** A list of actions in a sheet. */
export function MenuSheet({ title, items, onClose }: { title: ReactNode; items: MenuItem[]; onClose: () => void }) {
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="list">
        {items.map((it) => (
          <button
            key={it.label}
            className="list-row"
            disabled={it.disabled}
            style={it.danger ? { color: 'var(--danger)' } : undefined}
            onClick={() => {
              onClose()
              it.onClick()
            }}
          >
            {it.icon && <Icon name={it.icon} />}
            <span className="grow">{it.label}</span>
          </button>
        ))}
      </div>
    </Sheet>
  )
}
