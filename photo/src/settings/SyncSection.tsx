import { useLiveQuery } from 'dexie-react-hooks'
import { useRef, useState } from 'react'
import { attempt } from '../library/actions'
import { canPickFolder, pickFolder } from '../sync/folder'
import { exportSyncFile, importSyncFile, loadConfig, saveConfig, saveFolder, savedFolder, syncNow, useSyncStatus } from '../sync/sync'
import { Toggle } from '../ui/controls'
import { useIsPhone } from '../ui/hooks'
import { Icon } from '../ui/Icon'
import { toast } from '../ui/toast'

const today = () => new Date().toISOString().slice(0, 10)

/** Phones: the share sheet (Save to Files, AirDrop, Drive…); elsewhere a download. */
async function saveText(name: string, text: string, share: boolean) {
  const file = new File([text], name, { type: 'application/json' })
  if (share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] })
      return
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      // The tap expired while the file was made: download instead.
    }
  }
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

const when = (at?: number) => (at ? new Date(at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '')

export function SyncSection() {
  const phone = useIsPhone()
  const folder = useLiveQuery(() => savedFolder(), [])
  const config = useLiveQuery(() => loadConfig(), [])
  const status = useSyncStatus()
  const fileInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<'export' | 'import' | null>(null)
  const folders = canPickFolder()

  const choose = async () => {
    const h = await pickFolder().catch((e: Error) => {
      if (e.name !== 'AbortError') toast(e.message, 4000)
      return null
    })
    if (!h) return
    await saveFolder(h)
    await syncNow(true)
  }
  const stop = async () => {
    await saveFolder(null)
    toast('Sync stopped. Your library and the folder stay as they are.')
  }
  const exportFile = async () => {
    setBusy('export')
    const text = await attempt('Couldn’t make the sync file', exportSyncFile)
    setBusy(null)
    if (text) await saveText(`lumen-sync-${today()}.json`, text, phone)
  }
  const importFile = async (f: File) => {
    setBusy('import')
    const msg = await attempt('Couldn’t merge the sync file', async () => importSyncFile(await f.text()))
    setBusy(null)
    if (msg) toast(`Merged: ${msg}`, 6000)
  }

  const running = status.state === 'running'
  return (
    <>
      {folders && (
        <div className="set-card sync-card">
          {!folder ? (
            <div className="set-row">
              <span className="lbl">
                <b>Sync folder</b>
                <small>
                  Choose (or create) a folder inside iCloud Drive, Dropbox, OneDrive or Google Drive on this computer. Lumen keeps your edits, ratings, keywords, albums and presets
                  there, and merges what your other devices put in it.
                </small>
              </span>
              <button type="button" className="btn primary" onClick={() => void choose()}>
                <Icon name="folder" size={16} />
                Choose folder…
              </button>
            </div>
          ) : (
            <>
              <div className="set-row">
                <span className="lbl">
                  <b className="row" style={{ gap: 6 }}>
                    <Icon name="folder" size={16} />
                    {folder.name}
                  </b>
                  <small aria-live="polite">
                    {running
                      ? status.step
                      : status.state === 'error'
                        ? <span className="status warn">Sync failed: {status.message}</span>
                        : status.state === 'needsPermission'
                          ? <span className="status warn">{status.message}</span>
                          : config?.lastSync
                            ? `Last synced ${when(config.lastSync)} · ${config.lastResult ?? ''}`
                            : 'Not synced yet'}
                  </small>
                </span>
                <button type="button" className="btn primary" disabled={running} onClick={() => void syncNow(true)}>
                  <Icon name="sync" size={16} />
                  {running ? 'Syncing…' : status.state === 'needsPermission' ? 'Reconnect' : 'Sync now'}
                </button>
              </div>
              <hr />
              <div className="set-row">
                <span className="lbl">
                  <b>Include originals</b>
                  <small>Copy the photos themselves too, so your other devices get them. Uses space in your cloud storage.</small>
                </span>
                <Toggle label="Include originals" checked={!!config?.includeOriginals} onChange={(v) => void saveConfig({ includeOriginals: v })} />
              </div>
              <hr />
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="btn outline sm" disabled={running} onClick={() => void choose()}>
                  Change folder…
                </button>
                <button type="button" className="btn ghost sm" disabled={running} onClick={() => void stop()}>
                  Stop syncing
                </button>
              </div>
              <p className="muted small" style={{ margin: 0 }}>
                Syncs when Lumen opens and when you tap Sync now. For each photo the newest edit wins; ratings, flags, keywords and albums travel separately, newest change wins.
                Photos deleted on one device are deleted on the others unless they were changed there afterwards.
              </p>
            </>
          )}
        </div>
      )}
      <div className="set-card">
        <div className="set-row">
          <span className="lbl">
            <b>Sync file</b>
            <small>
              {folders
                ? 'For a phone or a browser that can’t use a folder: export here, open the file in Lumen there with Import sync file, then bring theirs back the same way.'
                : 'Export a sync file and save it to iCloud Drive, Dropbox or Files (or AirDrop it). On your other device, import it: edits, ratings, keywords and albums merge, newest wins.'}
            </small>
          </span>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn outline" disabled={!!busy} onClick={() => void exportFile()}>
            <Icon name="share" size={16} />
            {busy === 'export' ? 'Preparing…' : 'Export sync file'}
          </button>
          <button type="button" className="btn outline" disabled={!!busy} onClick={() => fileInput.current?.click()}>
            <Icon name="upload" size={16} />
            {busy === 'import' ? 'Merging…' : 'Import sync file…'}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void importFile(f)
            }}
          />
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          Edits backups made in Storage & backup can be imported here too: they merge instead of overwriting.
        </p>
      </div>
    </>
  )
}
