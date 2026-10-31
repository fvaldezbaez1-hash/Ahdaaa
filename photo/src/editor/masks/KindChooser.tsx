import { useId, useState } from 'react'
import type { AiTarget, PersonPart } from '../../edit/types'
import { useAiSupport } from '../ai/jobs'
import { ToolIcon } from './icons'
import { AI_KINDS, MASK_KINDS, PERSON_PARTS, type MaskKind } from './model'

function PeoplePicker({ onDone, onBack }: { onDone: (parts: PersonPart[] | undefined) => void; onBack: () => void }) {
  const [parts, setParts] = useState<PersonPart[]>(PERSON_PARTS.map((p) => p.part))
  const all = parts.length === PERSON_PARTS.length
  return (
    <div className="ed-people" role="group" aria-label="Which parts of people">
      <p className="small text-2">Select which parts of people:</p>
      <div className="ed-people-parts">
        {PERSON_PARTS.map((p) => (
          <label key={p.part} className="ed-check">
            <input type="checkbox" checked={parts.includes(p.part)} onChange={() => setParts(parts.includes(p.part) ? parts.filter((x) => x !== p.part) : [...parts, p.part])} />
            <span>{p.label}</span>
          </label>
        ))}
      </div>
      <div className="row">
        <button type="button" className="btn primary sm" disabled={!parts.length} onClick={() => onDone(all ? undefined : parts)}>
          {all ? 'Select people' : `Select ${parts.length} part${parts.length === 1 ? '' : 's'}`}
        </button>
        <button type="button" className="btn ghost sm" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  )
}

/** The kinds of mask one can make: drawn ones, and those found by on-device AI. */
export function KindChooser({ onPick, onPickAi, label }: { onPick: (k: MaskKind) => void; onPickAi: (t: AiTarget, parts?: PersonPart[]) => void; label: string }) {
  const support = useAiSupport()
  const note = useId()
  const [people, setPeople] = useState(false)
  const ready = !!support?.available
  if (people) return <PeoplePicker onBack={() => setPeople(false)} onDone={(parts) => onPickAi('person', parts)} />
  return (
    <div className="ed-kinds" role="group" aria-label={label}>
      {MASK_KINDS.map((k) => (
        <button key={k.kind} type="button" className="ed-kind" onClick={() => onPick(k.kind)}>
          <ToolIcon name={k.kind} />
          <span>{k.label}</span>
        </button>
      ))}
      <div className="ed-kinds-ai-head">
        <ToolIcon name="ai" size={14} />
        <span>On-device AI</span>
      </div>
      <div className="ed-kinds-ai">
        {AI_KINDS.map((k) => (
          <button
            key={k.target}
            type="button"
            className="chip"
            disabled={!ready}
            aria-describedby={ready ? undefined : note}
            title={k.target === 'object' ? 'Click the object on the photo' : undefined}
            onClick={() => (k.target === 'person' ? setPeople(true) : onPickAi(k.target))}
          >
            {k.target === 'object' ? 'Select object' : k.label}
          </button>
        ))}
      </div>
      {!ready && (
        <p id={note} className="muted small ed-kinds-note">
          {support ? support.reason ?? 'On-device AI isn’t available on this device.' : 'Checking what this device can do…'}
        </p>
      )}
    </div>
  )
}
