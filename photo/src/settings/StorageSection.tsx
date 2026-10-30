import { useLiveQuery } from 'dexie-react-hooks'
import { useRef, useState } from 'react'
import { backupEdits, refreshThumbnails, restoreEdits } from '../io/api'
import { db } from '../io/db'
import { attempt, removePhotos } from '../library/actions'
import { ConfirmSheet } from '../library/ConfirmSheet'
import { formatBytes, plural } from '../library/library'
import { useStorageInfo } from '../library/useStorageInfo'
import { Icon } from '../ui/Icon'
import { toast } from '../ui/toast'

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

const today = () => new Date().toISOString().slice(0, 10)

export function StorageSection() {
  const library = useLiveQuery(async () => {
    let bytes = 0
    const ids: string[] = []
    await db.photos.each((p) => {
      bytes += p.fileSize || 0
      ids.push(p.id)
    })
    return { ids, bytes }
  }, [])
  const [tick, setTick] = useState(0)
  const info = useStorageInfo(`${library?.ids.length}-${tick}`)
  const restoreInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<'backup' | 'restore' | null>(null)
  const [confirm, setConfirm] = useState<0 | 1 | 2>(0)
  const count = library?.ids.length ?? 0
  const used = info && info.quota ? Math.min(100, Math.max(1, (info.usage / info.quota) * 100)) : 0

  const protect = async () => {
    const ok = await navigator.storage?.persist?.().catch(() => false)
    setTick((t) => t + 1)
    toast(ok ? 'Your library is protected from automatic clean-up' : 'The browser declined. Installing Lumen (Add to Home Screen / Install app) usually allows it.', 5000)
  }

  const backup = async () => {
    setBusy('backup')
    const json = await attempt('Backup failed', backupEdits)
    setBusy(null)
    if (!json) return
    download(`lumen-edits-${today()}.json`, json)
    toast(`Backed up edits for ${plural(count, 'photo')}`)
  }

  const restore = async (file: File) => {
    setBusy('restore')
    const res = await attempt('Restore failed', async () => restoreEdits(await file.text()))
    setBusy(null)
    if (!res) return
    const extra = [
      res.unmatched ? `${plural(res.unmatched, 'photo')} not in this library` : '',
      res.albumsAdded ? plural(res.albumsAdded, 'album') + ' added' : '',
      res.presetsAdded ? plural(res.presetsAdded, 'preset') + ' added' : '',
    ]
    toast([`Restored edits on ${plural(res.updatedIds.length, 'photo')}`, ...extra].filter(Boolean).join(' · '), 6000)
    // Thumbnails catch up with the restored recipes in the background.
    void refreshThumbnails(res.updatedIds)
  }

  return (
    <>
      <div className="set-card">
        <div className="set-row">
          <span className="lbl">
            <b>{plural(count, 'photo')} on this device</b>
            <small>{formatBytes(library?.bytes ?? 0)} of originals, plus edits and thumbnails</small>
          </span>
        </div>
        {info && info.quota > 0 && (
          <div className="stack tight">
            <div className="progress" role="meter" aria-label="Storage used by Lumen" aria-valuenow={Math.round(used)} aria-valuemin={0} aria-valuemax={100}>
              <i style={{ width: `${used}%` }} />
            </div>
            <span className="muted small tnum">
              {formatBytes(info.usage)} used · {formatBytes(Math.max(0, info.quota - info.usage))} more available to Lumen
            </span>
          </div>
        )}
        <hr />
        <div className="set-row">
          <span className="lbl">
            <b>Protection from clean-up</b>
            <small>
              {info?.persisted ? (
                <span className="status good">Protected — the browser won’t clear your library to free space</span>
              ) : (
                <span className="status warn">Not protected — the browser may clear your library when space runs low</span>
              )}
            </small>
          </span>
          {info && !info.persisted && (
            <button type="button" className="btn outline" onClick={protect}>
              Protect library
            </button>
          )}
        </div>
        <div className="set-warning">
          <Icon name="info" size={16} />
          <span>
            Browsers can clear website data: Safari after 7 days without use unless Lumen is added to the Home Screen or Dock, and any browser when the device runs out of space.
            Keep your originals somewhere else too, and back up your edits now and then.
          </span>
        </div>
      </div>

      <div className="set-card">
        <div className="set-row">
          <span className="lbl">
            <b>Back up edits</b>
            <small>Ratings, flags, albums, your presets and every edit, in one small file. The photos themselves aren’t included.</small>
          </span>
          <button type="button" className="btn outline" onClick={backup} disabled={!!busy || !count}>
            <Icon name="download" size={16} />
            {busy === 'backup' ? 'Saving…' : 'Back up'}
          </button>
        </div>
        <hr />
        <div className="set-row">
          <span className="lbl">
            <b>Restore edits</b>
            <small>Re-import your originals, then pick a backup: each edit returns to the photo with the same file name, size and capture time.</small>
          </span>
          <button type="button" className="btn outline" onClick={() => restoreInput.current?.click()} disabled={!!busy}>
            <Icon name="upload" size={16} />
            {busy === 'restore' ? 'Restoring…' : 'Restore…'}
          </button>
          <input
            ref={restoreInput}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void restore(f)
            }}
          />
        </div>
      </div>

      <div className="set-card set-danger">
        <div className="set-row">
          <span className="lbl">
            <b>Delete all photos</b>
            <small>Removes every original, edit and thumbnail from this device. Albums, presets and settings stay.</small>
          </span>
          <button type="button" className="btn danger" onClick={() => setConfirm(1)} disabled={!count}>
            <Icon name="trash" size={16} />
            Delete all…
          </button>
        </div>
      </div>

      {confirm === 1 && (
        <ConfirmSheet title={`Delete all ${plural(count, 'photo')}?`} confirmLabel="Continue" onClose={() => setConfirm(0)} onConfirm={() => setConfirm(2)}>
          Every original and every edit stored in Lumen on this device will be removed. Back up your edits first if you might want them later.
        </ConfirmSheet>
      )}
      {confirm === 2 && (
        <ConfirmSheet
          title="Are you sure?"
          confirmLabel={`Delete ${plural(count, 'photo')}`}
          onClose={() => setConfirm(0)}
          onConfirm={async () => {
            await removePhotos(library?.ids ?? [])
            setConfirm(0)
          }}
        >
          This can’t be undone. Photos you exported stay where you saved them.
        </ConfirmSheet>
      )}
    </>
  )
}
