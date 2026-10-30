import type { Engine } from '../../engine/types'
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
const renderKey = (v: ViewState) => `${v.mode}|${v.split}|${v.holding}|${v.clipping}|${v.tool}|${v.zoom}`

let active: StageView | null = null

/** Toolbar / shortcut access to the mounted stage. */
export const stageControl = {
  attach: (s: StageView | null) => {
    active = s
  },
  toggleZoom: () => active?.toggleZoom(),
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

  private engine: Engine
  private photoEl: HTMLElement
  /** Full-resolution pixels per working pixel. */
  private fullScale: number

  constructor(engine: Engine, photoEl: HTMLElement, fullScale: number) {
    this.engine = engine
    this.photoEl = photoEl
    this.fullScale = fullScale
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

  request() {
    if (!this.raf) this.raf = requestAnimationFrame(() => this.frame())
  }

  private zoomLimits() {
    const z100 = view.get().zoom100
    return { min: Math.min(1, z100), max: Math.max(2, z100 * 2) }
  }

  private clampPan(w: number, h: number) {
    const mx = Math.max(0, (w - this.stageW) / 2), my = Math.max(0, (h - this.stageH) / 2)
    this.pan.x = Math.min(mx, Math.max(-mx, this.pan.x))
    this.pan.y = Math.min(my, Math.max(-my, this.pan.y))
  }

  /** Zoom keeping the photo point under (ax, ay) — stage coordinates — in place. */
  zoomTo(z: number, ax = this.stageW / 2, ay = this.stageH / 2) {
    const v = view.get()
    if (v.tool === 'crop') return
    const { min, max } = this.zoomLimits()
    const next = Math.abs(z - 1) < 0.02 ? 1 : Math.min(max, Math.max(min, z))
    const k = next / v.zoom
    this.pan.x = ax - this.stageW / 2 - (ax - this.stageW / 2 - this.pan.x) * k
    this.pan.y = ay - this.stageH / 2 - (ay - this.stageH / 2 - this.pan.y) * k
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
    const k = next / z0, cx = this.stageW / 2, cy = this.stageH / 2
    this.pan = { x: a.x - cx - (a0.x - cx - pan0.x) * k, y: a.y - cy - (a0.y - cy - pan0.y) * k }
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

    const fit = Math.min((this.stageW - 2 * this.pad) / out.width, (this.stageH - 2 * this.pad) / out.height)
    const dpr = window.devicePixelRatio || 1
    const zoom100 = (out.width * this.fullScale) / (out.width * fit * dpr)
    if (Math.abs(zoom100 - v.zoom100) > 1e-6) view.set({ zoom100 })
    const z = cropping ? 1 : v.zoom
    const w = out.width * fit * z, h = out.height * fit * z
    this.clampPan(w, h)
    const x = (this.stageW - w) / 2 + this.pan.x, y = (this.stageH - h) / 2 + this.pan.y
    this.box = { x, y, w, h }
    const st = this.photoEl.style
    st.width = `${w}px`
    st.height = `${h}px`
    st.transform = `translate3d(${x}px, ${y}px, 0)`

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

    this.engine.render(r, { view: v.holding ? 'before' : v.mode, split: v.split, showClipping: v.clipping, uncropped: cropping })
    if (!v.holding && v.mode === 'after' && !cropping) this.scheduleHistogram()
  }

  private scheduleHistogram() {
    if (this.histTimer) return
    this.histTimer = setTimeout(() => {
      this.histTimer = undefined
      view.set({ histogram: this.engine.histogram() })
    }, HISTOGRAM_MS)
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    clearTimeout(this.histTimer)
    clearTimeout(this.settleTimer)
    this.unsubs.forEach((u) => u())
  }
}
