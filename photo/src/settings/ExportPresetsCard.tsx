import { useState } from 'react'
import { db } from '../io/db'
import { BUILTIN_PRESETS, deletePreset, presetSummary, renamePreset, type ExportPreset } from '../library/exportPresets'
import { updateSettings, useSettings } from '../state/settings'
import { tombstone } from '../sync/stamps'
import { Icon } from '../ui/Icon'
import { toast } from '../ui/toast'

/** Built-in and saved export presets: rename or delete yours (new ones are saved from the export window). */
export function ExportPresetsCard() {
  const settings = useSettings()
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const user = settings?.exportPresets ?? []

  const rename = () => {
    if (!renaming?.name.trim()) return setRenaming(null)
    const r = renaming
    setRenaming(null)
    void updateSettings((s) => ({ exportPresets: renamePreset(s.exportPresets, r.id, r.name) }))
  }
  const remove = (p: ExportPreset) => {
    void updateSettings((s) => ({ exportPresets: deletePreset(s.exportPresets, p.id) }))
    // Other devices delete it too when they sync.
    void db.transaction('rw', db.tombstones, () => tombstone('exportPreset', [p.id]))
    toast(`Deleted “${p.name}”`)
  }

  return (
    <div className="set-card">
      <div className="set-row">
        <span className="lbl">
          <b>Export presets</b>
          <small>Pick one in the export window, or export with several at once. Save your own from there.</small>
        </span>
      </div>
      <div className="list set-presets">
        {[...BUILTIN_PRESETS, ...user].map((p) => (
          <div key={p.id} className="list-row">
            {renaming?.id === p.id ? (
              <input
                type="text"
                className="grow"
                aria-label="Preset name"
                value={renaming.name}
                autoFocus
                onChange={(e) => setRenaming({ id: p.id, name: e.target.value })}
                onBlur={rename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') rename()
                  if (e.key === 'Escape') setRenaming(null)
                }}
              />
            ) : (
              <span className="grow">
                <span className="bold">{p.name}</span>
                <small className="muted" style={{ display: 'block' }}>
                  {presetSummary(p.options)} · {p.options.fileName ?? '{name}-lumen'}
                  {p.builtin ? ' · built in' : ''}
                </small>
              </span>
            )}
            {!p.builtin && renaming?.id !== p.id && (
              <>
                <button type="button" className="icon-btn" aria-label={`Rename ${p.name}`} onClick={() => setRenaming({ id: p.id, name: p.name })}>
                  <Icon name="edit" size={16} />
                </button>
                <button type="button" className="icon-btn" aria-label={`Delete ${p.name}`} onClick={() => remove(p)}>
                  <Icon name="trash" size={16} />
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
