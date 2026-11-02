// Compare and Survey: judging photos against each other, over the library.
//   Compare — the select and a candidate side by side (stacked on phones),
//             zoom and pan move both; arrows (or a swipe) change the candidate.
//   Survey  — the selected photos all at once; rate and flag in place, take
//             one out with its × (or Delete) until the keepers are left.
import { useEffect, useEffectEvent, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import type { PhotoRecord } from '../io/types'
import { navigate } from '../router'
import { Icon } from '../ui/Icon'
import { PhotoThumb } from '../ui/PhotoThumb'
import { Stars } from '../ui/controls'
import { isTyping, useElementSize, useIsPhone } from '../ui/hooks'
import { setFlag, setRating } from './actions'
import { outputSize } from './exportMath'
import { keyCommand, plural, surveyColumns } from './library'
import { isApple } from './platform'
import { usePreview } from './preview'
import type { Library, Loupe as LoupeState } from './useLibrary'

/** Shared zoom: 1 = fit; (cx, cy) is the photo point at the middle of each pane (0…1). */
interface ZoomState {
  scale: number
  cx: number
  cy: number
}
const FIT: ZoomState = { scale: 1, cx: 0.5, cy: 0.5 }
const MAX_SCALE = 6

export function LoupeView({ lib }: { lib: Library }) {
  const loupe = lib.loupe
  useEffect(() => {
    // Photos deleted meanwhile drop out; nothing left closes it.
    if (!loupe || !lib.photos) return
    const ids = loupe.ids.filter((id) => lib.byId.has(id))
    if (ids.length !== loupe.ids.length) {
      if (loupe.type === 'survey') lib.setLoupe(ids.length ? { ...loupe, ids } : null)
      else if (!lib.byId.has(loupe.select) || !lib.byId.has(loupe.candidate)) lib.setLoupe(null)
    }
  }, [loupe, lib])
  if (!loupe) return null
  return loupe.type === 'compare' ? <Compare lib={lib} state={loupe} /> : <Survey lib={lib} state={loupe} />
}

type CompareState = Extract<LoupeState, { type: 'compare' }>

function Compare({ lib, state }: { lib: Library; state: CompareState }) {
  const phone = useIsPhone()
  const [zoom, setZoom] = useState<ZoomState>(FIT)
  const [active, setActive] = useState<'select' | 'candidate'>('candidate')
  const select = lib.byId.get(state.select)
  const candidate = lib.byId.get(state.candidate)
  const pool = state.ids.filter((id) => id !== state.select)
  const at = pool.indexOf(state.candidate)
  const close = () => lib.setLoupe(null)

  const step = (d: number) => {
    if (pool.length < 1) return
    const next = pool[(Math.max(0, at) + d + pool.length) % pool.length]
    lib.setLoupe({ ...state, candidate: next })
  }
  const makeSelect = () => {
    const rest = state.ids.filter((id) => id !== state.candidate)
    const next = rest[(rest.indexOf(state.select) + 1) % rest.length]
    if (next && next !== state.candidate) lib.setLoupe({ ...state, select: state.candidate, candidate: next })
  }
  const swap = () => lib.setLoupe({ ...state, select: state.candidate, candidate: state.select })
  const target = active === 'select' ? select : candidate

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.defaultPrevented || isTyping(e) || document.querySelector('.sheet-backdrop')) return
    const k = e.key
    if (k === 'Escape' || ((k === 'c' || k === 'C') && !e.metaKey && !e.ctrlKey)) return void (e.preventDefault(), close())
    if (k === 'ArrowRight' || k === 'ArrowLeft') return void (e.preventDefault(), step(k === 'ArrowRight' ? 1 : -1))
    if (k === 'ArrowUp') return void (e.preventDefault(), makeSelect())
    if (k === 'ArrowDown') return void (e.preventDefault(), swap())
    if (k === 'Tab') return void (e.preventDefault(), setActive(active === 'select' ? 'candidate' : 'select'))
    if (k === 'z' || k === 'Z') return void (e.preventDefault(), setZoom(zoom.scale > 1 ? FIT : { ...zoom, scale: 2.5 }))
    const cmd = keyCommand(e, isApple)
    if (!target || !cmd) return
    if (cmd.type === 'rate') void setRating([target.id], cmd.value)
    else if (cmd.type === 'flag') void setFlag([target.id], cmd.value)
    else if (cmd.type === 'open') navigate(`/edit/${encodeURIComponent(target.id)}`)
    else return
    e.preventDefault()
  })
  useEffect(() => {
    const l = (e: KeyboardEvent) => onKey(e)
    // Capture: ahead of the library grid's own shortcuts.
    window.addEventListener('keydown', l, true)
    return () => window.removeEventListener('keydown', l, true)
  }, [])

  return (
    <div className={phone ? 'loupe compare phone' : 'loupe compare'} role="dialog" aria-modal="true" aria-label="Compare photos">
      <LoupeBar title="Compare" sub={pool.length > 1 ? `Candidate ${at + 1} of ${pool.length}` : undefined} onClose={close}>
        {!phone && (
          <>
            <button type="button" className="btn ghost sm" onClick={swap} title="Swap select and candidate (↓)">
              Swap
            </button>
            <button type="button" className="btn ghost sm" onClick={makeSelect} disabled={state.ids.length < 3} title="The candidate becomes the select (↑)">
              Make select
            </button>
            <button type="button" className="btn ghost sm" onClick={() => setZoom(zoom.scale > 1 ? FIT : { ...zoom, scale: 2.5 })} title="Zoom both (Z)">
              {zoom.scale > 1 ? 'Fit' : 'Zoom'}
            </button>
            {state.ids.length > 2 && (
              <button type="button" className="btn ghost sm" onClick={() => lib.openSurvey(state.ids)} title="See them all (N)">
                Survey
              </button>
            )}
          </>
        )}
      </LoupeBar>
      <div className="cmp-panes">
        {[
          { role: 'select' as const, photo: select, label: 'Select' },
          { role: 'candidate' as const, photo: candidate, label: 'Candidate' },
        ].map(({ role, photo, label }) => (
          <section key={role} className={active === role ? 'cmp-pane on' : 'cmp-pane'} aria-label={`${label}: ${photo?.fileName ?? ''}`} onPointerDown={() => setActive(role)}>
            {photo && (
              <ZoomPane
                photo={photo}
                zoom={zoom}
                onZoom={setZoom}
                onSwipe={role === 'candidate' && pool.length > 1 ? step : undefined}
                phone={phone}
              />
            )}
            <div className="cmp-label">
              <span className={role === 'select' ? 'badge' : 'badge accent'}>{label}</span>
              <span className="ellipsis small">{photo?.fileName}</span>
            </div>
            {photo && <RateBar photo={photo} />}
            {role === 'candidate' && pool.length > 1 && (
              <>
                <button type="button" className="cmp-nav prev" aria-label="Previous candidate" onClick={() => step(-1)}>
                  <Icon name="left" size={22} />
                </button>
                <button type="button" className="cmp-nav next" aria-label="Next candidate" onClick={() => step(1)}>
                  <Icon name="right" size={22} />
                </button>
              </>
            )}
          </section>
        ))}
      </div>
      {!phone && <p className="loupe-hint muted small">← → candidate · ↑ make select · ↓ swap · Tab switch · 0–5 rate · P / X / U flag · Z zoom · Esc close</p>}
    </div>
  )
}

