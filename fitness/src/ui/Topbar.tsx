import type { ReactNode } from 'react'
import { goBack } from '../router'
import { Icon } from './Icon'

/** Screen header: large title on tab screens, back button + centered title elsewhere. */
export function Topbar({ title, back, right }: { title: ReactNode; back?: string; right?: ReactNode }) {
  if (back === undefined) {
    return (
      <header className="topbar">
        <h1>{title}</h1>
        {right}
      </header>
    )
  }
  return (
    <header className="topbar">
      <button className="icon-btn" onClick={() => goBack(back)} aria-label="Back">
        <Icon name="left" />
      </button>
      <div className="title">{title}</div>
      <div className="row" style={{ minWidth: 40, justifyContent: 'flex-end' }}>
        {right}
      </div>
    </header>
  )
}
