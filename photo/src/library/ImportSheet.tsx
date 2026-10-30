import { useEffect, useRef } from 'react'
import { Icon } from '../ui/Icon'
import { Sheet } from '../ui/Sheet'
import { useIsPhone } from '../ui/hooks'
import { importer, useImport } from './importer'
import { plural } from './library'
import { isIOS } from './platform'
import { usePresetGroups } from './presetGroups'
import './sheets.css'

const FORMATS =
  'Canon CR2 · CR3   Nikon NEF · NRW   Sony ARW   Fujifilm RAF   OM / Olympus ORF   Panasonic RW2   Pentax PEF   Leica DNG · RWL   Hasselblad 3FR · FFF   Phase One IIQ   iPhone ProRAW & any DNG — plus JPEG, PNG, HEIC, WebP and TIFF.'

export function IosNote() {
  return (
    <div className="note">
      <Icon name="info" size={16} />
      <span>
        On iPhone and iPad, RAW files come from <b>Choose Files</b> (the Files app). Picking from the Photos library may hand Lumen a JPEG copy instead of the RAW.
      </span>
    </div>
  )
}

export function ImportSheet({
  onClose,
  onChooseFiles,
  onChooseFolder,
  presetId,
  onPresetId,
}: {
  onClose: () => void
  onChooseFiles: () => void
  onChooseFolder: () => void
  presetId: string
  onPresetId: (id: string) => void
}) {
  const imp = useImport()
  const phone = useIsPhone()
  const groups = usePresetGroups()
  const wasRunning = useRef(imp.running)

  // A clean import closes the sheet (the toast reports it); one with skipped files stays open to list them.
  useEffect(() => {
    if (wasRunning.current && !imp.running && !imp.result) onClose()
    wasRunning.current = imp.running
  }, [imp.running, imp.result, onClose])

  const close = () => {
    if (!imp.running) importer.dismissResult()
    onClose()
  }

  if (imp.running && imp.progress) {
    const { done, total, current } = imp.progress
    const pct = Math.round((done / Math.max(1, total)) * 100)
    return (
      <Sheet
        title="Importing"
        onClose={close}
        footer={
          <div className="lib-foot">
            <button type="button" className="btn ghost" onClick={close}>
              Hide
            </button>
            <button type="button" className="btn outline" onClick={() => importer.cancel()}>
              Cancel import
            </button>
          </div>
        }
      >
        <div className="stack" aria-live="polite">
          <div className="row between">
            <b className="tnum">
              {Math.min(done + 1, total).toLocaleString('en-US')} of {plural(total, 'photo')}
            </b>
            <span className="muted tnum">{pct}%</span>
          </div>
          <div className="progress" role="progressbar" aria-label="Import progress" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <i style={{ width: `${pct}%` }} />
          </div>
          <div className="muted small ellipsis">{current ?? ' '}</div>
          <p className="muted small">You can hide this and keep working; the import carries on in the background.</p>
        </div>
      </Sheet>
    )
  }

  if (imp.result) {
    const { added, skipped, notices, cancelled } = imp.result
    return (
      <Sheet
        title={cancelled ? 'Import stopped' : 'Import finished'}
        onClose={close}
        footer={
          <div className="lib-foot">
            <button type="button" className="btn primary" onClick={close} autoFocus>
              Done
            </button>
          </div>
        }
      >
        <div className="stack">
          <p className="sheet-text">{added.length ? `${plural(added.length, 'photo')} added to your library.` : 'No photos were added.'}</p>
          {skipped.length > 0 && (
            <section className="stack tight">
              <h3>{plural(skipped.length, 'file')} skipped</h3>
              <div className="list skipped">
                {skipped.map((s, i) => (
                  <div key={`${s.name}-${i}`} className="list-row">
                    <span className="ellipsis">{s.name}</span>
                    <span className="muted small">{s.reason}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
          {notices.length > 0 && (
            <section className="stack tight">
              <h3>Good to know</h3>
              <div className="list skipped">
                {notices.map((n, i) => (
                  <div key={`${n.name}-${i}`} className="list-row">
                    <span className="ellipsis">{n.name}</span>
                    <span className="muted small">{n.message}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </Sheet>
    )
  }

  return (
    <Sheet title="Import photos" onClose={close}>
      <div className="stack loose">
        {phone ? (
          <button type="button" className="btn primary lg block" onClick={onChooseFiles}>
            <Icon name="plus" />
            Choose photos
          </button>
        ) : (
          <div className="drop-zone">
            <Icon name="image" size={34} />
            <b style={{ fontSize: 15 }}>Drop photos or a folder here</b>
            <span className="muted small">or</span>
            <div className="row wrap" style={{ justifyContent: 'center' }}>
              <button type="button" className="btn primary" onClick={onChooseFiles}>
                Choose files…
              </button>
              <button type="button" className="btn outline" onClick={onChooseFolder}>
                <Icon name="folder" size={16} />
                Choose a folder…
              </button>
            </div>
          </div>
        )}
        {isIOS && <IosNote />}
        <div className="formats">
          <b>Opens RAW from 1,000+ cameras</b>
          {FORMATS}
        </div>
        <div className="setting-row">
          <label className="lbl" htmlFor="import-preset">
            <b>Apply a preset on import</b>
            <small>Start every photo from your look.</small>
          </label>
          <select id="import-preset" className="input" value={presetId} onChange={(e) => onPresetId(e.target.value)}>
            <option value="">None</option>
            {groups.map((g) => (
              <optgroup key={g.id} label={g.name}>
                {g.presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="row small muted" style={{ gap: 8 }}>
          <Icon name="lock" size={15} />
          Originals are stored privately on this device. Nothing is uploaded.
        </div>
      </div>
    </Sheet>
  )
}