/** A photo at the shared zoom: wheel or pinch-free double-click zooms both panes, drag pans both. */
function ZoomPane({ photo, zoom, onZoom, onSwipe, phone }: { photo: PhotoRecord; zoom: ZoomState; onZoom: (z: ZoomState) => void; onSwipe?: (d: number) => void; phone: boolean }) {
  const [box, setBox] = useState<HTMLDivElement | null>(null)
  const { width: W, height: H } = useElementSize(box)
  const out = outputSize(photo)
  const fit = W && H ? Math.min(W / out.width, H / out.height) : 0
  const w = out.width * fit * zoom.scale, h = out.height * fit * zoom.scale
  const preview = usePreview(photo, phone ? 1600 : 2400)
  const drag = useRef<{ x: number; y: number; z: ZoomState; moved: boolean } | null>(null)

  const clampCenter = (z: ZoomState): ZoomState => {
    if (z.scale <= 1) return FIT
    const hx = Math.min(0.5, W / (2 * out.width * fit * z.scale)), hy = Math.min(0.5, H / (2 * out.height * fit * z.scale))
    return { scale: z.scale, cx: Math.min(1 - hx, Math.max(hx, z.cx)), cy: Math.min(1 - hy, Math.max(hy, z.cy)) }
  }
  /** Zoom to `scale`, keeping the photo point under (px, py) — pane coordinates — in place. */
  const zoomAt = (scale: number, px: number, py: number) => {
    const s = Math.min(MAX_SCALE, Math.max(1, scale))
    const ox = W / 2 - zoom.cx * w, oy = H / 2 - zoom.cy * h
    const fx = (px - ox) / w, fy = (py - oy) / h
    const w2 = out.width * fit * s, h2 = out.height * fit * s
    onZoom(clampCenter({ scale: s, cx: fx - (px - W / 2) / w2, cy: fy - (py - H / 2) / h2 }))
  }
  const local = (e: { clientX: number; clientY: number }) => {
    const r = box!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, z: zoom, moved: false }
  }
  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x, dy = e.clientY - d.y
    if (Math.hypot(dx, dy) > 4) d.moved = true
    if (d.z.scale > 1) onZoom(clampCenter({ ...d.z, cx: d.z.cx - dx / w, cy: d.z.cy - dy / h }))
  }
  const onUp = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    drag.current = null
    if (!d) return
    const dx = e.clientX - d.x
    // Swipe sideways at fit size: next / previous candidate.
    if (onSwipe && d.z.scale <= 1 && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(e.clientY - d.y) * 1.5) onSwipe(dx < 0 ? 1 : -1)
  }

  return (
    <div
      ref={setBox}
      className={zoom.scale > 1 ? 'cmp-view zoomed' : 'cmp-view'}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={() => (drag.current = null)}
      onDoubleClick={(e) => {
        const p = local(e)
        if (zoom.scale > 1) onZoom(FIT)
        else zoomAt(2.5, p.x, p.y)
      }}
      onWheel={(e) => {
        const p = local(e)
        zoomAt(zoom.scale * Math.exp(-e.deltaY * 0.002), p.x, p.y)
      }}
    >
      {fit > 0 && (
        <div className="cmp-img" style={{ width: w, height: h, transform: `translate(${W / 2 - zoom.cx * w}px, ${H / 2 - zoom.cy * h}px)` }}>
          <PhotoThumb id={photo.id} fit="contain" alt="" />
          {preview && <img src={preview} alt={`Preview of ${photo.fileName}`} draggable={false} />}
        </div>
      )}
    </div>
  )
}

