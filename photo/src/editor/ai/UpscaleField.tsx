import { useEffect, useState } from 'react'
import type { ExportOptions } from '../../io/types'
import { Toggle } from '../../ui/controls'
import { useIsPhone } from '../../ui/hooks'
import { ai, type AiModel } from './core'
import { formatBytes, useAiSupport } from './jobs'
import { upscaledSize } from './sizes'

type ModelState = { kind: 'checking' } | { kind: 'ready' } | { kind: 'needed'; models: AiModel[] } | { kind: 'downloading'; fraction: number } | { kind: 'failed'; message: string }

/** "Upscale 2× (AI)" for the export sheet: the resulting size, the one-time model download, and a note on phones. */
export function UpscaleField({ value, onChange, fullSize }: { value: ExportOptions; onChange: (patch: Partial<ExportOptions>) => void; fullSize?: { width: number; height: number } }) {
  const support = useAiSupport()
  const phone = useIsPhone()
  const [model, setModel] = useState<ModelState>({ kind: 'checking' })
  const on = value.upscale === 2
  const available = !!support?.available

  useEffect(() => {
    if (!available) return
    let live = true
    void ai()
      .then((c) => c.modelsFor('upscale'))
      .then((ms) => {
        if (!live) return
        const missing = ms.filter((m) => !m.downloaded)
        setModel(missing.length ? { kind: 'needed', models: missing } : { kind: 'ready' })
      })
      .catch((e: Error) => live && setModel({ kind: 'failed', message: e.message }))
    return () => {
      live = false
    }
  }, [available])

  const download = async (models: AiModel[]) => {
    const core = await ai()
    const total = models.reduce((n, m) => n + m.bytes, 0)
    let done = 0
    try {
      for (const m of models) {
        await core.downloadModel(m.id, { onProgress: (loaded) => setModel({ kind: 'downloading', fraction: total ? (done + loaded) / total : 0 }) })
        done += m.bytes
      }
      setModel({ kind: 'ready' })
      onChange({ upscale: 2 })
    } catch (e) {
      setModel({ kind: 'failed', message: (e as Error).message })
    }
  }

  const out = fullSize && on ? upscaledSize(fullSize, value.longEdge) : null
  let note: string
  if (!support) note = 'Checking what this device can do…'
  else if (!available) note = support.reason ?? 'On-device AI isn’t available on this device.'
  else if (model.kind === 'needed') note = `Adds detail as it doubles the size. Needs a one-time ${formatBytes(model.models.reduce((n, m) => n + m.bytes, 0))} download.`
  else if (model.kind === 'downloading') note = `Downloading… ${Math.round(model.fraction * 100)} %`
  else if (model.kind === 'failed') note = model.message
  else if (out) note = `${out.width.toLocaleString('en-US')} × ${out.height.toLocaleString('en-US')} px${phone ? ' · slow on phones' : ''}`
  else note = `Adds detail as it doubles the width and height${phone ? '; slow on phones' : ''}.`

  return (
    <div className="setting-row">
      <span className="lbl">
        <b>Upscale 2× (AI)</b>
        <small aria-live="polite">{note}</small>
      </span>
      {model.kind === 'needed' && available ? (
        <button type="button" className="btn outline sm" onClick={() => void download(model.models)}>
          Download
        </button>
      ) : (
        <Toggle label="Upscale 2× with AI" checked={on && available && model.kind !== 'downloading'} onChange={(v) => model.kind !== 'downloading' && onChange({ upscale: v ? 2 : undefined })} />
      )}
    </div>
  )
}
