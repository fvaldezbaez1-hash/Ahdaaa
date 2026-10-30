import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { loadFullResolution } from '../../io/api'
import { Icon } from '../../ui/Icon'
import { CropOverlay } from '../crop/CropOverlay'
import { pickWhiteBalance } from '../panels/actions'
import { useSession } from '../session'
import { useView, view } from '../view'
import { CompareOverlay } from './CompareOverlay'
import { stageControl, StageView } from './stageView'

/** Press longer than this (without moving) to see the original. */
const HOLD_MS = 120
const MOVE_PX = 6

interface Gesture {
  pointers: Map<number, { x: number; y: number }>
  start?: { x: number; y: number; pan: { x: number; y: number } }
  pinch?: { dist: number; mid: { x: number; y: number }; zoom: number; pan: { x: number; y: number } }
  panning: boolean
  holdTimer?: ReturnType<typeof setTimeout>
  lastTap?: { at: number; x: number; y: number }
}

/**
 * The photo. Press and hold to compare with the original, pinch / Ctrl+wheel
 * to zoom, drag to pan when zoomed, double-click to toggle Fit ↔ 100%.
 */
export function Stage({ pad }: { pad: number }) {
  const session = useSession()
  const stageRef = useRef<HTMLDivElement>(null)
  const photoRef = useRef<HTMLDivElement>(null)
  const sv = useRef<StageView | null>(null)
  const g = useRef<Gesture>({ pointers: new Map(), panning: false })
  const tool = useView((s) => s.tool)
  const eyedropper = useView((s) => s.eyedropper)
  const holding = useView((s) => s.holding)
  const mode = useView((s) => s.mode)
  const zoom = useView((s) => s.zoom)
  const [notice, setNotice] = useState(session.photo.notice)

  useEffect(() => {
    const stage = stageRef.current!, photo = photoRef.current!
    const canvas = session.engine.canvas as HTMLCanvasElement
    photo.prepend(canvas)
    const fullScale = session.photo.fullWidth / session.photo.image.width
    const s = new StageView(session.engine, photo, fullScale, async (signal) => (await loadFullResolution(session.id, signal)).image)
    sv.current = s
    stageControl.attach(s)
    const ro = new ResizeObserver(([e]) => s.setStage(e.contentRect.width, e.contentRect.height, pad))
    ro.observe(stage)
    const onWheel = (e: WheelEvent) => {
      if (view.get().tool) return
      const rect = stage.getBoundingClientRect()
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
        s.zoomTo(view.get().zoom * Math.exp(-dy * 0.01), e.clientX - rect.left, e.clientY - rect.top)
      } else if (view.get().zoom !== 1) {
        e.preventDefault()
        s.panBy(-e.deltaX, -e.deltaY)
      }
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      ro.disconnect()
      stage.removeEventListener('wheel', onWheel)
      s.dispose()
      stageControl.attach(null)
      sv.current = null
      canvas.remove()
    }
  }, [session, pad])

  const local = (e: { clientX: number; clientY: number }) => {
    const r = stageRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const stopHold = () => {
    clearTimeout(g.current.holdTimer)
    if (view.get().holding) view.set({ holding: false })
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const v = view.get()
    if (v.tool || e.button > 0) return
    if (v.eyedropper) {
      const r = (session.engine.canvas as HTMLCanvasElement).getBoundingClientRect()
      const nx = (e.clientX - r.left) / r.width, ny = (e.clientY - r.top) / r.height
      if (nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1) pickWhiteBalance(session, nx, ny)
      return
    }
    const st = g.current, p = local(e), s = sv.current
    if (!s) return
    e.currentTarget.setPointerCapture(e.pointerId)
    st.pointers.set(e.pointerId, p)
    if (st.pointers.size === 1) {
      st.start = { ...p, pan: s.getPan() }
      st.panning = false
      clearTimeout(st.holdTimer)
      st.holdTimer = setTimeout(() => view.set({ holding: true }), HOLD_MS)
    } else if (st.pointers.size === 2) {
      stopHold()
      const [a, b] = [...st.pointers.values()]
      st.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, zoom: v.zoom, pan: s.getPan() }
    }
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const st = g.current, s = sv.current
    if (!s || !st.pointers.has(e.pointerId)) return
    const p = local(e)
    st.pointers.set(e.pointerId, p)
    if (st.pinch && st.pointers.size >= 2) {
      const [a, b] = [...st.pointers.values()]
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const k = Math.hypot(a.x - b.x, a.y - b.y) / st.pinch.dist
      s.pinch(st.pinch.zoom, st.pinch.pan, st.pinch.mid, st.pinch.zoom * k, mid)
      return
    }
    if (!st.start) return
    const dx = p.x - st.start.x, dy = p.y - st.start.y
    if (!st.panning && Math.hypot(dx, dy) > MOVE_PX && view.get().zoom !== 1) {
      st.panning = true
      stopHold()
    }
    if (st.panning) s.setPan(st.start.pan.x + dx, st.start.pan.y + dy)
  }

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const st = g.current
    if (!st.pointers.delete(e.pointerId)) return
    if (st.pointers.size < 2) st.pinch = undefined
    if (st.pointers.size > 0) return
    stopHold()
    const p = local(e)
    // Double-tap on touch screens (double-click is handled separately for mice).
    if (e.pointerType !== 'mouse' && !st.panning && e.type === 'pointerup') {
      const t = st.lastTap
      if (t && performance.now() - t.at < 300 && Math.hypot(t.x - p.x, t.y - p.y) < 30) {
        sv.current?.toggleZoom(p.x, p.y)
        st.lastTap = undefined
      } else st.lastTap = { at: performance.now(), ...p }
    }
    st.start = undefined
    st.panning = false
  }

  const cls = ['ed-stage', eyedropper && 'picking', zoom !== 1 && 'zoomed', tool && 'cropping'].filter(Boolean).join(' ')
  return (
    <div
      ref={stageRef}
      className={cls}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={(e) => !view.get().tool && !view.get().eyedropper && sv.current?.toggleZoom(local(e).x, local(e).y)}
    >
      <div ref={photoRef} className="ed-photo">
        {tool === 'crop' ? <CropOverlay /> : <CompareOverlay />}
      </div>
      {(holding || mode === 'before') && !tool && <span className="ed-badge">Original</span>}
      {eyedropper && (
        <div className="ed-stage-hint" role="status">
          <Icon name="eyedropper" size={15} /> Click something that should be neutral gray or white · Esc to cancel
        </div>
      )}
      {notice && !tool && (
        <div className="ed-notice" role="status">
          <Icon name="info" size={15} />
          <span className="grow">{notice}</span>
          <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setNotice(undefined)}>
            <Icon name="x" size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
