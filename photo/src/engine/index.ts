// Public entry of the render engine: WebGL2, scene-referred float pipeline.
// See pipeline.ts for the stages and shaders.ts for the per-pixel math.

import type { Vec3 } from '../color/matrices'
import { tempTintFromMultipliers } from '../color/wb'
import { defaultRecipe } from '../edit/defaults'
import type { EditRecipe, RetouchSpot } from '../edit/types'
import { autoSettings } from './auto'
import { renderTiled } from './export'
import { applyAffine, frameSize, mapBounds, normalizedToSource, outputSize, outputToSource, type Size } from './geometry'
import { detectCaps, Gpu, type Target, type Texture } from './gl'
import { findHealSource, retouchWindow } from './heal'
import { binHistogram } from './histogram'
import { areaDownscale, atmosphericLight, averagePixel, boxReduce, lowResSize, type FloatImage } from './image'
import { frameParams, toWorkingSpace, type FrameParams } from './params'
import { computeGuide, Luts, marginFor, needsHaze, renderFrame, scaleSource, StageCache, type Frame, type Guide, type ScaledSource } from './pipeline'
import { applySpots } from './retouch'
import { DOWNSAMPLE, PRESENT } from './shaders'
import type { Engine, ExportRenderOptions, Histogram, RenderedImage, RenderOptions, SourceColor, SourceImage } from './types'

export type { Engine } from './types'

export function createEngine(canvas: HTMLCanvasElement | OffscreenCanvas): Engine {
  return new WebGLEngine(canvas)
}

interface Source {
  img: SourceImage
  color: SourceColor
  /** Integer texture of the (possibly box-reduced) image. */
  int: Texture
  k: number
  low: FloatImage
  lowTex: Texture
  /** Airlight in source space. */
  air: Vec3
  before: EditRecipe
}

interface LastRender {
  shown: 'after' | 'before'
  version: number
  /** Normalized position in the drawn frame → source image and pixel, for the eyedropper. */
  pick: (nx: number, ny: number) => { img: SourceImage; x: number; y: number }
}

type Views = { after: StageCache; before: StageCache }
/** A frame minus what depends on the recipe (guide, airlight) and the canvas (output space). */
type FrameBase = Omit<Frame, 'output' | 'guide' | 'air'>

