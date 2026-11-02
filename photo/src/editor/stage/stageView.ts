import type { EditRecipe } from '../../edit/types'
import type { Engine, SourceImage } from '../../engine/types'
import { editor } from '../../state/editor'
import { view, type ViewState } from '../view'

// Drives the engine for the on-screen photo: sizes the canvas to the photo
// fitted in the stage (× zoom), keeps the drawing buffer within a pixel
// budget, and repaints at most once per animation frame on any change.

/** Most device pixels we render interactively (≈ 2560 × 2340). */
const PIXEL_BUDGET = 6e6
/** Don't reallocate the drawing buffer on every pinch frame; wait for the zoom to settle. */
const ZOOM_SETTLE_MS = 160
const HISTOGRAM_MS = 120

/** View fields that change what the canvas shows. */
const renderKey = (v: ViewState) => `${v.mode}|${v.split}|${v.holding}|${v.clipping}|${v.tool}|${v.zoom}|${maskOverlay(v)}`

/** What the engine draws on the main canvas: side by side shows the edit there (the original is copied to a second canvas). */
const engineView = (v: ViewState) => (v.holding ? 'before' : v.mode === 'side' ? 'after' : v.mode)

/** The local layer whose mask is tinted red, while masking with the overlay on. */
const maskOverlay = (v: ViewState) => (v.tool === 'mask' && v.overlay && v.layer) || undefined

let active: StageView | null = null

/** Toolbar / shortcut access to the mounted stage. */
export const stageControl = {
  attach: (s: StageView | null) => {
    active = s
  },
  toggleZoom: () => active?.toggleZoom(),
  /** Repaint (e.g. an AI result arrived for the recipe on screen). */
  request: () => active?.request(),
  /** The photo box and the stage (CSS px), to place new masks in the visible part of the photo. */
  layout: () => (active ? { box: active.box, stage: active.stageSize() } : null),
  zoomBy: (factor: number) => active?.zoomTo(view.get().zoom * factor),
  fit: () => active?.zoomTo(1),
}

export class StageView {
  private stageW = 0
  private stageH = 0
  private pad = 24
  private pan = { x: 0, y: 0 }
  /** Last layout: displayed photo size and position (CSS px, stage coordinates). */
  box = { x: 0, y: 0, w: 0, h: 0 }
  private raf = 0
  private histTimer: ReturnType<typeof setTimeout> | undefined
  private settleTimer: ReturnType<typeof setTimeout> | undefined
  private zoomedAt = 0
  private key = ''
  private unsubs: (() => void)[] = []
  /** Full-resolution pixels for true 100 %, loaded the first time it's needed. */
  private full: 'idle' | 'loading' | 'ready' | 'failed' = 'idle'
  private abort = new AbortController()
  /** The canvas shows only the visible window of the full-resolution result. */
  private region = false
  /** Side by side: the original's canvas, and what it was last drawn for. */
  private before: HTMLCanvasElement | null = null
  private beforeKey = ''

  private engine: Engine
  private photoEl: HTMLElement
  /** Full-resolution pixels per working pixel. */
  private fullScale: number
  private loadFull: ((signal: AbortSignal) => Promise<SourceImage>) | undefined

  constructor(engine: Engine, photoEl: HTMLElement, fullScale: number, loadFull?: (signal: AbortSignal) => Promise<SourceImage>) {
    this.engine = engine
    this.photoEl = photoEl
    this.fullScale = fullScale
    this.loadFull = loadFull
    let recipe = editor.getState().recipe
    this.key = renderKey(view.get())
    this.unsubs.push(
      editor.subscribe(() => {
        const r = editor.getState().recipe
        if (r !== recipe) {
          recipe = r
          this.request()
        }
      }),
      view.subscribe(() => {
        const k = renderKey(view.get())
        if (k !== this.key) {
          this.key = k
          this.request()
        }
      }),
      engine.onContextRestored(() => this.request()),
    )
  }

