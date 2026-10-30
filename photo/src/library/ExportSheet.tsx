// Export dialog, shared by the library (batch) and the editor (current photo).
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { exportPhotos, setSharePrompt, type ExportProgress } from '../io/api'
import { db } from '../io/db'
import type { ExportOptions, PhotoRecord } from '../io/types'
import { updateSettings, useSettings } from '../state/settings'
import { Icon } from '../ui/Icon'
import { PhotoThumb } from '../ui/PhotoThumb'
import { Sheet } from '../ui/Sheet'
import { Spinner } from '../ui/controls'
import { toast } from '../ui/toast'
import { errorMessage } from './actions'
import { ExportFields } from './ExportFields'
import { estimateBytes, exportName, outputSize } from './exportMath'
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

export function ExportSheet({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const settings = useSettings()
  const photos = useLiveQuery(() => db.photos.bulkGet(ids).then((ps) => ps.filter((p): p is PhotoRecord => !!p)), [ids.join('\n')])
  const [draft, setDraft] = useState<ExportOptions | null>(null)
  const opts = draft ?? settings?.export
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [failed, setFailed] = useState<Failure[] | null>(null)
  const [wait, setWait] = useState<ShareWait | null>(null)
  const abort = useRef<AbortController | null>(null)
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
    void updateSettings({ export: opts })
    const ac = new AbortController()
    abort.current = ac
    setFailed(null)
    setProgress({ done: 0, total: batch.length, fraction: 0 })
    // Started straight from the click: the save dialog or folder picker needs that tap.
    exportPhotos(
      batch.map((p) => p.id),
      opts,
      setProgress,
      ac.signal,
    )
      .then(
        (res) => {
          if (!res.failed.length) {
            toast(`Exported ${plural(res.saved, 'photo')}`)
            onClose()
            return
          }
          setFailed(res.failed)
          toast(res.saved ? `Exported ${res.saved} of ${plural(batch.length, 'photo')}` : 'Nothing was exported', 4000)
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
    const bytes = opts && photos ? estimateBytes(photos, opts) : 0
    body = opts ? (
      <div className="stack loose">
        <Summary photos={photos} single={single} opts={opts} />
        <ExportFields value={opts} onChange={setDraft} fullSize={single ? outputSize(single) : undefined} />
      </div>
    ) : (
      <Spinner />
    )
    footer = (
      <div className="lib-foot">
        <span className="grow tnum">{photos && opts ? `${count > 1 ? `${plural(count, 'photo')} · ` : ''}about ${formatBytes(bytes)}` : ''}</span>
        <button type="button" className="btn primary" disabled={!opts || !photos?.length} onClick={() => start()}>
          <Icon name="download" size={16} />
          {count === 1 ? 'Export photo' : `Export ${plural(count, 'photo')}`}
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
  if (!photos?.length || !opts) return null
  if (single) {
    const out = outputSize(single, opts.longEdge)
    return (
      <div className="exp-summary">
        <div className="exp-thumb">
          <PhotoThumb id={single.id} />
        </div>
        <div className="grow">
          <div className="bold ellipsis">{exportName(single.fileName, opts.format)}</div>
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
        <div className="muted small ellipsis">Edits applied · saved as {exportName(photos[0].fileName, opts.format)}, …</div>
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