class WebGLEngine implements Engine {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas
  supported = false
  private gl: WebGL2RenderingContext | null = null
  private gpu: Gpu | null = null
  private luts: Luts | null = null
  private views: Views | null = null
  /** Separate caches for the 100 % view, so switching zoom doesn't thrash the fit view's stages. */
  private regionViews: Views | null = null
  private display: { after: Target | null; before: Target | null } = { after: null, before: null }
  private src: Source | null = null
  private pending: { img: SourceImage; color: SourceColor } | null = null
  private scaled: { ratio: number; s: ScaledSource } | null = null
  private full: SourceImage | null = null
  /** The uploaded window of the full source for renderRegion, as is and retouched. */
  private window: { key: string; s: ScaledSource; r: ScaledSource } | null = null
  /** The scaled source with the recipe's heal / clone spots applied. */
  private retouched: { key: string; s: ScaledSource } | null = null
  private sourceVersion = 0
  private guides = new Map<string, Guide>()
  private output: 'srgb' | 'display-p3' = 'srgb'
  private last: LastRender | null = null
  private renders = 0
  private hist: { version: number; h: Histogram } | null = null
  private restoreCbs = new Set<() => void>()

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    this.canvas = canvas
    const attrs: WebGLContextAttributes = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' }
    this.gl = canvas.getContext('webgl2', attrs) as WebGL2RenderingContext | null
    if (!this.gl) return
    this.init()
    const target = canvas as EventTarget
    target.addEventListener('webglcontextlost', (e) => {
      e.preventDefault()
      this.drop()
    })
    target.addEventListener('webglcontextrestored', () => {
      this.init()
      const full = this.full
      if (this.pending) this.setSource(this.pending.img, this.pending.color)
      this.full = full
      this.restoreCbs.forEach((cb) => cb())
    })
  }

  private init() {
    const gl = this.gl!
    const caps = detectCaps(gl)
    this.supported = !!caps
    if (!caps) return
    this.gpu = new Gpu(gl, caps)
    this.luts = new Luts(this.gpu)
    this.views = { after: new StageCache(this.gpu), before: new StageCache(this.gpu) }
    this.regionViews = { after: new StageCache(this.gpu), before: new StageCache(this.gpu) }
    // Wide-gamut canvas where the display can show it.
    const wide = typeof matchMedia === 'function' && matchMedia('(color-gamut: p3)').matches
    if (wide && typeof HTMLCanvasElement !== 'undefined' && this.canvas instanceof HTMLCanvasElement && 'drawingBufferColorSpace' in gl) {
      gl.drawingBufferColorSpace = 'display-p3'
      this.output = 'display-p3'
    }
  }

  /** Forget every GL object (context lost: they're already gone). */
  private drop() {
    this.gpu = null
    this.luts = null
    this.views = null
    this.regionViews = null
    this.window = null
    this.retouched = null
    this.display = { after: null, before: null }
    this.src = null
    this.scaled = null
    this.guides.clear()
    this.hist = null
  }

  private freeSourceState() {
    const gpu = this.gpu
    if (!gpu) return
    if (this.src) {
      gpu.destroy(this.src.int)
      gpu.destroy(this.src.lowTex)
    }
    if (this.scaled) gpu.free(this.scaled.s.tex)
    this.freeWindow()
    if (this.retouched) gpu.free(this.retouched.s.tex)
    this.guides.forEach((g) => {
      gpu.free(g.coef)
      gpu.free(g.haze)
    })
    this.guides.clear()
    this.views?.after.dispose()
    this.views?.before.dispose()
    this.regionViews?.after.dispose()
    this.regionViews?.before.dispose()
    this.src = null
    this.scaled = null
    this.window = null
    this.retouched = null
  }

  private freeWindow() {
    if (!this.window) return
    this.gpu?.free(this.window.s.tex)
    if (this.window.r !== this.window.s) this.gpu?.free(this.window.r.tex)
    this.window = null
  }

  private retouch(s: ScaledSource, spots: RetouchSpot[] | undefined, full: Size): ScaledSource {
    if (!spots?.length) return s
    const key = JSON.stringify([s.id, spots])
    if (this.retouched?.key === key) return this.retouched.s
    if (this.retouched) this.gpu!.free(this.retouched.s.tex)
    this.retouched = { key, s: applySpots(this.gpu!, s, spots, full) }
    return this.retouched.s
  }

  setSource(img: SourceImage, color: SourceColor): void {
    this.pending = { img, color }
    this.full = null
    this.sourceVersion++
    const gpu = this.gpu
    if (!gpu) return
    this.freeSourceState()
    const k = Math.max(1, Math.ceil(Math.max(img.width, img.height) / gpu.caps.maxTexture))
    const r = boxReduce(img, k)
    const int = gpu.uploadRgb16(r.data, r.width, 0, 0, r.width, r.height)
    const ls = lowResSize(img.width, img.height)
    const low = areaDownscale(img, ls.width, ls.height)
    const lowTex = gpu.uploadFloat(low.data, low.width, low.height, 3)
    const raw = color.space === 'camera' && color.camXyz && color.shotMul
    const asShot = raw ? tempTintFromMultipliers(color.camXyz!, color.shotMul!) : undefined
    this.src = { img, color, int, k, low, lowTex, air: atmosphericLight(low), before: defaultRecipe(color.kind, asShot) }
    this.last = null
  }

  hasSource(): boolean {
    return !!this.src
  }

  outputSize(recipe: EditRecipe, opts?: { uncropped?: boolean }): { width: number; height: number } {
    const img = this.src?.img ?? this.pending?.img
    if (!img) return { width: 0, height: 0 }
    return outputSize(img, recipe.geometry, !!opts?.uncropped)
  }

  resize(width: number, height: number): void {
    this.canvas.width = Math.max(1, Math.round(width))
    this.canvas.height = Math.max(1, Math.round(height))
  }

  private guideFor(p: FrameParams): Guide {
    const src = this.src!, gpu = this.gpu!
    const haze = needsHaze(p)
    const key = JSON.stringify([p.keys.input, haze])
    let g = this.guides.get(key)
    if (g) return g
    // Keep the after and before guides; drop older ones.
    while (this.guides.size >= 2) {
      const [k0, old] = this.guides.entries().next().value!
      gpu.free(old.coef)
      gpu.free(old.haze)
      this.guides.delete(k0)
    }
    g = computeGuide(gpu, src.lowTex, p.input, toWorkingSpace(p.input, src.air), haze, key)
    this.guides.set(key, g)
    return g
  }

  private scaledSource(scale: number): ScaledSource {
    const src = this.src!, gpu = this.gpu!
    const ratio = scale * src.k
    if (this.scaled && Math.abs(this.scaled.ratio - ratio) < 1e-6) return this.scaled.s
    if (this.scaled) gpu.free(this.scaled.s.tex)
    const s = scaleSource(gpu, src.int, 0, 0, src.k, ratio, { x: 0, y: 0, w: Math.max(1, Math.ceil(src.int.width * ratio)), h: Math.max(1, Math.ceil(src.int.height * ratio)) })
    this.scaled = { ratio, s }
    return s
  }

  render(recipe: EditRecipe, opts: RenderOptions = {}): void {
    const t0 = performance.now() // PROBE
    try { this.render0(recipe, opts) } finally { this.gpu?.gl.readPixels(0, 0, 1, 1, this.gpu.gl.RGBA, this.gpu.gl.UNSIGNED_BYTE, new Uint8Array(4)); const g = globalThis as unknown as { __lumenProbe?: { n: number; ms: number[]; size: number[]; opts: string[] } }; g.__lumenProbe ??= { n: 0, ms: [], size: [], opts: [] }; g.__lumenProbe.n++; g.__lumenProbe.ms.push(Math.round(performance.now() - t0)); g.__lumenProbe.size = [this.canvas.width, this.canvas.height]; g.__lumenProbe.opts.push(JSON.stringify(opts)) } // PROBE
  }

  private render0(recipe: EditRecipe, opts: RenderOptions = {}): void {
    const src = this.src
    if (!this.ready() || !src) return
    const uncropped = !!opts.uncropped
    const size: Size = { width: src.img.width, height: src.img.height }
    const out = outputSize(size, recipe.geometry, uncropped)
    const cw = this.canvas.width, ch = this.canvas.height
    const fit = Math.min(cw / out.width, ch / out.height)
    // Process at the size the image is shown (never above the working size): fast when zoomed out.
    const scale = Math.min(1, fit)
    const proc = { width: Math.max(1, Math.min(cw, Math.round(out.width * scale))), height: Math.max(1, Math.min(ch, Math.round(out.height * scale))) }
    const fs = frameSize(size, recipe.geometry)
    const pixelScale = scale * (src.img.width / (src.img.fullWidth ?? src.img.width))
    const frameLong = Math.max(fs.width, fs.height) * scale
    const M = marginFor(pixelScale, frameLong)
    const plain = this.scaledSource(scale)
    const base: FrameBase = {
      outSize: proc, toSource: outputToSource(size, recipe.geometry, uncropped, proc), fullSize: size, src: this.retouch(plain, recipe.retouch, size), pixelScale, frameLong,
      region: { x: -M, y: -M, w: proc.width + 2 * M, h: proc.height + 2 * M }, inner: { x: 0, y: 0, w: proc.width, h: proc.height },
    }
    const rect = fit <= 1
      ? [Math.floor((cw - proc.width) / 2), Math.floor((ch - proc.height) / 2), proc.width, proc.height]
      : [(cw - out.width * fit) / 2, (ch - out.height * fit) / 2, out.width * fit, out.height * fit]
    this.draw(recipe, opts, base, plain, this.views!, rect, (nx, ny) => {
      const [x, y] = normalizedToSource(size, recipe.geometry, uncropped, nx, ny)
      return { img: src.img, x, y }
    })
  }

  setFullSource(img: SourceImage | null): void {
    this.full = img
    this.sourceVersion++
  }

  regionOutputSize(recipe: EditRecipe, opts?: { uncropped?: boolean }): { width: number; height: number } {
    const img = this.full ?? this.src?.img ?? this.pending?.img
    return img ? outputSize(img, recipe.geometry, !!opts?.uncropped) : { width: 0, height: 0 }
  }

  renderRegion(recipe: EditRecipe, x: number, y: number, opts: RenderOptions = {}): void {
    const src = this.src, gpu = this.gpu
    if (!this.ready() || !src || !gpu) return
    // Exactly one export tile, drawn to the canvas: same margins, same filters, same look.
    const img = this.full ?? src.img
    const size: Size = { width: img.width, height: img.height }
    const g = recipe.geometry, uncropped = !!opts.uncropped
    const out = outputSize(size, g, uncropped)
    const cw = this.canvas.width, ch = this.canvas.height
    const w = Math.min(cw, out.width), h = Math.min(ch, out.height)
    const x0 = Math.max(0, Math.min(out.width - w, Math.round(x))), y0 = Math.max(0, Math.min(out.height - h, Math.round(y)))
    const toSource = outputToSource(size, g, uncropped, out)
    const pixelScale = img.width / (img.fullWidth ?? img.width)
    const fs = frameSize(size, g)
    const M = marginFor(pixelScale, Math.max(fs.width, fs.height))
    const region = { x: x0 - M, y: y0 - M, w: w + 2 * M, h: h + 2 * M }
    const spots = recipe.retouch ?? []
    // The window also holds whatever the spots inside it copy from.
    const b = retouchWindow(spots, img.width, img.height, mapBounds(toSource, region.x, region.y, region.x + region.w, region.y + region.h))
    const ix0 = Math.max(0, Math.min(img.width - 1, Math.floor(b.x0) - 3)), iy0 = Math.max(0, Math.min(img.height - 1, Math.floor(b.y0) - 3))
    const ix1 = Math.max(ix0 + 1, Math.min(img.width, Math.ceil(b.x1) + 3)), iy1 = Math.max(iy0 + 1, Math.min(img.height, Math.ceil(b.y1) + 3))
    const key = JSON.stringify([this.sourceVersion, ix0, iy0, ix1, iy1, spots])
    if (this.window?.key !== key) {
      this.freeWindow()
      // Only the visible window is uploaded; panning re-uploads it, slider moves reuse it.
      const int = gpu.uploadRgb16(img.data, img.width, ix0, iy0, ix1 - ix0, iy1 - iy0)
      const plain = scaleSource(gpu, int, ix0, iy0, 1, 1, { x: ix0, y: iy0, w: ix1 - ix0, h: iy1 - iy0 })
      gpu.destroy(int)
      this.window = { key, s: plain, r: spots.length ? applySpots(gpu, plain, spots, size) : plain }
    }
    const base: FrameBase = { outSize: out, toSource, fullSize: size, src: this.window.r, pixelScale, frameLong: Math.max(fs.width, fs.height), region, inner: { x: x0, y: y0, w, h } }
    const rect = [Math.floor((cw - w) / 2), Math.floor((ch - h) / 2), w, h]
    this.draw(recipe, opts, base, this.window.s, this.regionViews!, rect, (nx, ny) => {
      const [sx, sy] = applyAffine(toSource, x0 + nx * w, y0 + ny * h)
      return { img, x: sx, y: sy }
    })
  }

  private ready(): boolean {
    return !!this.gpu && !!this.views && !!this.luts && !this.gpu.gl.isContextLost()
  }

  /** Render after / before (from the un-retouched `plain` source) for a frame and present them inside `rect`. */
  private draw(recipe: EditRecipe, opts: RenderOptions, base: FrameBase, plain: ScaledSource, views: Views, rect: number[], pick: LastRender['pick']) {
    const gpu = this.gpu!, src = this.src!
    const view = opts.view ?? 'after'
    const { w, h } = base.inner
    const one = (which: 'after' | 'before', r: EditRecipe) => {
      const params = frameParams(r, src.color)
      let t = this.display[which]
      if (!t || t.width !== w || t.height !== h) {
        gpu.free(t)
        t = gpu.target(w, h, 'rgba16f', true)
        this.display[which] = t
      }
      const frame: Frame = { ...base, src: which === 'after' ? base.src : plain, output: this.output, guide: this.guideFor(params), air: toWorkingSpace(params.input, src.air) }
      renderFrame(gpu, views[which], this.luts!, frame, params, t, { dither: false, clipping: !!opts.showClipping, overlay: which === 'after' ? opts.maskOverlay : undefined })
      return t
    }
    const after = view !== 'before' ? one('after', recipe) : null
    const before = view !== 'after' ? one('before', { ...src.before, geometry: recipe.geometry }) : null
    const split = view === 'before' ? 2 : view === 'split' ? Math.min(1, Math.max(0, opts.split ?? 0.5)) : -1
    gpu.program('present', PRESENT).tex('u_after', (after ?? before)!, 0).tex('u_before', (before ?? after)!, 1)
      .f('u_rect', rect[0], rect[1], rect[2], rect[3]).f('u_split', split).f('u_canvasH', this.canvas.height)
    gpu.draw(null, this.canvas.width, this.canvas.height)
    this.last = { shown: view === 'before' ? 'before' : 'after', version: ++this.renders, pick }
  }

  histogram(): Histogram | null {
    const gpu = this.gpu, last = this.last
    const t = last && this.display[last.shown]
    if (!gpu || !last || !t) return null
    if (this.hist?.version === last.version) return this.hist.h
    const s = Math.min(1, 256 / Math.max(t.width, t.height))
    const small = gpu.target(Math.max(1, Math.round(t.width * s)), Math.max(1, Math.round(t.height * s)), 'rgba8')
    gpu.program('downsample', DOWNSAMPLE).tex('u_src', t, 0).f('u_size', small.width, small.height)
    gpu.draw(small)
    const h = binHistogram(gpu.read(small) as Uint8Array)
    gpu.free(small)
    this.hist = { version: last.version, h }
    return h
  }

  /** `radius` is in pixels of the image sampled (the working source, or the full source after renderRegion). */
  samplePixel(nx: number, ny: number, radius = 3): Vec3 | null {
    const src = this.src
    if (!src) return null
    if (!this.last) {
      const [x, y] = normalizedToSource(src.img, src.before.geometry, false, nx, ny)
      return averagePixel(src.img, x, y, radius)
    }
    const p = this.last.pick(nx, ny)
    return averagePixel(p.img, p.x, p.y, radius)
  }

  auto(recipe: EditRecipe): ReturnType<Engine['auto']> {
    if (!this.src) return { basic: {} }
    return autoSettings(this.src.low, this.src.color, recipe)
  }

  async renderImage(recipe: EditRecipe, source: SourceImage, color: SourceColor, opts: ExportRenderOptions): Promise<RenderedImage> {
    if (!this.gpu || this.gpu.gl.isContextLost()) throw new Error('Rendering is unavailable (WebGL2 not supported or context lost)')
    return renderTiled(this.gpu, recipe, source, color, opts)
  }

  findHealSource(recipe: EditRecipe, x: number, y: number, r: number): { sx: number; sy: number } | null {
    const img = this.src?.img
    return img ? findHealSource(img, recipe.retouch ?? [], x, y, r) : null
  }

  onContextRestored(cb: () => void): () => void {
    this.restoreCbs.add(cb)
    return () => this.restoreCbs.delete(cb)
  }

  dispose(): void {
    const gpu = this.gpu
    if (gpu) {
      this.freeSourceState()
      gpu.free(this.display.after)
      gpu.free(this.display.before)
      this.luts?.dispose()
      gpu.dispose()
    }
    this.drop()
    this.pending = null
    this.full = null
    this.restoreCbs.clear()
    this.gl?.getExtension('WEBGL_lose_context')?.loseContext()
    this.gl = null
  }
}
