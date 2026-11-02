// Export dialog, shared by the library (batch) and the editor (current photo).
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { exportVariants, setSharePrompt, type ExportProgress, type ExportVariant } from '../io/api'
import { db, uid } from '../io/db'
import type { ExportOptions, PhotoRecord } from '../io/types'
import { updateSettings, useSettings } from '../state/settings'
import { Icon } from '../ui/Icon'
import { PhotoThumb } from '../ui/PhotoThumb'
import { Sheet } from '../ui/Sheet'
import { Spinner } from '../ui/controls'
import { toast } from '../ui/toast'
import { errorMessage } from './actions'
import { ExportFields } from './ExportFields'
import { estimateBytes, outputSize } from './exportMath'
import { allPresets, presetNamed, presetSummary, sameOptions, savePreset, type ExportPreset } from './exportPresets'
import { DEFAULT_TEMPLATE, fileNameFor, renderFileName } from './fileNames'
import { formatBytes, formatDimensions, plural } from './library'
import './sheets.css'

/** Files ready for the share sheet, waiting for a fresh tap (see setSharePrompt). */
interface ShareWait {
  count: number
  share: () => Promise<void>
  resolve: () => void
  reject: (e: unknown) => void
}

type Failure = { name: string; reason: string }

const isAbort = (e: unknown) => (e as { name?: string } | null)?.name === 'AbortError'


const variantOf = (o: ExportOptions, total: number, label?: string): ExportVariant => ({ opts: o, label, name: (p, i) => renderFileName(o.fileName || DEFAULT_TEMPLATE, p, { seq: i + 1, total }) })

