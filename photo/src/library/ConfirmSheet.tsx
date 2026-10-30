import { useState, type ReactNode } from 'react'
import { Sheet } from '../ui/Sheet'
import './sheets.css'

/** Ask before something that can't be undone. The confirm button is the destructive one. */
export function ConfirmSheet({
  title,
  children,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: ReactNode
  children: ReactNode
  confirmLabel: string
  onConfirm: () => unknown
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  return (
    <Sheet
      title={title}
      onClose={onClose}
      footer={
        <div className="lib-foot">
          <button type="button" className="btn ghost" onClick={onClose} autoFocus>
            Cancel
          </button>
          <button
            type="button"
            className="btn danger-fill"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await onConfirm()
              } finally {
                setBusy(false)
              }
            }}
          >
            {confirmLabel}
          </button>
        </div>
      }
    >
      <div className="sheet-text">{children}</div>
    </Sheet>
  )
}
