import { useId, type ReactNode } from 'react'
import { Icon } from '../../ui/Icon'
import { resetParts, usePartChanged, useSectionOpen, type PartId } from './parts'

/** Collapsible group of adjustments. A Reset button appears in the header once anything in it changed. */
export function Section({ id, title, parts, children }: { id: string; title: string; parts: PartId[]; children: ReactNode }) {
  const [open, setOpen] = useSectionOpen(id)
  const changed = usePartChanged(parts)
  const bodyId = useId()
  return (
    <section className="panel-section ed-section" data-open={open}>
      <div className="ed-section-head">
        <button type="button" className="ed-section-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>
          <span>{title}</span>
          {changed && <span className="ed-dot" aria-label="(edited)" />}
          <Icon name="down" size={14} className="chev" />
        </button>
        {changed && (
          <button type="button" className="ed-section-reset" onClick={() => resetParts(parts, `Reset ${title}`)} aria-label={`Reset ${title}`}>
            Reset
          </button>
        )}
      </div>
      {open && (
        <div id={bodyId} className="section-body">
          {children}
        </div>
      )}
    </section>
  )
}

/** Small heading inside a section (e.g. "Sharpening" in Detail). */
export function SubHead({ children }: { children: ReactNode }) {
  return <h3 className="ed-subhead">{children}</h3>
}
