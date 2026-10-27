import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'

let openCount = 0

/** Bottom sheet modal. Rendered in a portal; locks page scroll while open. */
export function Sheet({
  title,
  onClose,
  children,
  footer,
  full,
  headerExtra,
}: {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  full?: boolean
  headerExtra?: ReactNode
}) {
  const closeRef = useRef(onClose)
  useLayoutEffect(() => {
    closeRef.current = onClose
  })

  useEffect(() => {
    openCount++
    document.body.classList.add('locked')
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (--openCount === 0) document.body.classList.remove('locked')
    }
  }, [])

  return createPortal(
    <div
      className="sheet-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className={full ? 'sheet full' : 'sheet'} role="dialog" aria-modal="true">
        <div className="sheet-head">
          <h2>{title}</h2>
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
  onClick: () => void
}

/** Action sheet: a list of choices. */
export function MenuSheet({ title, items, onClose }: { title: ReactNode; items: MenuItem[]; onClose: () => void }) {
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="list">
        {items.map((it) => (
          <button
            key={it.label}
            className="list-row"
            style={it.danger ? { color: 'var(--critical-text)' } : undefined}
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
