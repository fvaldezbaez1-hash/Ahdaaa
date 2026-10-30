import { useCallback, useEffect, useState } from 'react'
import { toast } from '../../ui/toast'
import { ai, onAiCoreChange, type AiModel } from './core'
import { formatBytes, useAiSupport } from './jobs'

/** Settings → AI models: what's downloaded, how big, and a way to free the space. */
export function ModelsCard() {
  const support = useAiSupport()
  const [models, setModels] = useState<AiModel[] | null>(null)
  const load = useCallback(() => {
    void ai()
      .then((c) => c.listModels())
      .then((ms) => setModels(ms.filter((m) => m.downloaded)), () => setModels([]))
  }, [])
  useEffect(() => {
    load()
    return onAiCoreChange(load)
  }, [load])

  const remove = async (m: AiModel) => {
    try {
      await (await ai()).deleteModel(m.id)
      toast(`${m.name} removed. It downloads again the next time you use it.`)
    } catch (e) {
      toast((e as Error).message)
    }
    load()
  }

  const total = (models ?? []).reduce((n, m) => n + m.bytes, 0)
  return (
    <div className="set-card">
      {support && !support.available && <p className="muted small">{support.reason ?? 'On-device AI isn’t available on this device.'}</p>}
      {models === null ? (
        <p className="muted small">Checking…</p>
      ) : models.length === 0 ? (
        <p className="muted small">No models downloaded yet. Each one downloads the first time you use the tool that needs it.</p>
      ) : (
        <>
          {models.map((m) => (
            <div key={m.id} className="set-row">
              <span className="lbl">
                <b>{m.name}</b>
                <small>{formatBytes(m.bytes)}</small>
              </span>
              <button type="button" className="btn ghost sm" onClick={() => void remove(m)} aria-label={`Delete ${m.name}`}>
                Delete
              </button>
            </div>
          ))}
          <hr />
          <div className="set-row">
            <span className="lbl">
              <b>Total</b>
            </span>
            <span className="tnum">{formatBytes(total)}</span>
          </div>
        </>
      )}
    </div>
  )
}