  setStage(width: number, height: number, pad: number) {
    this.stageW = width
    this.stageH = height
    this.pad = pad
    this.request()
  }

  stageSize() {
    return { w: this.stageW, h: this.stageH }
  }

  /** Side by side: where the original is drawn (null when the mode is off). */
  setBefore(canvas: HTMLCanvasElement | null) {
    this.before = canvas
    this.beforeKey = ''
    this.request()
  }

  /**
   * The area the photo is fitted into: the whole stage, or in side by side
   * the after pane — the right half, or the bottom half on a tall stage.
   */
  private pane() {
    const v = view.get()
    if (v.mode !== 'side' || v.tool === 'crop') return { x: 0, y: 0, w: this.stageW, h: this.stageH, dx: 0, dy: 0 }
    if (this.stageH > this.stageW * 1.1) return { x: 0, y: this.stageH / 2, w: this.stageW, h: this.stageH / 2, dx: 0, dy: this.stageH / 2 }
    return { x: this.stageW / 2, y: 0, w: this.stageW / 2, h: this.stageH, dx: this.stageW / 2, dy: 0 }
  }

  /** A point in the before pane acts on the same photo point in the after pane. */
  private anchor(ax: number, ay: number) {
    const p = this.pane()
    return { x: ax < p.x || ay < p.y ? ax + p.dx : ax, y: ax < p.x || ay < p.y ? ay + p.dy : ay, cx: p.x + p.w / 2, cy: p.y + p.h / 2 }
  }

  request() {
    if (!this.raf) this.raf = requestAnimationFrame(() => this.frame())
  }

  private zoomLimits() {
    const z100 = view.get().zoom100
    return { min: Math.min(1, z100), max: Math.max(2, z100 * 2) }
  }

  private clampPan(w: number, h: number) {
    const p = this.pane()
    const mx = Math.max(0, (w - p.w) / 2), my = Math.max(0, (h - p.h) / 2)
    this.pan.x = Math.min(mx, Math.max(-mx, this.pan.x))
    this.pan.y = Math.min(my, Math.max(-my, this.pan.y))
  }

  /** Zoom keeping the photo point under (ax, ay) — stage coordinates — in place. */
  zoomTo(z: number, ax?: number, ay?: number) {
    const v = view.get()
    if (v.tool === 'crop') return
    const { min, max } = this.zoomLimits()
    const next = Math.abs(z - 1) < 0.02 ? 1 : Math.min(max, Math.max(min, z))
    const k = next / v.zoom
    const a = this.anchor(ax ?? this.pane().x + this.pane().w / 2, ay ?? this.pane().y + this.pane().h / 2)
    this.pan.x = a.x - a.cx - (a.x - a.cx - this.pan.x) * k
    this.pan.y = a.y - a.cy - (a.y - a.cy - this.pan.y) * k
    if (next === 1) this.pan = { x: 0, y: 0 }
    this.zoomedAt = performance.now()
    view.set({ zoom: next })
    this.request()
  }

  /** Pinch: zoom from `z0`/`pan0` so the photo point that was under `a0` ends up under `a`. */
  pinch(z0: number, pan0: { x: number; y: number }, a0: { x: number; y: number }, z: number, a: { x: number; y: number }) {
    if (view.get().tool === 'crop') return
    const { min, max } = this.zoomLimits()
    const next = Math.min(max, Math.max(min, z))
    const k = next / z0
    const p0 = this.anchor(a0.x, a0.y), p = this.anchor(a.x, a.y)
    this.pan = { x: p.x - p.cx - (p0.x - p0.cx - pan0.x) * k, y: p.y - p.cy - (p0.y - p0.cy - pan0.y) * k }
    this.zoomedAt = performance.now()
    view.set({ zoom: next })
    this.request()
  }