export function ExportSheet({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const settings = useSettings()
  const photos = useLiveQuery(() => db.photos.bulkGet(ids).then((ps) => ps.filter((p): p is PhotoRecord => !!p)), [ids.join('\n')])
  // Thumbnail weight per pixel: how much detail each photo has, for the size estimate.
  const thumbBpp = useLiveQuery(
    () => db.thumbs.bulkGet(ids).then((ts) => new Map(ts.flatMap((t) => (t && t.width * t.height ? [[t.id, t.blob.size / (t.width * t.height)] as const] : [])))),
    [ids.join('\n')],
  )
  const [draft, setDraft] = useState<ExportOptions | null>(null)
  const opts = draft ?? settings?.export
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [failed, setFailed] = useState<Failure[] | null>(null)
  const [wait, setWait] = useState<ShareWait | null>(null)
  /** Export with several presets at once: their ids (null = the settings below). */
  const [several, setSeveral] = useState<string[] | null>(null)
  const abort = useRef<AbortController | null>(null)
  const presets = allPresets(settings?.exportPresets)
  const chosen = several ? presets.filter((p) => several.includes(p.id)) : []
  const waitRef = useRef<ShareWait | null>(null)

  useEffect(() => {
    setSharePrompt(
      (share, count) =>
        new Promise<void>((resolve, reject) => {
          waitRef.current = { count, share, resolve, reject }
          setWait(waitRef.current)
        }),
    )
    return () => {
      setSharePrompt(null)
      waitRef.current?.reject(new DOMException('Export closed', 'AbortError'))
      abort.current?.abort()
    }
  }, [])

  const endWait = () => {
    waitRef.current = null
    setWait(null)
  }

  /** Export `batch` (all photos by default; a retry passes only the ones that failed). */
  const start = (batch = photos) => {
    if (!opts || !batch?.length) return
    const variants = several ? chosen.map((p) => variantOf(p.options, batch.length, p.name)) : [variantOf(opts, batch.length)]
    if (!variants.length) return
    if (!several) void updateSettings({ export: opts })
    const ac = new AbortController()
    abort.current = ac
    setFailed(null)
    setProgress({ done: 0, total: batch.length * variants.length, fraction: 0 })
    // Started straight from the click: the save dialog or folder picker needs that tap.
    exportVariants(
      batch.map((p) => p.id),
      variants,
      setProgress,
      ac.signal,
    )
      .then(
        (res) => {
          if (!res.failed.length) {
            toast(variants.length > 1 ? `Exported ${plural(res.saved, 'file')} (${plural(batch.length, 'photo')} × ${variants.length} presets)` : `Exported ${plural(res.saved, 'photo')}`)
            onClose()
            return
          }
          setFailed(res.failed)
          toast(res.saved ? `Exported ${res.saved} of ${plural(batch.length * variants.length, variants.length > 1 ? 'file' : 'photo')}` : 'Nothing was exported', 4000)
        },
        (e) => toast(isAbort(e) ? 'Export cancelled' : `Export failed: ${errorMessage(e)}`, 5000),
      )
      .finally(() => {
        abort.current = null
        endWait()
        setProgress(null)
      })
  }

  const share = () => {
    const w = waitRef.current
    if (!w) return
    w.share().then(
      () => {
        endWait()
        w.resolve()
      },
      (e) => {
        // Closing the share sheet without saving: keep the button so they can try again.
        if (isAbort(e)) return
        endWait()
        w.reject(e)
      },
    )
  }

  const close = () => {
    abort.current?.abort()
    onClose()
  }

  const single = photos?.length === 1 ? photos[0] : undefined
  const count = photos?.length ?? ids.length
  const running = !!progress
  let body: React.ReactNode
  let footer: React.ReactNode

  if (wait) {
    body = (
      <div className="exp-ready">
        <span className="exp-ready-icon">
          <Icon name="check" size={26} />
        </span>
        <b>{wait.count === 1 ? 'Your photo is ready' : `Your ${wait.count} photos are ready`}</b>
        <span className="muted">Tap Save, then choose “Save Image” or “Save to Files”.</span>
      </div>
    )
    footer = (
      <div className="lib-foot">
        <button type="button" className="btn ghost" onClick={close}>
          Cancel
        </button>
        <button type="button" className="btn primary" onClick={share} autoFocus>
          <Icon name="share" size={16} />
          Save {plural(wait.count, 'photo')}
        </button>
      </div>
    )
  } else if (progress) {
    const pct = Math.round(((progress.done + Math.min(1, progress.fraction)) / Math.max(1, progress.total)) * 100)
    body = (
      <div className="stack" aria-live="polite">
        <Summary photos={photos} single={single} opts={opts} />
        <div className="row between">
          <b>{progress.total === 1 ? 'Exporting…' : `Exporting ${Math.min(progress.done + 1, progress.total)} of ${progress.total}`}</b>
          <span className="muted tnum">{pct}%</span>
        </div>
        <div className="progress" role="progressbar" aria-label="Export progress" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <i style={{ width: `${pct}%` }} />
        </div>
        {progress.current && <div className="muted small ellipsis">{progress.current}</div>}
      </div>
    )
    footer = (
      <div className="lib-foot">
        <button type="button" className="btn outline" onClick={() => abort.current?.abort()}>
          Cancel export
        </button>
      </div>
    )
  } else if (failed) {
    body = <Failures failed={failed} total={count} />
    footer = (
      <div className="lib-foot">
        <button type="button" className="btn ghost" onClick={close}>
          Close
        </button>
        <button type="button" className="btn primary" onClick={() => start(photos?.filter((p) => failed.some((f) => f.name === p.fileName)))}>
          {failed.length === 1 ? 'Try again' : `Retry ${plural(failed.length, 'photo')}`}
        </button>
      </div>
    )
  } else {
    const bytes = !opts || !photos ? 0 : several ? chosen.reduce((n, p) => n + estimateBytes(photos, p.options, thumbBpp), 0) : estimateBytes(photos, opts, thumbBpp)
    body = opts ? (
      <div className="stack loose">
        <Summary photos={photos} single={single} opts={several ? undefined : opts} />
        <PresetBar
          opts={opts}
          presets={presets}
          user={settings?.exportPresets}
          several={several}
          onSeveral={setSeveral}
          onPick={(p) => setDraft({ ...p.options })}
        />
        {several ? (
          <SeveralPresets presets={presets} chosen={several} onChange={setSeveral} sample={photos?.[0]} />
        ) : (
          <ExportFields value={opts} onChange={setDraft} fullSize={single ? outputSize(single) : undefined} sample={photos?.[0]} count={count} />
        )}
      </div>
    ) : (
      <Spinner />
    )
    const files = several ? count * chosen.length : count
    footer = (
      <div className="lib-foot">
        <span className="grow tnum">{photos && opts ? `${files > 1 ? `${plural(files, 'file')} · ` : ''}about ${formatBytes(bytes)}` : ''}</span>
        <button type="button" className="btn primary" disabled={!opts || !photos?.length || (!!several && !chosen.length)} onClick={() => start()}>
          <Icon name="download" size={16} />
          {several ? `Export ${plural(count, 'photo')} × ${plural(chosen.length, 'preset')}` : count === 1 ? 'Export photo' : `Export ${plural(count, 'photo')}`}
        </button>
      </div>
    )
  }

  return (
    <Sheet title={running || wait ? 'Exporting' : 'Export'} onClose={close} footer={footer}>
      {body}
    </Sheet>
  )
}

function Summary({ photos, single, opts }: { photos?: PhotoRecord[]; single?: PhotoRecord; opts?: ExportOptions }) {
  if (!photos?.length) return null
  if (!opts)
    return (
      <div className="exp-summary">
        <div className="exp-stack" aria-hidden="true">
          {photos.slice(0, 3).map((p) => (
            <div key={p.id} className="exp-thumb">
              <PhotoThumb id={p.id} />
            </div>
          ))}
        </div>
        <div className="grow">
          <div className="bold">{plural(photos.length, 'photo')}</div>
          <div className="muted small">Edits applied · one file per photo for each preset</div>
        </div>
      </div>
    )
  if (single) {
    const out = outputSize(single, opts.longEdge)
    return (
      <div className="exp-summary">
        <div className="exp-thumb">
          <PhotoThumb id={single.id} />
        </div>
        <div className="grow">
          <div className="bold ellipsis">{fileNameFor(single, opts)}</div>
          <div className="muted small tnum">
            {opts.longEdge && opts.longEdge < Math.max(single.width, single.height) ? `Long edge ${opts.longEdge} px` : 'Full resolution'} ·{' '}
            {formatDimensions(out.width, out.height)} · edits applied
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className="exp-summary">
      <div className="exp-stack" aria-hidden="true">
        {photos.slice(0, 3).map((p) => (
          <div key={p.id} className="exp-thumb">
            <PhotoThumb id={p.id} />
          </div>
        ))}
      </div>
      <div className="grow">
        <div className="bold">{plural(photos.length, 'photo')}</div>
        <div className="muted small ellipsis">
          Edits applied · saved as {fileNameFor(photos[0], opts, 1, photos.length)}, {fileNameFor(photos[1] ?? photos[0], opts, 2, photos.length)}, …
        </div>
      </div>
    </div>
  )
}

function Failures({ failed, total }: { failed: Failure[]; total: number }) {
  const reasons = [...new Set(failed.map((f) => f.reason))]
  return (
    <div className="stack">
      <div className="exp-ready">
        <span className="exp-ready-icon warn">
          <Icon name="info" size={24} />
        </span>
        <b>{failed.length === total ? `Couldn’t export ${total === 1 ? 'this photo' : `these ${total} photos`}` : `${failed.length} of ${total} photos couldn’t be exported`}</b>
        {reasons.length === 1 && <span className="muted">{reasons[0]}</span>}
      </div>
      <div className="list skipped">
        {failed.map((f, i) => (
          <div key={`${f.name}-${i}`} className="list-row">
            <span className="ellipsis">{f.name}</span>
            {reasons.length > 1 && <span className="muted small">{f.reason}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Pick a preset (fills in the settings), save the current settings as one, or switch to several presets at once. */
function PresetBar({
  opts,
  presets,
  user,
  several,
  onSeveral,
  onPick,
}: {
  opts: ExportOptions
  presets: ExportPreset[]
  user?: ExportPreset[]
  several: string[] | null
  onSeveral: (ids: string[] | null) => void
  onPick: (p: ExportPreset) => void
}) {
  const [saving, setSaving] = useState<string | null>(null)
  const current = presets.find((p) => sameOptions(p.options, opts))
  const clash = saving !== null ? presetNamed(user, saving) : undefined
  const save = (replace: boolean) => {
    if (saving === null || !saving.trim()) return
    const name = saving
    void updateSettings((s) => ({ exportPresets: savePreset(s.exportPresets, name, opts, uid(), { replace }) })).then(() => toast(replace ? `Updated “${clash?.name}”` : 'Preset saved'))
    setSaving(null)
  }
  if (saving !== null)
    return (
      <div className="exp-presets saving">
        <label className="field grow">
          <span>Preset name</span>
          <input
            type="text"
            value={saving}
            autoFocus
            placeholder="e.g. Client proofs"
            onChange={(e) => setSaving(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save(!!clash)
              if (e.key === 'Escape') {
                e.stopPropagation()
                setSaving(null)
              }
            }}
          />
          {clash && <small className="muted small">You already have “{clash.name}”. Replace it, or keep both (the new one gets a number).</small>}
          {!clash && presets.some((p) => p.builtin && p.name.toLowerCase() === saving.trim().toLowerCase()) && <small className="muted small">Built-in presets stay; yours gets a number.</small>}
        </label>
        <div className="row">
          <button type="button" className="btn ghost sm" onClick={() => setSaving(null)}>
            Cancel
          </button>
          {clash && (
            <button type="button" className="btn outline sm" onClick={() => save(false)}>
              Keep both
            </button>
          )}
          <button type="button" className="btn primary sm" disabled={!saving.trim()} onClick={() => save(!!clash)}>
            {clash ? 'Replace' : 'Save preset'}
          </button>
        </div>
      </div>
    )
  return (
    <div className="exp-presets">
      {!several && (
        <label className="field grow">
          <span>Preset</span>
          <select
            value={current?.id ?? ''}
            onChange={(e) => {
              const p = presets.find((x) => x.id === e.target.value)
              if (p) onPick(p)
            }}
          >
            {!current && <option value="">Custom settings</option>}
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="row exp-preset-actions">
        {!several && (
          <button type="button" className="btn ghost sm" onClick={() => setSaving(current && !current.builtin ? current.name : '')} title="Save these settings as a preset">
            <Icon name="plus" size={14} />
            Save preset
          </button>
        )}
        <button
          type="button"
          className={several ? 'btn outline sm on' : 'btn ghost sm'}
          aria-pressed={!!several}
          onClick={() => onSeveral(several ? null : current ? [current.id] : [])}
          title="Export each photo with several presets at once, e.g. Web JPEG and Full TIFF"
        >
          <Icon name="copy" size={14} />
          Several presets
        </button>
      </div>
    </div>
  )
}

function SeveralPresets({ presets, chosen, onChange, sample }: { presets: ExportPreset[]; chosen: string[]; onChange: (ids: string[]) => void; sample?: PhotoRecord }) {
  return (
    <div className="list exp-several" role="group" aria-label="Presets to export with">
      {presets.map((p) => {
        const on = chosen.includes(p.id)
        return (
          <label key={p.id} className={on ? 'list-row exp-check on' : 'list-row exp-check'}>
            <input type="checkbox" checked={on} onChange={() => onChange(on ? chosen.filter((x) => x !== p.id) : [...chosen, p.id])} />
            <span className="grow">
              <span className="bold">{p.name}</span>
              <small className="muted">
                {presetSummary(p.options)}
                {sample ? ` · ${fileNameFor(sample, p.options)}` : ''}
              </small>
            </span>
          </label>
        )
      })}
    </div>
  )
}