function RateBar({ photo, onRemove }: { photo: PhotoRecord; onRemove?: () => void }) {
  return (
    <div className="loupe-rate" onPointerDown={(e) => e.stopPropagation()}>
      <Stars value={photo.rating} size={15} label={`Rating for ${photo.fileName}`} onChange={(v) => void setRating([photo.id], v)} />
      <span className="grow" />
      <button type="button" className={photo.flag === 1 ? 'loupe-flag on' : 'loupe-flag'} aria-pressed={photo.flag === 1} aria-label={`Pick ${photo.fileName}`} title="Pick (P)" onClick={() => void setFlag([photo.id], photo.flag === 1 ? 0 : 1)}>
        <Icon name={photo.flag === 1 ? 'flagFill' : 'flag'} size={15} />
      </button>
      <button type="button" className={photo.flag === -1 ? 'loupe-flag reject on' : 'loupe-flag reject'} aria-pressed={photo.flag === -1} aria-label={`Reject ${photo.fileName}`} title="Reject (X)" onClick={() => void setFlag([photo.id], photo.flag === -1 ? 0 : -1)}>
        <Icon name="reject" size={15} />
      </button>
      {onRemove && (
        <button type="button" className="loupe-flag" aria-label={`Take ${photo.fileName} out of the survey`} title="Take out of the survey (Delete)" onClick={onRemove}>
          <Icon name="x" size={15} />
        </button>
      )}
    </div>
  )
}

