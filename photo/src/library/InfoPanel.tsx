import type { AlbumRecord, PhotoRecord } from '../io/types'
import { link } from '../router'
import { Icon } from '../ui/Icon'
import { PhotoThumb } from '../ui/PhotoThumb'
import { Stars } from '../ui/controls'
import { setFlag, setRating } from './actions'
import { extOf, formatBytes, formatCamera, formatDimensions, formatExposure, formatMegapixels, formatTaken, plural } from './library'

/** Details of the focused photo (desktop right panel). */
export function InfoPanel({ photo, selectedCount, albums }: { photo?: PhotoRecord; selectedCount: number; albums: AlbumRecord[] }) {
  if (!photo)
    return (
      <aside className="lib-info" aria-label="Photo info">
        <div className="lib-info-empty">
          <Icon name="info" size={26} />
          <p style={{ marginTop: 8 }}>{selectedCount > 1 ? `${plural(selectedCount, 'photo')} selected` : 'Select a photo to see its details.'}</p>
        </div>
      </aside>
    )

  const m = photo.meta
  const camera = formatCamera(m)
  const exposure = formatExposure(m)
  const inAlbums = albums.filter((a) => photo.albumIds.includes(a.id))
  const look = photo.recipe.look
  return (
    <aside className="lib-info scroll" aria-label="Photo info">
      {selectedCount > 1 && (
        <span className="badge accent" style={{ alignSelf: 'flex-start' }}>
          {plural(selectedCount, 'photo')} selected
        </span>
      )}
      <div className="lib-info-thumb">
        <div className="thumb-box">
          <PhotoThumb id={photo.id} fit="contain" alt={`Preview of ${photo.fileName}`} style={{ background: 'transparent' }} />
        </div>
      </div>
      <div>
        <h2>{photo.fileName}</h2>
        <div className="muted small">{m.takenAt ? formatTaken(photo.takenAt) : `Added ${formatTaken(photo.addedAt)}`}</div>
      </div>
      <div className="row between">
        <Stars value={photo.rating} size={19} label={`Rating for ${photo.fileName}`} onChange={(v) => void setRating([photo.id], v)} />
        <div className="row" style={{ gap: 6 }}>
          <button type="button" className="lib-pick" aria-pressed={photo.flag === 1} onClick={() => void setFlag([photo.id], photo.flag === 1 ? 0 : 1)} title="Pick (P)">
            <Icon name="flag" size={14} />
            {photo.flag === 1 ? 'Picked' : 'Pick'}
          </button>
          <button
            type="button"
            className="lib-pick reject"
            aria-pressed={photo.flag === -1}
            onClick={() => void setFlag([photo.id], photo.flag === -1 ? 0 : -1)}
            aria-label="Reject"
            title="Reject (X)"
          >
            <Icon name="reject" size={15} />
          </button>
        </div>
      </div>
      <a className="btn primary lg block" href={link(`/edit/${encodeURIComponent(photo.id)}`)}>
        <Icon name="edit" size={17} />
        Edit photo
      </a>
      <dl>
        {camera && (
          <>
            <dt>Camera</dt>
            <dd>{camera}</dd>
          </>
        )}
        {m.lens && (
          <>
            <dt>Lens</dt>
            <dd>{m.lens}</dd>
          </>
        )}
        {exposure && (
          <>
            <dt>Exposure</dt>
            <dd className="tnum">{exposure}</dd>
          </>
        )}
        <dt>Size</dt>
        <dd className="tnum">
          {formatDimensions(photo.width, photo.height)} · {formatMegapixels(photo.width, photo.height)}
        </dd>
        <dt>File</dt>
        <dd>
          {extOf(photo.fileName)} {photo.kind === 'raw' || photo.previewOnly ? 'RAW' : ''} · {formatBytes(photo.fileSize)}
          {photo.previewOnly && <div className="muted small">Shown from the camera’s built-in preview</div>}
        </dd>
        {look && (
          <>
            <dt>Look</dt>
            <dd>
              {look.name} · {look.amount}%
            </dd>
          </>
        )}
        {inAlbums.length > 0 && (
          <>
            <dt>Albums</dt>
            <dd>{inAlbums.map((a) => a.name).join(', ')}</dd>
          </>
        )}
      </dl>
    </aside>
  )
}
