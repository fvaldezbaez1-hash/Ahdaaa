import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { loadFullResolution } from '../../io/api'
import { Icon } from '../../ui/Icon'
import { CropOverlay } from '../crop/CropOverlay'
import { pickWhiteBalance } from '../panels/actions'
import { useSession } from '../session'
import { useView, view } from '../view'
import { ToolHint } from '../masks/ToolHint'
import { ToolOverlay } from '../masks/ToolOverlay'
import { isTyping } from '../../ui/hooks'
import { CompareOverlay } from './CompareOverlay'
import { stageControl, StageView } from './stageView'
import { toolBus, type ToolPointer } from './toolBus'

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
  /** A masking / healing gesture owns the (single) pointer. */
  tool: boolean
  /** Space held: drag pans even while a tool is active. */
  space: boolean
}

const photoTool = (t: string | null) => t === 'mask' || t === 'heal'

/**
 * The photo. Press and hold to compare with the original, pinch / Ctrl+wheel
 * to zoom, drag to pan when zoomed, double-click to toggle Fit ↔ 100%.
 */
export function Stage({ pad }: { pad: number }) {
  const session = useSession()
  const stageRef = useRef<HTMLDivElement>(null)
  const photoRef = useRef<HTMLDivElement>(null)
  const sv = useRef<StageView | null>(null)
  const g = useRef<Gesture>({ pointers: new Map(), panning: false, tool: false, space: false })
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
      if (view.get().tool === 'crop') return
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== ' ' || isTyping(e) || !photoTool(view.get().tool)) return
      e.preventDefault()
      g.current.space = e.type === 'keydown'
      stage.classList.toggle('spacepan', g.current.space)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    return () => {
      ro.disconnect()
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
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
  const toolPointer = (e: PointerEvent<HTMLDivElement>): ToolPointer => {
    const r = photoRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top, box: { w: r.width, h: r.height }, clientX: e.clientX, clientY: e.clientY, alt: e.altKey, shift: e.shiftKey, touch: e.pointerType === 'touch' }
  }
  const stopHold = () => {
    clearTimeout(g.current.holdTimer)
    if (view.get().holding) view.set({ holding: false })
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const v = view.get()
    if (v.tool === 'crop' || e.button > 0) return
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
      if (photoTool(v.tool)) {
        // One pointer paints or drags handles; Space+drag (and two fingers) move the photo instead.
        st.tool = !st.space && e.button === 0 && !!toolBus.get()?.down(toolPointer(e))
        if (st.space) st.panning = true
        return
      }
      st.holdTimer = setTimeout(() => view.set({ holding: true }), HOLD_MS)
    } else if (st.pointers.size === 2) {
      if (st.tool) toolBus.get()?.cancel()
      st.tool = false
      stopHold()
      const [a, b] = [...st.pointers.values()]
      st.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, zoom: v.zoom, pan: s.getPan() }
    }
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const st = g.current, s = sv.current
    if (st.tool && st.pointers.has(e.pointerId)) return toolBus.get()?.move(toolPointer(e))
    if (!st.pointers.size && e.pointerType !== 'touch' && photoTool(view.get().tool)) toolBus.get()?.hover(st.space ? null : toolPointer(e))
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
    if (!st.panning && Math.hypot(dx, dy) > MOVE_PX && (view.get().zoom !== 1 || st.space)) {
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
    if (st.tool) {
      st.tool = false
      toolBus.get()?.up(toolPointer(e))
      st.start = undefined
      return
    }
    stopHold()
    const p = local(e)
    // Double-tap on touch screens (double-click is handled separately for mice).
    if (e.pointerType !== 'mouse' && !st.panning && e.type === 'pointerup' && !photoTool(view.get().tool)) {
      const t = st.lastTap
      if (t && performance.now() - t.at < 300 && Math.hypot(t.x - p.x, t.y - p.y) < 30) {
        sv.current?.toggleZoom(p.x, p.y)
        st.lastTap = undefined
      } else st.lastTap = { at: performance.now(), ...p }
    }
    st.start = undefined
    st.panning = false
  }

  const cls = ['ed-stage', eyedropper && 'picking', zoom !== 1 && 'zoomed', tool === 'crop' && 'cropping', photoTool(tool) && `tool-${tool}`].filter(Boolean).join(' ')
  return (
    <div
      ref={stageRef}
      className={cls}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => toolBus.get()?.hover(null)}
      onDoubleClick={(e) => !view.get().tool && !view.get().eyedropper && sv.current?.toggleZoom(local(e).x, local(e).y)}
    >
      <div ref={photoRef} className="ed-photo">
        {tool === 'crop' ? <CropOverlay /> : photoTool(tool) ? <ToolOverlay /> : <CompareOverlay />}
      </div>
      {(holding || mode === 'before') && !tool && <span className="ed-badge">Original</span>}
      {photoTool(tool) && <ToolHint />}
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
