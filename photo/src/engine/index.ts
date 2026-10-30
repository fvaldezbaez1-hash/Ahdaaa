// Public entry of the render engine: WebGL2, scene-referred float pipeline.
// See pipeline.ts for the stages and shaders.ts for the per-pixel math.

import type { Vec3 } from '../color/matrices'
import { tempTintFromMultipliers } from '../color/wb'
import { defaultRecipe } from '../edit/defaults'
import { spotsOf } from '../edit/retouch'
import type { AiDenoise, EditRecipe, Retouch } from '../edit/types'
import { autoSettings } from './auto'
import { renderTiled } from './export'
import { applyAffine, frameSize, mapBounds, normalizedToSource, outputSize, outputToSource, type Size } from './geometry'
import { detectCaps, Gpu, type Target, type Texture } from './gl'
import { findHealSource, retouchWindow } from './heal'
import { binHistogram } from './histogram'
import { areaDownscale, atmosphericLight, averagePixel, boxReduce, lowResSize, resizeArea16, type FloatImage } from './image'
import { frameParams, toWorkingSpace, type FrameParams } from './params'
import { aiMargin, computeGuide, Luts, marginFor, needsHaze, renderFrame, scaleSource, StageCache, type DevelopedSampler, type Frame, type Guide, type ScaledSource } from './pipeline'
import { RasterStore } from './rasters'
import { applyRetouch, blendDenoised, rasterAsSource } from './retouch'
import { DOWNSAMPLE, PRESENT } from './shaders'
import type { Engine, ExportRenderOptions, Histogram, RasterImage, RenderedImage, RenderOptions, SampleOptions, SourceColor, SourceImage } from './types'

export type { Engine } from './types'