type SurveyState = Extract<LoupeState, { type: 'survey' }>

function Survey({ lib, state }: { lib: Library; state: SurveyState }) {
  const phone = useIsPhone()
  const [area, setArea] = useState<HTMLDivElement | null>(null)
  const { width, height } = useElementSize(area)
  const photos = useMemo(() => state.ids.map((id) => lib.byId.get(id)).filter((p): p is PhotoRecord => !!p), [state.ids, lib.byId])
  const [active, setActive] = useState(0)
  const cols = phone ? 2 : surveyColumns(photos.length, width, height)
  const cur = photos[Math.min(active, photos.length - 1)]
  const close = () => lib.setLoupe(null)
  const remove = (id: string) => {
    const ids = state.ids.filter((x) => x !== id)
    lib.setLoupe(ids.length ? { ...state, ids } : null)
    setActive((a) => Math.min(a, ids.length - 1))
  }

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.defaultPrevented || isTyping(e) || document.querySelector('.sheet-backdrop')) return
    const k = e.key
    if (k === 'Escape' || ((k === 'n' || k === 'N') && !e.metaKey && !e.ctrlKey)) return void (e.preventDefault(), close())
    const move = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[k]
    if (move) return void (e.preventDefault(), setActive((a) => Math.min(photos.length - 1, Math.max(0, a + move))))
    if (!cur) return
    if (k === 'Delete' || k === 'Backspace') return void (e.preventDefault(), remove(cur.id))
    if ((k === 'c' || k === 'C') && photos.length >= 2) return void (e.preventDefault(), lib.openCompare([cur.id, ...photos.map((p) => p.id).filter((id) => id !== cur.id)]))
    const cmd = keyCommand(e, isApple)
    if (!cmd) return
    if (cmd.type === 'rate') void setRating([cur.id], cmd.value)
    else if (cmd.type === 'flag') void setFlag([cur.id], cmd.value)
    else if (cmd.type === 'open') navigate(`/edit/${encodeURIComponent(cur.id)}`)
    else return
    e.preventDefault()
  })
  useEffect(() => {
    const l = (e: KeyboardEvent) => onKey(e)
    window.addEventListener('keydown', l, true)
    return () => window.removeEventListener('keydown', l, true)
  }, [])

  return (
    <div className={phone ? 'loupe survey phone' : 'loupe survey'} role="dialog" aria-modal="true" aria-label="Survey">
      <LoupeBar
        title="Survey"
        sub={plural(photos.length, 'photo')}
        onClose={close}
      >
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => {
            lib.setSel({ ids: new Set(state.ids), focus: cur?.id ?? null, anchor: cur?.id ?? null })
            close()
          }}
          title="Select these photos in the library"
        >
          Select these
        </button>
      </LoupeBar>
      <div ref={setArea} className="survey-area">
        <div className="survey-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }} role="list">
          {photos.map((p, i) => (
            <div key={p.id} role="listitem" className={i === active ? 'survey-cell on' : 'survey-cell'} onPointerDown={() => setActive(i)} onDoubleClick={() => navigate(`/edit/${encodeURIComponent(p.id)}`)}>
              <div className="survey-img">
                <PhotoThumb id={p.id} fit="contain" alt={p.fileName} style={{ background: 'transparent' }} />
                {p.flag === -1 && <span className="survey-dim" aria-hidden="true" />}
              </div>
              <RateBar photo={p} onRemove={() => remove(p.id)} />
            </div>
          ))}
        </div>
      </div>
      {!phone && <p className="loupe-hint muted small">Arrows move · 0–5 rate · P / X / U flag · Delete takes a photo out · C compare · Enter edit · Esc close</p>}
    </div>
  )
}

function LoupeBar({ title, sub, onClose, children }: { title: string; sub?: string; onClose: () => void; children?: React.ReactNode }) {
  return (
    <header className="loupe-bar">
      <div className="grow">
        <h2>{title}</h2>
        {sub && <span className="muted small tnum">{sub}</span>}
      </div>
      {children}
      <button type="button" className="btn primary sm" onClick={onClose}>
        Done
      </button>
    </header>
  )
}
