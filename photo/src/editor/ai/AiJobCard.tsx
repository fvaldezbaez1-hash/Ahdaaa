import { Icon } from '../../ui/Icon'
import { cancelAi, confirmDownload, dismissAiError, formatBytes, useAiJob, type AiJob, type JobScope } from './jobs'

function Bar({ fraction }: { fraction: number }) {
  // Unknown progress shows a moving bar rather than a stuck 0 %.
  return (
    <div className={fraction > 0 ? 'progress ed-ai-bar' : 'progress ed-ai-bar busy'} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={fraction > 0 ? Math.round(fraction * 100) : undefined}>
      <i style={{ width: fraction > 0 ? `${Math.round(fraction * 100)}%` : undefined }} />
    </div>
  )
}

const names = (j: AiJob) => (j.models?.length ? j.models.map((m) => m.name).join(' and ') : 'the AI model')

function status(j: AiJob): string {
  if (j.phase === 'download') return `Downloading ${names(j)}… ${j.total ? `${formatBytes(j.loaded ?? 0)} of ${formatBytes(j.total)}` : ''}`
  return `${j.label}${j.fraction > 0 ? ` ${Math.round(j.fraction * 100)} %` : ''}`
}

/** The AI task of this panel: download consent, progress with Cancel, or what went wrong. */
export function AiJobCard({ scope }: { scope: JobScope }) {
  const j = useAiJob()
  if (!j || j.scope !== scope) return null
  if (j.phase === 'confirm')
    return (
      <div className="ed-ai-card" role="alertdialog" aria-label="Download AI model">
        <p>
          This needs the <strong>{names(j)}</strong> model{(j.models?.length ?? 0) > 1 ? 's' : ''}: a one-time download of <strong>{formatBytes((j.models ?? []).reduce((n, m) => n + m.bytes, 0))}</strong>. It runs on this device; your photos never leave it.
        </p>
        <div className="row">
          <button type="button" className="btn primary sm" onClick={() => confirmDownload(true)} autoFocus>
            <Icon name="download" size={15} />
            Download
          </button>
          <button type="button" className="btn ghost sm" onClick={() => confirmDownload(false)}>
            Not now
          </button>
        </div>
      </div>
    )
  if (j.phase === 'error')
    return (
      <div className="ed-ai-card error" role="alert">
        <p>{j.error}</p>
        <button type="button" className="btn ghost sm" onClick={dismissAiError}>
          OK
        </button>
      </div>
    )
  return (
    <div className="ed-ai-card" role="status">
      <div className="row between">
        <span className="small">{status(j)}</span>
        <button type="button" className="btn ghost sm" onClick={cancelAi}>
          Cancel
        </button>
      </div>
      <Bar fraction={j.fraction} />
    </div>
  )
}

/** On the photo: what the AI is doing, wherever the panel is scrolled. */
export function AiStageChip() {
  const j = useAiJob()
  if (!j || (j.phase !== 'run' && j.phase !== 'download')) return null
  return (
    <div className="ed-ai-chip" role="status">
      <span className="ed-ai-spark" aria-hidden="true">
        <Icon name="sparkle" size={14} />
      </span>
      <span className="small">{status(j)}</span>
      <Bar fraction={j.fraction} />
      <button type="button" className="icon-btn" aria-label="Cancel" onClick={cancelAi}>
        <Icon name="x" size={14} />
      </button>
    </div>
  )
}