  /** Fit ↔ 100% (or 2× fit when the photo is smaller than the screen). */
  toggleZoom(ax?: number, ay?: number) {
    const { zoom, zoom100 } = view.get()
    this.zoomTo(zoom !== 1 ? 1 : zoom100 > 1.05 ? zoom100 : 2, ax, ay)
  }

  panBy(dx: number, dy: number) {
    this.pan.x += dx
    this.pan.y += dy
    this.request()
  }

  getPan() {
    return { ...this.pan }
  }

  setPan(x: number, y: number) {
    this.pan = { x, y }
    this.request()
  }

  private frame() {
    this.raf = 0
    const r = editor.getState().recipe
    const v = view.get()
    if (!r || !this.engine.hasSource() || !this.stageW || !this.stageH) return
    const cropping = v.tool === 'crop'
    const out = this.engine.outputSize(r, { uncropped: cropping })
    if (!out.width || !out.height) return

    const pane = this.pane()
    const fit = Math.min((pane.w - 2 * this.pad) / out.width, (pane.h - 2 * this.pad) / out.height)
    const dpr = window.devicePixelRatio || 1
    const zoom100 = (out.width * this.fullScale) / (out.width * fit * dpr)
    if (Math.abs(zoom100 - v.zoom100) > 1e-6) view.set({ zoom100 })
    const z = cropping ? 1 : v.zoom
    const w = out.width * fit * z, h = out.height * fit * z
    this.clampPan(w, h)
    const x = pane.x + (pane.w - w) / 2 + this.pan.x, y = pane.y + (pane.h - h) / 2 + this.pan.y
    this.box = { x, y, w, h }
    const st = this.photoEl.style
    st.width = `${w}px`
    st.height = `${h}px`
    st.transform = `translate3d(${x}px, ${y}px, 0)`
    // Side by side: each pane shows only its half, however far it's zoomed.
    const sideBySide = pane.dx > 0 || pane.dy > 0
    st.clipPath = sideBySide ? `inset(${Math.max(0, pane.y - y)}px 0 0 ${Math.max(0, pane.x - x)}px)` : ''
    const stageEl = this.photoEl.parentElement
    if (stageEl) stageEl.dataset.side = sideBySide ? (pane.dy ? 'v' : 'h') : ''

    if (this.regionFrame(r, v, dpr)) return
    if (this.region) this.leaveRegion()
    // Device pixels, but no more than the working image has and within the budget.
    const bw = w * dpr, bh = h * dpr
    const k = Math.min(1, Math.sqrt(PIXEL_BUDGET / (bw * bh)), out.width / bw)
    const tw = Math.max(1, Math.round(bw * k)), th = Math.max(1, Math.round(bh * k))
    const canvas = this.engine.canvas
    if (tw !== canvas.width || th !== canvas.height) {
      const settling = performance.now() - this.zoomedAt < ZOOM_SETTLE_MS && tw * th > canvas.width * canvas.height
      if (settling) {
        clearTimeout(this.settleTimer)
        this.settleTimer = setTimeout(() => this.request(), ZOOM_SETTLE_MS)
      } else this.engine.resize(tw, th)
    }

    if (this.before && v.mode === 'side' && !cropping) this.drawBefore(r, x - pane.dx, y - pane.dy, w, h)
    this.engine.render(r, { view: engineView(v), split: v.split, showClipping: v.clipping, uncropped: cropping, maskOverlay: maskOverlay(v) })
    if (!v.holding && (v.mode === 'after' || v.mode === 'side') && !cropping) this.scheduleHistogram()
  }

  /** Side by side: render the original and copy it to the before pane, only when its size, place or framing changed. */
  private drawBefore(r: EditRecipe, x: number, y: number, w: number, h: number) {
    const b = this.before!
    const st = b.style
    st.width = `${w}px`
    st.height = `${h}px`
    st.transform = `translate3d(${x}px, ${y}px, 0)`
    const c = this.engine.canvas as HTMLCanvasElement
    const key = `${c.width}x${c.height}|${JSON.stringify(r.geometry)}|${r.profile}|${r.treatment}`
    if (key === this.beforeKey) return
    this.engine.render(r, { view: 'before' })
    if (b.width !== c.width || b.height !== c.height) {
      b.width = c.width
      b.height = c.height
    }
    // Right after drawing: the WebGL buffer is still there within this task.
    b.getContext('2d')?.drawImage(c, 0, 0)
    this.beforeKey = key
  }

