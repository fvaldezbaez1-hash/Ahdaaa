import { useState } from 'react'
import type { AlbumRecord } from '../io/types'
import { Icon } from '../ui/Icon'
import { PhotoThumb } from '../ui/PhotoThumb'
import { Sheet } from '../ui/Sheet'
import { toast } from '../ui/toast'
import { addToAlbum } from './actions'
import { plural, type Counts } from './library'
import './sheets.css'

/** Pick an album for the selected photos, or start a new one. */
export function AlbumPicker({ ids, albums, counts, onNew, onClose }: { ids: string[]; albums: AlbumRecord[]; counts: Counts['albums']; onNew: () => void; onClose: () => void }) {
  return (
    <Sheet title={`Add ${plural(ids.length, 'photo')} to an album`} onClose={onClose}>
      <div className="list">
        {albums.map((a) => {
          const c = counts.get(a.id)
          const cover = a.coverId ?? c?.cover
          return (
            <button
              key={a.id}
              type="button"
              className="list-row album-row"
              onClick={async () => {
                onClose()
                if ((await addToAlbum(ids, a.id)) !== undefined) toast(`Added ${plural(ids.length, 'photo')} to ${a.name}`)
              }}
            >
              <span className="cover">{cover ? <PhotoThumb id={cover} /> : null}</span>
              <span className="grow ellipsis">{a.name}</span>
              <span className="muted small tnum">{(c?.count ?? 0).toLocaleString('en-US')}</span>
            </button>
          )
        })}
        <button type="button" className="list-row album-row" onClick={onNew} style={{ color: 'var(--accent-text)' }}>
          <span className="cover" style={{ display: 'grid', placeItems: 'center' }}>
            <Icon name="plus" />
          </span>
          <span className="grow">New album…</span>
        </button>
      </div>
    </Sheet>
  )
}

/** Name a new album or rename one. */
export function NameSheet({
  title,
  initial = '',
  confirmLabel,
  onSubmit,
  onClose,
}: {
  title: string
  initial?: string
  confirmLabel: string
  onSubmit: (name: string) => unknown
  onClose: () => void
}) {
  const [name, setName] = useState(initial)
  const submit = () => {
    if (!name.trim()) return
    onClose()
    void onSubmit(name.trim())
  }
  return (
    <Sheet
      title={title}
      onClose={onClose}
      footer={
        <div className="lib-foot">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="album-name" className="btn primary" disabled={!name.trim()}>
            {confirmLabel}
          </button>
        </div>
      }
    >
      <form
        id="album-name"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <label className="field">
          <span>Album name</span>
          <input autoFocus value={name} maxLength={80} placeholder="e.g. Coast trip" onChange={(e) => setName(e.target.value)} enterKeyHint="done" />
        </label>
      </form>
    </Sheet>
  )
}
