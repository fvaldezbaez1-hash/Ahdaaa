import { Icon } from '../ui/Icon'
import { PhotoThumb } from '../ui/PhotoThumb'
import { SearchBox } from '../ui/controls'
import { SMART_VIEWS, formatBytes, plural } from './library'
import type { Library, LibrarySheet } from './useLibrary'
import { useStorageInfo } from './useStorageInfo'

export function Sidebar({ lib, open, onImportFolder }: { lib: Library; open: (s: LibrarySheet) => void; onImportFolder: () => void }) {
  const { counts, view, setView } = lib
  const total = counts.views.all
  const storage = useStorageInfo(total)
  const used = storage && storage.quota ? Math.min(100, Math.max(2, (storage.usage / storage.quota) * 100)) : 0
  return (
    <aside className="lib-side scroll" aria-label="Library">
      <div className="lib-import">
        <button type="button" className="btn primary" onClick={() => open({ type: 'import' })}>
          <Icon name="plus" size={16} />
          Import
        </button>
        <button type="button" className="btn outline" onClick={onImportFolder} aria-label="Import a folder" title="Import a folder">
          <Icon name="folder" size={16} />
        </button>
      </div>
      <SearchBox value={lib.search} onChange={lib.setSearch} placeholder="Keyword, camera, lens, file name" />

      <nav aria-label="Smart collections">
        <div className="lib-heading">Library</div>
        {SMART_VIEWS.map((v) => (
          <button key={v.id} type="button" className="lib-nav" aria-current={view === v.id ? 'true' : undefined} onClick={() => setView(v.id)}>
            <span className="ellipsis">{v.label}</span>
            <span className="count">{counts.views[v.id as keyof typeof counts.views].toLocaleString('en-US')}</span>
          </button>
        ))}
      </nav>

      <nav aria-label="Albums">
        <div className="lib-heading">Albums</div>
        {lib.albums.map((a) => {
          const c = counts.albums.get(a.id)
          const cover = a.coverId ?? c?.cover
          return (
            <div key={a.id} className="lib-album">
              <button type="button" className="lib-nav" aria-current={view === `album:${a.id}` ? 'true' : undefined} onClick={() => setView(`album:${a.id}`)}>
                <span className="cover">{cover && <PhotoThumb id={cover} />}</span>
                <span className="ellipsis">{a.name}</span>
                <span className="count">{(c?.count ?? 0).toLocaleString('en-US')}</span>
              </button>
              <button type="button" className="more" aria-label={`Options for album ${a.name}`} onClick={() => open({ type: 'albumMenu', album: a })}>
                <Icon name="more" size={16} />
              </button>
            </div>
          )
        })}
        <button type="button" className="lib-new-album" onClick={() => open({ type: 'newAlbum', ids: [] })}>
          + New album
        </button>
      </nav>

      <nav aria-label="Keywords" className="lib-keywords">
        <div className="lib-heading">Keywords</div>
        {lib.keywords.length === 0 && <p className="muted small lib-side-note">Add keywords from the info panel or to selected photos, then find them here.</p>}
        {lib.keywords.map((k) => {
          const id = `keyword:${k.name}` as const
          const on = lib.keyword === k.name
          return (
            <div key={k.name} className="lib-album">
              <button type="button" className="lib-nav" aria-current={on ? 'true' : undefined} onClick={() => setView(on ? 'all' : id)}>
                <span className="cover kw-icon" aria-hidden="true">
                  <Icon name="tag" size={14} />
                </span>
                <span className="ellipsis">{k.name}</span>
                <span className="count">{k.count.toLocaleString('en-US')}</span>
              </button>
              <button type="button" className="more" aria-label={`Options for keyword ${k.name}`} onClick={() => open({ type: 'keywordMenu', name: k.name })}>
                <Icon name="more" size={16} />
              </button>
            </div>
          )
        })}
      </nav>

      <div className="lib-storage">
        <div className="bold" style={{ marginBottom: 4 }}>
          Stored on this device
        </div>
        <div className="muted small">
          {plural(total, 'original')} · {formatBytes(counts.bytes)} · private, nothing uploaded
        </div>
        {storage && storage.quota > 0 && (
          <div
            className="progress"
            role="meter"
            aria-label="Device storage used by Lumen"
            aria-valuenow={Math.round(used)}
            aria-valuemin={0}
            aria-valuemax={100}
            title={`${formatBytes(storage.usage)} of ${formatBytes(storage.quota)} available to Lumen`}
          >
            <i style={{ width: `${used}%` }} />
          </div>
        )}
      </div>
    </aside>
  )
}