  /**
   * True 100 %: at one photo pixel per device pixel or closer, draw just the
   * visible part of the photo from the full-resolution source, 1:1, and let
   * CSS scale it past 100 %. Not in split view, whose divider spans the whole photo.
   */
  private regionFrame(r: EditRecipe, v: ViewState, dpr: number): boolean {
    const e = this.engine
    if (!e.renderRegion || !e.regionOutputSize || !e.setFullSource || !this.loadFull || this.fullScale < 1.01) return false
    if (v.tool === 'crop' || v.mode === 'split' || v.mode === 'side' || v.zoom < v.zoom100 * 0.999) return false
    if (this.full !== 'ready') {
      this.requestFull()
      return false
    }
    const out = e.regionOutputSize(r)
    const b = this.box
    const s = (b.w * dpr) / out.width // device pixels per photo pixel
    if (s < 0.999) return false
    const x0 = Math.max(0, b.x), y0 = Math.max(0, b.y)
    const x1 = Math.min(this.stageW, b.x + b.w), y1 = Math.min(this.stageH, b.y + b.h)
    if (x1 <= x0 || y1 <= y0) return true
    const fx = Math.max(0, Math.floor(((x0 - b.x) * dpr) / s)), fy = Math.max(0, Math.floor(((y0 - b.y) * dpr) / s))
    const fw = Math.max(1, Math.min(out.width - fx, Math.ceil(((x1 - b.x) * dpr) / s) - fx))
    const fh = Math.max(1, Math.min(out.height - fy, Math.ceil(((y1 - b.y) * dpr) / s) - fy))
    const canvas = e.canvas as HTMLCanvasElement
    if (canvas.width !== fw || canvas.height !== fh) e.resize(fw, fh)
    const k = s / dpr // CSS px per photo pixel
    const cs = canvas.style
    cs.position = 'absolute'
    cs.left = `${fx * k}px`
    cs.top = `${fy * k}px`
    cs.width = `${fw * k}px`
    cs.height = `${fh * k}px`
    this.region = true
    e.renderRegion(r, fx, fy, { view: engineView(v), showClipping: v.clipping, maskOverlay: maskOverlay(v) })
    return true
  }

  /** Back to drawing the whole photo (the histogram keeps showing it meanwhile). */
  private leaveRegion() {
    this.region = false
    const cs = (this.engine.canvas as HTMLCanvasElement).style
    cs.position = cs.left = cs.top = cs.width = cs.height = ''
  }

  private requestFull() {
    if (this.full !== 'idle' || !this.loadFull) return
    this.full = 'loading'
    this.loadFull(this.abort.signal).then(
      (img) => {
        if (this.abort.signal.aborted) return
        this.engine.setFullSource?.(img)
        this.full = 'ready'
        this.request()
      },
      () => {
        this.full = 'failed'
      },
    )
  }

  private scheduleHistogram() {
    if (this.histTimer) return
    this.histTimer = setTimeout(() => {
      this.histTimer = undefined
      view.set({ histogram: this.engine.histogram() })
    }, HISTOGRAM_MS)
  }

  dispose() {
    this.abort.abort()
    if (this.region) this.leaveRegion()
    // The engine outlives the stage (layout switches); don't keep hundreds of MB around for it.
    if (this.full === 'ready') this.engine.setFullSource?.(null)
    cancelAnimationFrame(this.raf)
    clearTimeout(this.histTimer)
    clearTimeout(this.settleTimer)
    this.unsubs.forEach((u) => u())
  }
}
