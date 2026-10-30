import { useId } from 'react'
import { AI_KINDS, MASK_KINDS, type MaskKind } from './model'
import { ToolIcon } from './icons'

/** The kinds of mask one can make, with the on-device AI ones shown as coming soon. */
export function KindChooser({ onPick, label }: { onPick: (k: MaskKind) => void; label: string }) {
  const soon = useId()
  return (
    <div className="ed-kinds" role="group" aria-label={label}>
      {MASK_KINDS.map((k) => (
        <button key={k.kind} type="button" className="ed-kind" onClick={() => onPick(k.kind)}>
          <ToolIcon name={k.kind} />
          <span>{k.label}</span>
        </button>
      ))}
      <div className="ed-kinds-ai">
        {AI_KINDS.map((k) => (
          <button key={k.target} type="button" className="chip" disabled aria-describedby={soon}>
            <ToolIcon name="ai" size={13} />
            {k.label}
          </button>
        ))}
      </div>
      <p id={soon} className="muted small ed-kinds-note">
        AI masks for the subject, sky, background and people are coming soon.
      </p>
    </div>
  )
}
