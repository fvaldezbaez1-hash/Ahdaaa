import type { ReactNode } from 'react'
import { loadSettings, updateSettings } from '../lib/settings'
import { navigate } from '../router'
import { useSettings } from '../state'
import { Icon } from '../ui/Icon'

export async function dismissTip(id: string) {
  const s = await loadSettings()
  await updateSettings({ tipsSeen: [...new Set([...(s.tipsSeen ?? []), id])] })
}

/** A first-time explainer card. Disappears for good after "Got it". */
export function Tip({ id, title, children, learnMore }: { id: string; title: string; children: ReactNode; learnMore?: string }) {
  const st = useSettings()
  if (st.tipsSeen?.includes(id)) return null
  return (
    <aside className="card tip-card stack tight" aria-label={title}>
      <div className="row">
        <Icon name="bulb" />
        <h3 className="grow">{title}</h3>
      </div>
      <div className="tip-body">{children}</div>
      <div className="row">
        {learnMore && (
          <button className="btn ghost sm" style={{ paddingLeft: 0 }} onClick={() => navigate(`/help?s=${learnMore}`)}>
            Learn more
          </button>
        )}
        <div className="grow" />
        <button className="btn primary sm" onClick={() => void dismissTip(id)}>
          Got it
        </button>
      </div>
    </aside>
  )
}

/** "?" button for screen headers, opening the guide at the right section. */
export function HelpButton({ section }: { section?: string }) {
  return (
    <button className="icon-btn" onClick={() => navigate(section ? `/help?s=${section}` : '/help')} aria-label="How to use this screen">
      <Icon name="help" />
    </button>
  )
}