/** Guides kept per engine (each ≤ 512 px, a few MB). */
const GUIDE_CACHE = 16

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
  /** The 'after' frame's developed (pre-layer) image, and where the frame sits in output px. */
  developed: DevelopedSampler | null
  inner: { x: number; y: number; w: number; h: number }
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
  /** The scaled source with the recipe's spots and removals applied. */
  private retouched: { key: string; s: ScaledSource } | null = null
  /** AI results by id: kept on the CPU (they survive a lost context), uploaded by `rasters` when used. */
  private rasterImages = new Map<string, RasterImage>()
  private rasters: RasterStore | null = null
  /** AI denoise: the denoised raster at the working size (GPU), scaled like the source, and blended. */
  private denoised: { key: string; int: Texture } | null = null
  private denoisedScaled: { key: string; s: ScaledSource } | null = null
  private blended: { key: string; s: ScaledSource } | null = null
  /** The denoised raster resized to the full source (CPU), for the 100 % view. */
  private denoisedFull: { key: string; img: SourceImage } | null = null
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
    this.rasters = new RasterStore(this.gpu, this.rasterImages)
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
    this.rasters = null
    this.denoised = this.denoisedScaled = this.blended = null
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
    this.freeDenoise()
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

  private freeDenoise() {
    const gpu = this.gpu
    if (this.denoised) gpu?.destroy(this.denoised.int)
    if (this.denoisedScaled) gpu?.free(this.denoisedScaled.s.tex)
    if (this.blended) gpu?.free(this.blended.s.tex)
    this.denoised = this.denoisedScaled = this.blended = null
  }

  /** Cache key part for the retouch list: the items, and the version of each removal's fill. */
  private retouchKey(items: readonly Retouch[]) {
    return JSON.stringify([items, items.map((i) => (i.mode === 'remove' ? this.rasters!.version(i.fill) : 0))])
  }

  private retouch(s: ScaledSource, items: readonly Retouch[] | undefined, full: Size): ScaledSource {
    if (!items?.length) return s
    const key = JSON.stringify([s.id, this.retouchKey(items)])
    if (this.retouched?.key === key) return this.retouched.s
    if (this.retouched) this.gpu!.free(this.retouched.s.tex)
    this.retouched = { key, s: applyRetouch(this.gpu!, s, items, full, this.rasters!) }
    return this.retouched.s
  }

  /** The working source mixed with its AI-denoised copy (`plain` itself when there's none). */
  private denoise(plain: ScaledSource, ratio: number, dn: AiDenoise | undefined): ScaledSource {
    const raster = dn && dn.amount > 0 ? this.rasters!.image(dn.raster) : null
    if (!dn || !raster || raster.channels !== 3) return plain
    const src = this.src!, gpu = this.gpu!
    const k1 = JSON.stringify([this.sourceVersion, dn.raster, this.rasters!.version(dn.raster)])
    if (this.denoised?.key !== k1) {
      this.freeDenoise()
      const r = boxReduce(resizeArea16(rasterAsSource(raster), src.img.width, src.img.height), src.k)
      this.denoised = { key: k1, int: gpu.uploadRgb16(r.data, r.width, 0, 0, r.width, r.height) }
    }
    const k2 = JSON.stringify([k1, ratio])
    if (this.denoisedScaled?.key !== k2) {
      if (this.denoisedScaled) gpu.free(this.denoisedScaled.s.tex)
      this.denoisedScaled = { key: k2, s: scaleSource(gpu, this.denoised.int, 0, 0, src.k, ratio, { x: 0, y: 0, w: plain.tex.width, h: plain.tex.height }) }
    }
    const k3 = JSON.stringify([plain.id, this.denoisedScaled.s.id, dn.amount])
    if (this.blended?.key !== k3) {
      if (this.blended) gpu.free(this.blended.s.tex)
      this.blended = { key: k3, s: blendDenoised(gpu, plain, this.denoisedScaled.s, dn.amount / 100) }
    }
    return this.blended.s
  }

  /** The denoised raster at the size of `img` (the full source, for the 100 % view), or null. */
  private denoisedFor(img: SourceImage, dn: AiDenoise | undefined): SourceImage | null {
    const raster = dn && dn.amount > 0 ? this.rasters!.image(dn.raster) : null
    if (!dn || !raster || raster.channels !== 3) return null
    const key = JSON.stringify([this.sourceVersion, dn.raster, this.rasters!.version(dn.raster), img.width, img.height])
    if (this.denoisedFull?.key !== key) this.denoisedFull = { key, img: resizeArea16(rasterAsSource(raster), img.width, img.height) }
    return this.denoisedFull.img
  }

  setRaster(id: string, img: RasterImage | null): void {
    if (img) this.rasterImages.set(id, img)
    else this.rasterImages.delete(id)
    this.rasters?.set(id, img)
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
    if (g) {
      this.guides.delete(key)
      this.guides.set(key, g)
      return g
    }
    // A few per white balance (after, before, the looks a preview engine cycles through); drop the oldest.
    while (this.guides.size >= GUIDE_CACHE) {
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
    const M = marginFor(pixelScale, frameLong) + aiMargin(recipe.layers ?? [], this.rasters!, size, scale)
    const plain = this.scaledSource(scale)
    const photo = this.retouch(this.denoise(plain, scale * src.k, recipe.denoise), recipe.retouch, size)
    const base: FrameBase = {
      outSize: proc, toSource: outputToSource(size, recipe.geometry, uncropped, proc), fullSize: size, src: photo, pixelScale, frameLong,
      region: { x: -M, y: -M, w: proc.width + 2 * M, h: proc.height + 2 * M }, inner: { x: 0, y: 0, w: proc.width, h: proc.height }, rasters: this.rasters!,
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
    const M = marginFor(pixelScale, Math.max(fs.width, fs.height)) + aiMargin(recipe.layers ?? [], this.rasters!, size, 1)
    const region = { x: x0 - M, y: y0 - M, w: w + 2 * M, h: h + 2 * M }
    const items = recipe.retouch ?? []
    // The window also holds whatever the retouching inside it reads.
    const b = retouchWindow(items, img.width, img.height, mapBounds(toSource, region.x, region.y, region.x + region.w, region.y + region.h))
    const ix0 = Math.max(0, Math.min(img.width - 1, Math.floor(b.x0) - 3)), iy0 = Math.max(0, Math.min(img.height - 1, Math.floor(b.y0) - 3))
    const ix1 = Math.max(ix0 + 1, Math.min(img.width, Math.ceil(b.x1) + 3)), iy1 = Math.max(iy0 + 1, Math.min(img.height, Math.ceil(b.y1) + 3))
    const den = this.denoisedFor(img, recipe.denoise)
    const key = JSON.stringify([this.sourceVersion, ix0, iy0, ix1, iy1, this.retouchKey(items), den ? [recipe.denoise, this.denoisedFull?.key] : 0])
    if (this.window?.key !== key) {
      this.freeWindow()
      // Only the visible window is uploaded; panning re-uploads it, slider moves reuse it.
      const upload = (from: SourceImage) => {
        const int = gpu.uploadRgb16(from.data, from.width, ix0, iy0, ix1 - ix0, iy1 - iy0)
        const s = scaleSource(gpu, int, ix0, iy0, 1, 1, { x: ix0, y: iy0, w: ix1 - ix0, h: iy1 - iy0 })
        gpu.destroy(int)
        return s
      }
      const plain = upload(img)
      let photo = plain
      if (den) {
        const d = upload(den)
        photo = blendDenoised(gpu, plain, d, recipe.denoise!.amount / 100)
        gpu.free(d.tex)
      }
      if (items.length) {
        const r = applyRetouch(gpu, photo, items, size, this.rasters!)
        if (photo !== plain) gpu.free(photo.tex)
        photo = r
      }
      this.window = { key, s: plain, r: photo }
    }
    const base: FrameBase = { outSize: out, toSource, fullSize: size, src: this.window.r, pixelScale, frameLong: Math.max(fs.width, fs.height), region, inner: { x: x0, y: y0, w, h }, rasters: this.rasters! }
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
    const one = (which: 'after' | 'before', r: EditRecipe, keep?: (d: DevelopedSampler) => void) => {
      const params = frameParams(r, src.color)
      let t = this.display[which]
      if (!t || t.width !== w || t.height !== h) {
        gpu.free(t)
        t = gpu.target(w, h, 'rgba16f', true)
        this.display[which] = t
      }
      const frame: Frame = { ...base, src: which === 'after' ? base.src : plain, output: this.output, guide: this.guideFor(params), air: toWorkingSpace(params.input, src.air) }
      keep?.(renderFrame(gpu, views[which], this.luts!, frame, params, t, { dither: false, clipping: !!opts.showClipping, overlay: which === 'after' ? opts.maskOverlay : undefined }))
      return t
    }
    let developed: DevelopedSampler | null = null
    const after = view !== 'before' ? one('after', recipe, (d) => (developed = d)) : null
    const before = view !== 'after' ? one('before', { ...src.before, geometry: recipe.geometry }) : null
    const split = view === 'before' ? 2 : view === 'split' ? Math.min(1, Math.max(0, opts.split ?? 0.5)) : -1
    gpu.program('present', PRESENT).tex('u_after', (after ?? before)!, 0).tex('u_before', (before ?? after)!, 1)
      .f('u_rect', rect[0], rect[1], rect[2], rect[3]).f('u_split', split).f('u_canvasH', this.canvas.height)
    gpu.draw(null, this.canvas.width, this.canvas.height)
    this.last = { shown: view === 'before' ? 'before' : 'after', version: ++this.renders, pick, developed, inner: base.inner }
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
  samplePixel(nx: number, ny: number, radius = 3, opts?: SampleOptions): Vec3 | null {
    const src = this.src
    if (!src) return null
    if (opts?.developed) {
      const l = this.last
      if (!l?.developed || !this.ready()) return null
      return l.developed(l.inner.x + nx * l.inner.w, l.inner.y + ny * l.inner.h, radius)
    }
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
    return img ? findHealSource(img, spotsOf(recipe.retouch), x, y, r) : null
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
      this.rasters?.dispose()
      gpu.dispose()
    }
    this.drop()
    this.pending = null
    this.full = null
    this.rasterImages.clear()
    this.denoisedFull = null
    this.restoreCbs.clear()
    this.gl?.getExtension('WEBGL_lose_context')?.loseContext()
    this.gl = null
  }
}
