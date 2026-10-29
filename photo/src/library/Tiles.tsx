import { memo } from 'react'
import type { PhotoRecord } from '../io/types'
import { Icon } from '../ui/Icon'
import { PhotoThumb } from '../ui/PhotoThumb'
import { extOf } from './library'
import type { TileBox } from './VirtualGrid'

// Grid tiles. Clicks are handled once on the grid (event delegation via
// data-act / data-id), so a tile is pure markup and re-renders only when its
// own photo, position or selection changes.

/** Lets the shimmer behind show until the stored thumbnail arrives. */
const CLEAR = { background: 'transparent' }

const boxStyle = (b: TileBox) => ({ width: b.w, height: b.h, transform: `translate(${b.x}px, ${b.y}px)` })

function describe(p: PhotoRecord): string {
  const bits = [p.fileName]
  if (p.rating) bits.push(`${p.rating} star${p.rating === 1 ? '' : 's'}`)
  if (p.flag === 1) bits.push('pick')
  if (p.flag === -1) bits.push('rejected')
  if (p.edited) bits.push('edited')
  return bits.join(', ')
}

interface TileProps {
  photo: PhotoRecord
  box: TileBox
  selected: boolean
  index: number
  total: number
}

/** Live queries hand back fresh record objects on every change; compare only what a tile shows. */
function sameTile<P extends TileProps>(a: Readonly<P>, b: Readonly<P>): boolean {
  for (const k of Object.keys(a) as (keyof P)[]) if (k !== 'photo' && k !== 'box' && a[k] !== b[k]) return false
  const p = a.photo
  const q = b.photo
  return (
    p.id === q.id && p.rating === q.rating && p.flag === q.flag && p.edited === q.edited && p.fileName === q.fileName &&
    a.box.x === b.box.x && a.box.y === b.box.y && a.box.w === b.box.w && a.box.h === b.box.h
  )
}

export const DesktopTile = memo(function DesktopTile({ photo: p, box, selected, focused, tabbable, index, total }: TileProps & { focused: boolean; tabbable: boolean }) {
  const cls = `tile vgrid-item${selected ? ' sel' : ''}${focused ? ' focus' : ''}${p.flag === -1 ? ' rejected' : ''}`
  const flagLabel = p.flag === 1 ? `Remove pick flag from ${p.fileName}` : p.flag === -1 ? `Clear reject on ${p.fileName}` : `Flag ${p.fileName} as a pick`
  return (
    <div role="listitem" aria-posinset={index + 1} aria-setsize={total} data-id={p.id} className={cls} style={boxStyle(box)}>
      <button type="button" className="tile-media" data-act="select" tabIndex={tabbable ? 0 : -1} aria-label={describe(p)} aria-pressed={selected}>
        <div className="thumb-box">
          <PhotoThumb id={p.id} fit="contain" style={CLEAR} />
        </div>
      </button>
      <div className="tile-meta">
        <div className="tile-stars" role="group" aria-label={`Rating for ${p.fileName}`}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" tabIndex={-1} data-act="star" data-n={n} className={n <= p.rating ? 'on' : undefined} aria-label={`Rate ${n} star${n === 1 ? '' : 's'}`} aria-pressed={n <= p.rating}>
              <Icon name={n <= p.rating ? 'starFill' : 'star'} size={13} />
            </button>
          ))}
        </div>
        <button type="button" tabIndex={-1} data-act="flag" className={`tile-flag${p.flag === 1 ? ' on' : p.flag === -1 ? ' reject' : ''}`} aria-label={flagLabel} aria-pressed={p.flag !== 0}>
          <Icon name={p.flag === 1 ? 'flagFill' : p.flag === -1 ? 'reject' : 'flag'} size={14} />
        </button>
        <span className="grow" />
        {p.edited && <span className="edited-dot" title="Edited" />}
        <span className="badge">{extOf(p.fileName)}</span>
      </div>
    </div>
  )
}, sameTile)

export const PhoneTile = memo(function PhoneTile({ photo: p, box, selected, selecting, index, total }: TileProps & { selecting: boolean }) {
  return (
    <div role="listitem" aria-posinset={index + 1} aria-setsize={total} data-id={p.id} className="vgrid-item" style={boxStyle(box)}>
      <button
        type="button"
        data-act="tap"
        className={`ptile${selected ? ' sel' : ''}${p.flag === -1 ? ' rejected' : ''}`}
        aria-label={selecting ? `Select ${describe(p)}` : `Edit ${describe(p)}`}
        aria-pressed={selecting ? selected : undefined}
      >
        <div className="thumb-box">
          <PhotoThumb id={p.id} style={CLEAR} />
        </div>
        {p.flag === 1 && (
          <span className="ov flag">
            <Icon name="flagFill" size={11} />
          </span>
        )}
        {p.flag === -1 && (
          <span className="ov flag reject">
            <Icon name="reject" size={12} />
          </span>
        )}
        {p.rating > 0 && <span className="ov stars">★ {p.rating}</span>}
        {p.edited && <span className="ov dot" />}
        {selecting && <span className="check">{selected && <Icon name="check" size={14} />}</span>}
      </button>
    </div>
  )
}, sameTile)
