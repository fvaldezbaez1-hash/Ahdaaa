import type { EditCard } from './chat'
import { GROUP_LABELS, type DiffGroup } from './recipeText'

const GROUPS: DiffGroup[] = ['photo', 'geometry']

/** Exactly which sliders an AI reply moved (old → new), with Keep / Undo / Why. */
export function ChangeCard({ edit, onKeep, onUndo, onWhy }: { edit: EditCard; onKeep: () => void; onUndo: () => void; onWhy: () => void }) {
  const decided = edit.status !== 'open'
  return (
    <div className="ai-card">
      {GROUPS.map((g) => {
        const items = edit.diff.filter((i) => i.group === g && !i.hidden)
        if (!items.length) return null
        return (
          <section key={g} className="ai-group" aria-label={GROUP_LABELS[g]}>
            <h4 className="ai-scope">
              <i aria-hidden="true" />
              {GROUP_LABELS[g]}
            </h4>
            <ul className="ai-changes">
              {items.map((i) => (
                <li key={i.path}>
                  <span className="ai-ch-label">{i.label}</span> <span className="ai-ch-from">{i.fromText}</span>
                  <span aria-hidden="true"> → </span>
                  <span className="sr-only"> to </span>
                  <span className="ai-ch-to">{i.toText}</span>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
      <div className="ai-actions">
        <button type="button" className={edit.status === 'undone' ? 'btn sm' : 'btn sm primary'} disabled={decided} onClick={onKeep}>
          {edit.status === 'kept' ? 'Kept ✓' : edit.status === 'undone' ? 'Undone' : 'Keep'}
        </button>
        <button type="button" className="btn sm outline" disabled={decided} onClick={onUndo}>
          Undo
        </button>
        {edit.why && (
          <button type="button" className="ai-why-btn" aria-expanded={edit.whyOpen} onClick={onWhy}>
            {edit.whyOpen ? 'Hide' : 'Why this works'}
          </button>
        )}
      </div>
      {edit.whyOpen && <p className="ai-why">{edit.why}</p>}
    </div>
  )
}
