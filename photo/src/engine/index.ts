// Public entry of the render engine: WebGL2, scene-referred float pipeline.
// See pipeline.ts for the stages and shaders.ts for the per-pixel math.

import type { Vec3 } from '../color/matrices'
import { tempTintFromMultipliers } from '../color/wb'
import { defaultRecipe } from '../edit/defaults'
import type { EditRecipe } from '../edit/types'
import { autoSettings } from './auto'
import { renderTiled } from './export'
import { frameSize, normalizedToSource, outputSize, outputToSource, type Size } from './geometry'
import { detectCaps, Gpu, type Target, type Texture } from './gl'
import { binHistogram } from './histogram'
import { areaDownscale, atmosphericLight, averagePixel, boxReduce, lowResSize, type FloatImage } from './image'
import { frameParams, toWorkingSpace, type FrameParams } from './params'
import { computeGuide, Luts, marginFor, renderFrame, scaleSource, StageCache, type Guide, type ScaledSource } from './pipeline'
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
  recipe: EditRecipe
  uncropped: boolean
  shown: 'after' | 'before'
  version: number
}

class WebGLEngine implements Engine {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas
  supported = false
  private gl: WebGL2RenderingContext | null = null
  private gpu: Gpu | null = null
  private luts: Luts | null = null
  private views: { after: StageCache; before: StageCache } | null = null
  private display: { after: Target | null; before: Target | null } = { after: null, before: null }
  private src: Source | null = null
  private pending: { img: SourceImage; color: SourceColor } | null = null
  private scaled: { ratio: number; s: ScaledSource } | null = null
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
      if (this.pending) this.setSource(this.pending.img, this.pending.color)
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
    this.guides.forEach((g) => {
      gpu.free(g.coef)
      gpu.free(g.haze)
    })
    this.guides.clear()
    this.views?.after.dispose()
    this.views?.before.dispose()
    this.src = null
    this.scaled = null
  }

  setSource(img: SourceImage, color: SourceColor): void {
    this.pending = { img, color }
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
    const key = JSON.stringify([p.keys.input, p.dehaze !== 0])
    let g = this.guides.get(key)
    if (g) return g
    // Keep the after and before guides; drop older ones.
    while (this.guides.size >= 2) {
      const [k0, old] = this.guides.entries().next().value!
      gpu.free(old.coef)
      gpu.free(old.haze)
      this.guides.delete(k0)
    }
    g = computeGuide(gpu, src.lowTex, p.input, toWorkingSpace(p.input, src.air), p.dehaze !== 0, key)
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
    const gpu = this.gpu, src = this.src
    if (!gpu || !src || !this.views || !this.luts || gpu.gl.isContextLost()) return
    const view = opts.view ?? 'after'
    const uncropped = !!opts.uncropped
    const size: Size = { width: src.img.width, height: src.img.height }
    const out = outputSize(size, recipe.geometry, uncropped)
    const cw = this.canvas.width, ch = this.canvas.height
    const fit = Math.min(cw / out.width, ch / out.height)
    // Process at the size the image is shown (never above the working size): fast when zoomed out.
    const scale = Math.min(1, fit)
    const proc = { width: Math.max(1, Math.min(cw, Math.round(out.width * scale))), height: Math.max(1, Math.min(ch, Math.round(out.height * scale))) }
    const scaled = this.scaledSource(scale)
    const fs = frameSize(size, recipe.geometry)
    const pixelScale = scale * (src.img.width / (src.img.fullWidth ?? src.img.width))
    const frameLong = Math.max(fs.width, fs.height) * scale
    const M = marginFor(pixelScale, frameLong)
    const toSource = outputToSource(size, recipe.geometry, uncropped, proc)

    const draw = (which: 'after' | 'before', r: EditRecipe) => {
      const params = frameParams(r, src.color)
      const guide = this.guideFor(params)
      let t = this.display[which]
      if (!t || t.width !== proc.width || t.height !== proc.height) {
        gpu.free(t)
        t = gpu.target(proc.width, proc.height, 'rgba16f', true)
        this.display[which] = t
      }
      renderFrame(gpu, this.views![which], this.luts!, {
        outSize: proc, toSource, fullSize: size, src: scaled, pixelScale, frameLong, output: this.output, guide,
        region: { x: -M, y: -M, w: proc.width + 2 * M, h: proc.height + 2 * M }, inner: { x: 0, y: 0, w: proc.width, h: proc.height },
        air: toWorkingSpace(params.input, src.air),
      }, params, t, { dither: false, clipping: !!opts.showClipping })
      return t
    }
    const after = view !== 'before' ? draw('after', recipe) : null
    const before = view !== 'after' ? draw('before', { ...src.before, geometry: recipe.geometry }) : null

    const rect = fit <= 1
      ? [Math.floor((cw - proc.width) / 2), Math.floor((ch - proc.height) / 2), proc.width, proc.height]
      : [(cw - out.width * fit) / 2, (ch - out.height * fit) / 2, out.width * fit, out.height * fit]
    const split = view === 'before' ? 2 : view === 'split' ? Math.min(1, Math.max(0, opts.split ?? 0.5)) : -1
    gpu.program('present', PRESENT).tex('u_after', (after ?? before)!, 0).tex('u_before', (before ?? after)!, 1)
      .f('u_rect', rect[0], rect[1], rect[2], rect[3]).f('u_split', split).f('u_canvasH', ch)
    gpu.draw(null, cw, ch)
    this.last = { recipe, uncropped, shown: view === 'before' ? 'before' : 'after', version: ++this.renders }
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

  samplePixel(nx: number, ny: number, radius = 3): Vec3 | null {
    const src = this.src
    if (!src) return null
    const g = this.last?.recipe.geometry ?? src.before.geometry
    const [x, y] = normalizedToSource(src.img, g, !!this.last?.uncropped, nx, ny)
    return averagePixel(src.img, x, y, radius)
  }

  auto(recipe: EditRecipe): ReturnType<Engine['auto']> {
    if (!this.src) return { basic: {} }
    return autoSettings(this.src.low, this.src.color, recipe)
  }

  async renderImage(recipe: EditRecipe, source: SourceImage, color: SourceColor, opts: ExportRenderOptions): Promise<RenderedImage> {
    if (!this.gpu || this.gpu.gl.isContextLost()) throw new Error('Rendering is unavailable (WebGL2 not supported or context lost)')
    return renderTiled(this.gpu, recipe, source, color, opts)
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
    this.restoreCbs.clear()
    this.gl?.getExtension('WEBGL_lose_context')?.loseContext()
    this.gl = null
  }
}
