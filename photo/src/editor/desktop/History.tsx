import { useEditor } from '../../state/editor'

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

/** What happened to this photo in this session, newest first. */
export function History() {
  const history = useEditor((s) => s.history)
  return (
    <section className="ed-history" aria-labelledby="ed-history-title">
      <h2 id="ed-history-title">History</h2>
      <ol className="scroll">
        {history.map((h, i) => (
          <li key={`${h.at}-${i}`} className={i === 0 ? 'current' : undefined} aria-current={i === 0 ? 'step' : undefined}>
            <span className="ellipsis">{h.label}</span>
            <span className="muted tnum">{time(h.at)}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}
