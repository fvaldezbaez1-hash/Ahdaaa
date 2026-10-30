// The render pipeline for one region of the output (the whole frame when
// interactive, one tile + margin when exporting). Stages are cached by key so
// a slider only re-runs what it affects:
//
//   scaled source ─ develop ─ denoise ─ fine blur ─ tone/color ─ sharpen blur ─ finish
//   low-res copy ── guide (guided-filter coefficients, dehaze transmission) ──┘

import type { Vec3 } from '../color/matrices'
import { REC2020_TO_P3, REC2020_TO_SRGB } from '../color/matrices'
import { applyAffine, type Affine, type Size } from './geometry'
import type { Gpu, Program, Target, Texture } from './gl'
import { GUIDE_LONG_EDGE } from './image'
import { WB_TEMP, WB_TINT, type FrameParams, type InputTransform } from './params'
import { layerMasks, localParams } from './local'
import { activeLayers, drawableMasks, layerUsage } from './masks'
import { BLUR, BOX, CHROMA_BLUR, CONVERT, DENOISE, DEVELOP, FINISH, GF_COEF, GUIDE_IN, HALF, MIN_FILTER, RESAMPLE, TONE } from './shaders'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Source pixels on the GPU at the processing scale, covering a window of the source. */
export interface ScaledSource {
  tex: Target
  /** Scaled px of texel (0, 0). */
  x0: number
  y0: number
  /** Scaled px per full-resolution source px. */
  scale: number
  id: number
}

let nextId = 1
export const newSourceId = () => nextId++

function setDevelop(p: Program, t: InputTransform) {
  p.f('u_wbMul', ...t.wbMul).m3('u_pre', t.pre).b('u_raw', t.raw)
}

/**
 * Integer source window (reduced by k, its texel 0 at reduced px (ix, iy)) → float
 * texture at `ratio` scaled px per reduced px, covering scaled px `rect`.
 */
export function scaleSource(gpu: Gpu, int: Texture, ix: number, iy: number, k: number, ratio: number, rect: Rect): ScaledSource {
  if (ratio >= 0.9999) {
    const t = gpu.target(int.width, int.height, 'rgba16f')
    gpu.program('convert', CONVERT).tex('u_src', int, 0)
    gpu.draw(t)
    return { tex: t, x0: ix, y0: iy, scale: 1 / k, id: nextId++ }
  }
  const h = gpu.target(rect.w, int.height, 'rgba16f')
  gpu.program('resampleInt', () => RESAMPLE(true)).tex('u_src', int, 0).i('u_srcSize', int.width, int.height).i('u_axis', 0)
    .f('u_ratio', ratio).f('u_outOrigin', rect.x).f('u_inOrigin', ix)
  gpu.draw(h)
  const v = gpu.target(rect.w, rect.h, 'rgba16f')
  gpu.program('resample', () => RESAMPLE(false)).tex('u_src', h, 0).i('u_srcSize', h.width, h.height).i('u_axis', 1)
    .f('u_ratio', ratio).f('u_outOrigin', rect.y).f('u_inOrigin', iy)
  gpu.draw(v)
  gpu.free(h)
  return { tex: v, x0: rect.x, y0: rect.y, scale: ratio / k, id: nextId++ }
}

export interface Guide {
  /** (a, b) of the coarse and mid self-guided filters on centered log2 luminance. */
  coef: Target
  /** (a, b) of the transmission estimate for dehaze, or null. */
  haze: Target | null
  key: string
}

/** Guided filters on the low-res copy (whole source), shared by preview and export so both match. */
export function computeGuide(gpu: Gpu, low: Texture, input: InputTransform, air: Vec3, withHaze: boolean, key: string): Guide {
  const { width: W, height: H } = low
  const s = Math.max(W, H) / GUIDE_LONG_EDGE
  const r = (x: number) => Math.max(1, Math.round(x * s))
  const rc = r(23), rm = r(6)
  const t0 = gpu.target(W, H, 'rgba32f')
  const pin = gpu.program('guideIn', GUIDE_IN)
  setDevelop(pin, input)
  pin.m3('u_toWorking', input.toWorking).f('u_air', ...air).tex('u_src', low, 0)
  gpu.draw(t0)

  const box = (src: Target, mode: number, rad: number[], dir: [number, number], last = false) => {
    const t = gpu.target(W, H, last ? 'rgba16f' : 'rgba32f', last)
    gpu.program('box', BOX).tex('u_src', src, 0).i('u_dir', ...dir).f('u_radius', ...rad).i('u_mode', mode)
    gpu.draw(t)
    gpu.free(src === t0 ? null : src)
    return t
  }
  const coefOf = (stats: Target, mode: number, eps: [number, number]) => {
    const t = gpu.target(W, H, 'rgba32f')
    gpu.program('gfCoef', GF_COEF).tex('u_src', stats, 0).i('u_mode', mode).f('u_eps', ...eps)
    gpu.draw(t)
    gpu.free(stats)
    return t
  }
  const r4 = [rc, rc, rm, rm]
  // eps in stops²: smaller keeps more edges in the base (fewer halos), larger keeps more texture as detail.
  const stats = box(box(t0, 1, r4, [1, 0]), 0, r4, [0, 1])
  const coef = box(box(coefOf(stats, 0, [0.2, 0.25]), 0, r4, [1, 0]), 0, r4, [0, 1], true)

  let haze: Target | null = null
  if (withHaze) {
    const rmin = r(4), rt = r(15), rt4 = [rt, rt, rt, rt]
    const m1 = gpu.target(W, H, 'rgba32f')
    gpu.program('minFilter', MIN_FILTER).tex('u_src', t0, 0).i('u_dir', 1, 0).i('u_radius', rmin)
    gpu.draw(m1)
    const m2 = gpu.target(W, H, 'rgba32f')
    gpu.program('minFilter', MIN_FILTER).tex('u_src', m1, 0).i('u_dir', 0, 1).i('u_radius', rmin)
    gpu.draw(m2)
    gpu.free(m1)
    const hs = box(box(m2, 2, rt4, [1, 0]), 0, rt4, [0, 1])
    haze = box(box(coefOf(hs, 1, [0.01, 0]), 0, rt4, [1, 0]), 0, rt4, [0, 1], true)
  }
  gpu.free(t0)
  return { coef, haze, key }
}

/** What to render: the region of the output frame and how it maps to the source. */
export interface Frame {
  /** Output frame size at processing resolution. */
  outSize: Size
  /** Output px → full-resolution source px. */
  toSource: Affine
  fullSize: Size
  src: ScaledSource
  /** Output px covered by the region textures (inner + margin). */
  region: Rect
  /** Output px the finish pass writes. */
  inner: Rect
  /** Processing px per original (full-resolution) px — scales pixel-sized effects. */
  pixelScale: number
  /** Long edge of the uncropped frame in processing px — scales "texture" so it doesn't depend on crop. */
  frameLong: number
  output: 'srgb' | 'display-p3'
  guide: Guide
  /** Airlight in working space. */
  air: Vec3
}

/** Pixel-size-dependent filter settings. */
export function detailSettings(p: FrameParams, ps: number, frameLong: number) {
  const d = p.detail
  const sigmaS = (0.7 + (d.noise / 100) * 1.8) * ps
  const sigmaC = (1 + (d.colorNoise / 100) * 7) * ps * 0.5
  const fine = Math.max(0.6, 0.0011 * frameLong)
  const sharpSigma = Math.max(0.5, d.radius * ps)
  return {
    luma: d.noise > 0 && sigmaS >= 0.35,
    sigmaS,
    radiusS: Math.min(5, Math.max(1, Math.ceil(2 * sigmaS))),
    sigmaR: Math.max(1e-3, (d.noise / 100) * 0.05 * (1.3 - (d.noiseDetail / 100) * 0.8)),
    lumaMix: Math.min(1, d.noise / 30),
    chroma: d.colorNoise > 0,
    sigmaC,
    radiusC: Math.min(16, Math.max(1, Math.ceil(2.5 * sigmaC))),
    chromaMix: Math.min(1, d.colorNoise / 20),
    fine,
    fineRadius: Math.ceil(3 * fine),
    sharpen: d.sharpen > 0,
    sharpSigma,
    sharpRadius: Math.ceil(3 * sharpSigma),
    // Sharpening finer than a processing pixel can't be shown; fade it like the downscaled export would.
    sharpAmount: (d.sharpen / 100) * 1.1 * Math.sqrt(Math.min(1, (d.radius * ps) / 0.5)),
    sharpHalo: 0.02 + (d.detail / 100) * 0.3,
    mask: d.masking > 0 ? [(d.masking / 100) * 0.04, (d.masking / 100) * 0.04 + 0.02] : [0, 0],
  }
}

/** Margin (px) the neighborhood passes need around a region, for the largest slider values. */
export function marginFor(ps: number, frameLong: number): number {
  const fine = Math.max(0.6, 0.0011 * frameLong)
  return Math.min(5, Math.ceil(5 * ps)) + 2 * Math.min(16, Math.ceil(10 * ps)) + 2 + Math.ceil(3 * fine) + Math.ceil(9 * Math.max(ps, 0.17)) + 6
}

/** Lookup-table textures, re-uploaded only when their content changes. */
export class Luts {
  private gpu: Gpu
  tone: Texture | null = null
  hue: Texture | null = null
  curve: Texture | null = null
  private keys = { tone: '', hue: '', curve: '' }

  constructor(gpu: Gpu) {
    this.gpu = gpu
  }

  update(p: FrameParams) {
    if (this.keys.tone !== p.keys.tone) {
      this.tone = this.gpu.uploadFloat(p.toneLut, p.toneLut.length, 1, 1, this.tone ?? undefined)
      this.keys.tone = p.keys.tone
    }
    if (p.hueLut && this.keys.hue !== p.keys.hue) {
      this.hue = this.gpu.uploadFloat(p.hueLut, p.hueLut.length / 4, 1, 4, this.hue ?? undefined)
      this.keys.hue = p.keys.hue
    }
    if (p.curveLut && this.keys.curve !== p.keys.curve) {
      this.curve = this.gpu.uploadFloat(p.curveLut, p.curveLut.length / 4, 1, 4, this.curve ?? undefined)
      this.keys.curve = p.keys.curve
    }
  }

  dispose() {
    ;[this.tone, this.hue, this.curve].forEach((t) => this.gpu.destroy(t))
    this.tone = this.hue = this.curve = null
  }
}

interface Stage {
  key: string
  target: Target
  version: number
}

/**
 * Pixels of results kept per stage: a big view keeps its last result, small previews cycling
 * through many looks keep one per look (up to 32).
 */
const STAGE_BUDGET = 4_000_000

/** Cached stage outputs for one view (after / before) or one export. */
export class StageCache {
  private gpu: Gpu
  // Most recently used first. Big regions keep one result per stage, small ones a few.
  private stages = new Map<string, Stage[]>()
  private version = 0

  constructor(gpu: Gpu) {
    this.gpu = gpu
  }

  run(name: string, key: string, w: number, h: number, format: 'rgba16f' | 'r16f', linear: boolean, draw: (t: Target) => void): Stage {
    const list = this.stages.get(name) ?? []
    const i = list.findIndex((s) => s.key === key && s.target.width === w && s.target.height === h)
    if (i >= 0) {
      const hit = list.splice(i, 1)[0]
      list.unshift(hit)
      return hit
    }
    const keep = Math.max(1, Math.min(32, Math.floor(STAGE_BUDGET / (w * h))))
    while (list.length >= keep) this.gpu.free(list.pop()!.target)
    const target = this.gpu.target(w, h, format, linear)
    draw(target)
    const stage = { key, target, version: ++this.version }
    list.unshift(stage)
    this.stages.set(name, list)
    return stage
  }

  private multis = new Map<string, { key: string; targets: Target[]; fbo: WebGLFramebuffer; version: number }>()

  /** Like run, for a pass writing `count` RGBA16F targets at once. */
  runMulti(name: string, key: string, w: number, h: number, count: number, draw: (fbo: WebGLFramebuffer) => void) {
    const s = this.multis.get(name)
    const fits = s && s.targets[0].width === w && s.targets[0].height === h
    if (s && fits && s.key === key) return s
    let targets: Target[], fbo: WebGLFramebuffer
    if (s && fits) ({ targets, fbo } = s)
    else {
      if (s) this.dropMulti(s)
      targets = Array.from({ length: count }, () => this.gpu.target(w, h, 'rgba16f'))
      fbo = this.gpu.multi(targets)
    }
    draw(fbo)
    const stage = { key, targets, fbo, version: ++this.version }
    this.multis.set(name, stage)
    return stage
  }

  private dropMulti(s: { targets: Target[]; fbo: WebGLFramebuffer }) {
    s.targets.forEach((t) => this.gpu.free(t))
    this.gpu.gl.deleteFramebuffer(s.fbo)
  }

  /** Free stages named `prefix…` that aren't in `keep` (e.g. masks of deleted layers). */
  prune(prefix: string, keep: Set<string>) {
    for (const [name, list] of this.stages)
      if (name.startsWith(prefix) && !keep.has(name)) {
        list.forEach((s) => this.gpu.free(s.target))
        this.stages.delete(name)
      }
  }

  dispose() {
    this.stages.forEach((list) => list.forEach((s) => this.gpu.free(s.target)))
    this.stages.clear()
    this.multis.forEach((s) => this.dropMulti(s))
    this.multis.clear()
  }
}

/** True when output pixel centers land exactly on source texel centers (no resampling needed). */
function pixelExact(m: Affine): boolean {
  const pts = [applyAffine(m, 0.5, 0.5), applyAffine(m, 1.5, 0.5), applyAffine(m, 0.5, 1.5)]
  const onCenter = pts.every(([x, y]) => Math.abs(x - 0.5 - Math.round(x - 0.5)) < 1e-4 && Math.abs(y - 0.5 - Math.round(y - 0.5)) < 1e-4)
  const step = (a: number[], b: number[]) => Math.abs(Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]) - 1) < 1e-4
  return onCenter && step(pts[0], pts[1]) && step(pts[0], pts[2])
}

export interface FinishOptions {
  dither: boolean
  clipping: boolean
  /** Id of the layer whose mask is tinted red. */
  overlay?: string
}

/** Dehaze needs the transmission estimate: globally or in any layer. */
export function needsHaze(p: FrameParams): boolean {
  return p.dehaze !== 0 || layerUsage(activeLayers(p.layers))[8]
}

/** Mean display-encoded color around an output pixel (x, y) of the photo as developed before local layers. */
export type DevelopedSampler = (x: number, y: number, radius: number) => Vec3 | null

/**
 * Render `frame` with `params` into `out` (size = frame.inner, display-encoded). Returns a
 * sampler of the developed (pre-layer) image, valid until the next render with this cache.
 */
export function renderFrame(gpu: Gpu, cache: StageCache, luts: Luts, frame: Frame, params: FrameParams, out: Target, opts: FinishOptions): DevelopedSampler {
  const { region, src } = frame
  const W = region.w, H = region.h
  const ds = detailSettings(params, frame.pixelScale, frame.frameLong)
  const inp = params.input

  const dev = cache.run('develop', JSON.stringify([region, frame.toSource, src.id, params.keys.input]), W, H, 'rgba16f', false, (t) => {
    const p = gpu.program('develop', DEVELOP)
    setDevelop(p, inp)
    // Output px → scaled-source px, to decide whether a plain fetch is exact.
    const m = frame.toSource
    const toScaled: Affine = [m[0] * src.scale, m[1] * src.scale, m[2] * src.scale - src.x0, m[3] * src.scale, m[4] * src.scale, m[5] * src.scale - src.y0]
    const shifted: Affine = [toScaled[0], toScaled[1], toScaled[2] + toScaled[0] * region.x + toScaled[1] * region.y, toScaled[3], toScaled[4], toScaled[5] + toScaled[3] * region.x + toScaled[4] * region.y]
    p.tex('u_src', src.tex, 0).i('u_srcSize', src.tex.width, src.tex.height).f('u_srcOrigin', src.x0, src.y0).f('u_scale', src.scale)
      .f('u_fullSize', frame.fullSize.width, frame.fullSize.height).m3('u_toSource', [m[0], m[1], m[2], m[3], m[4], m[5], 0, 0, 1])
      .f('u_regionOrigin', region.x, region.y).b('u_exact', pixelExact(shifted))
    gpu.draw(t)
  })

  let scene = dev
  if (ds.luma || ds.chroma) {
    const nrKey = JSON.stringify([dev.version, ds.luma, ds.sigmaS, ds.sigmaR, ds.chroma, ds.sigmaC, ds.lumaMix, ds.chromaMix])
    scene = cache.run('denoise', nrKey, W, H, 'rgba16f', false, (t) => {
      let chroma: Target | null = null
      if (ds.chroma) {
        const hw = Math.ceil(W / 2), hh = Math.ceil(H / 2)
        const half = gpu.target(hw, hh, 'rgba16f')
        gpu.program('half', HALF).tex('u_src', dev.target, 0)
        gpu.draw(half)
        const blur = (s: Target, dir: [number, number], linear: boolean) => {
          const o = gpu.target(hw, hh, 'rgba16f', linear)
          gpu.program('chromaBlur', CHROMA_BLUR).tex('u_src', s, 0).i('u_dir', ...dir).f('u_sigma', ds.sigmaC).i('u_radius', ds.radiusC).f('u_luma', ...inp.luma)
          gpu.draw(o)
          gpu.free(s)
          return o
        }
        chroma = blur(blur(half, [1, 0], false), [0, 1], true)
      }
      const p = gpu.program('denoise', DENOISE).tex('u_src', dev.target, 0).f('u_luma', ...inp.luma).b('u_lumaOn', ds.luma)
        .f('u_sigmaS', ds.sigmaS).f('u_sigmaR', ds.sigmaR).i('u_radius', ds.radiusS).f('u_lumaMix', ds.lumaMix).f('u_chromaMix', ds.chroma ? ds.chromaMix : 0)
      p.tex('u_chroma', chroma ?? dev.target, 1)
      gpu.draw(t)
      gpu.free(chroma)
    })
  }

  const layers = activeLayers(params.layers)
  const use = layerUsage(layers)
  const fineOn = params.texture !== 0 || params.clarity !== 0 || use[6] || use[7]
  let fine: Stage | null = null
  if (fineOn) {
    fine = cache.run('fine', JSON.stringify([scene.version, ds.fine]), W, H, 'r16f', false, (t) => {
      const h = gpu.target(W, H, 'r16f')
      gpu.program('blur', BLUR).tex('u_src', scene.target, 0).i('u_dir', 1, 0).f('u_sigma', ds.fine).i('u_radius', ds.fineRadius).i('u_mode', 1).f('u_luma', ...inp.luma)
      gpu.draw(h)
      gpu.program('blur', BLUR).tex('u_src', h, 0).i('u_dir', 0, 1).i('u_mode', 0)
      gpu.draw(t)
      gpu.free(h)
    })
  }

  luts.update(params)
  const local = params.highlights !== 0 || params.shadows !== 0 || fineOn || use[2] || use[3]
  const hueOn = !!params.hueLut
  const colorOn = hueOn || params.bw || params.saturation !== 0 || params.vibrance !== 0 || !!params.grading || params.fade > 0
  const toOutput = frame.output === 'display-p3' ? REC2020_TO_P3 : REC2020_TO_SRGB
  const outLuma = frame.output === 'display-p3' ? [0.2289746, 0.6917385, 0.0792869] : [0.2126391, 0.7151687, 0.0721923]
  const globalKey = JSON.stringify([
    scene.version, fine?.version, frame.guide.key, frame.output, params.exposure, params.highlights, params.shadows, params.clarity, params.texture,
    params.dehaze, params.keys, params.contrast, params.whites, params.blacks, params.saturation, params.vibrance, params.bw,
    params.grading && Array.from(params.grading.wheels), params.grading?.balance, params.grading?.k, params.fade, frame.air, local,
  ])
  const drawTone = (t: Target, lp: Target[] | null) => {
    const p = gpu.program(lp ? 'toneLayers' : 'tone', () => TONE(!!lp))
    const m = frame.toSource
    const none = gpu.dummy()
    p.tex('u_scene', scene.target, 0).tex('u_fine', fine?.target ?? scene.target, 1).tex('u_coef', frame.guide.coef, 2)
      .tex('u_haze', frame.guide.haze ?? frame.guide.coef, 3).tex('u_toneLut', luts.tone!, 4).tex('u_hueLut', luts.hue ?? luts.tone!, 5)
      .tex('u_curveLut', luts.curve ?? luts.tone!, 6)
      .tex('u_lp0', lp?.[0] ?? none, 7).tex('u_lp1', lp?.[1] ?? none, 8).tex('u_lp2', lp?.[2] ?? none, 9).tex('u_lp3', lp?.[3] ?? none, 10).b('u_layersOn', !!lp)
    p.m3('u_toWorking', inp.toWorking).f('u_luma', ...inp.luma).m3('u_toSource', [m[0], m[1], m[2], m[3], m[4], m[5], 0, 0, 1])
      .f('u_regionOrigin', region.x, region.y).f('u_fullSize', frame.fullSize.width, frame.fullSize.height)
      .f('u_exposure', params.exposure).b('u_local', local).b('u_fineOn', fineOn)
      .f('u_highlights', params.highlights).f('u_shadows', params.shadows).f('u_clarity', params.clarity).f('u_texture', params.texture)
      .f('u_dehaze', params.dehaze).b('u_hazeOn', !!frame.guide.haze).f('u_air', ...frame.air)
      .b('u_raw', params.kind === 'raw').f('u_curve3', params.contrast, params.whites, params.blacks).f('u_contrastExp', params.contrastExp)
      .b('u_colorOn', colorOn).b('u_hueOn', hueOn).b('u_bw', params.bw)
      .f('u_sat', params.saturation).f('u_vib', params.vibrance).b('u_gradeOn', !!params.grading)
      .v4a('u_grade', params.grading?.wheels ?? new Float32Array(16)).f('u_gradeShape', params.grading?.balance ?? 1, params.grading?.k ?? 2)
      .f('u_fade', params.fade).b('u_curveOn', !!params.curveLut).m3('u_toOutput', toOutput)
      .f('u_wbTemp', ...WB_TEMP).f('u_wbTint', ...WB_TINT)
    gpu.draw(t)
  }

  // Local layers: masks need the photo as developed without them only for range masks.
  const overlayLayer = opts.overlay ? params.layers.find((l) => l.id === opts.overlay && drawableMasks(l.masks).length > 0) : undefined
  const maskLayers = overlayLayer && !layers.includes(overlayLayer) ? [...layers, overlayLayer] : layers
  let tone: Stage
  let lp: Target[] | null = null
  let masks = new Map<string, { target: Target; version: number }>()
  if (!maskLayers.length) tone = cache.run('tone', globalKey, W, H, 'rgba16f', false, (t) => drawTone(t, null))
  else {
    const needBase = maskLayers.some((l) => drawableMasks(l.masks).some((m) => m.type === 'range'))
    const base = needBase ? cache.run('toneBase', globalKey, W, H, 'rgba16f', false, (t) => drawTone(t, null)) : null
    masks = layerMasks(gpu, cache, { region, toSource: frame.toSource, fullSize: frame.fullSize, outLuma }, maskLayers, base)
    if (layers.length) {
      const local = localParams(gpu, cache, layers, masks, W, H)
      lp = local.targets
      tone = cache.run('tone', JSON.stringify([globalKey, local.version]), W, H, 'rgba16f', false, (t) => drawTone(t, lp))
    } else tone = cache.run('tone', globalKey, W, H, 'rgba16f', false, (t) => drawTone(t, null))
  }

  let sharp: Stage | null = null
  const sharpOn = ds.sharpen || use[10] || use[11]
  if (sharpOn) {
    sharp = cache.run('sharp', JSON.stringify([tone.version, ds.sharpSigma]), W, H, 'r16f', false, (t) => {
      const h = gpu.target(W, H, 'r16f')
      gpu.program('blur', BLUR).tex('u_src', tone.target, 0).i('u_dir', 1, 0).f('u_sigma', ds.sharpSigma).i('u_radius', ds.sharpRadius).i('u_mode', 2).f('u_luma', ...outLuma)
      gpu.draw(h)
      gpu.program('blur', BLUR).tex('u_src', h, 0).i('u_dir', 0, 1).i('u_mode', 0)
      gpu.draw(t)
      gpu.free(h)
    })
  }

  const e = params.effects
  const cellPx = 1 + (e.grainSize / 100) * 4
  const cellProc = cellPx * frame.pixelScale
  const overlay = overlayLayer ? masks.get(overlayLayer.id)?.target : undefined
  const p = gpu.program(lp || overlay ? 'finishLayers' : 'finish', () => FINISH(!!(lp || overlay)))
  p.tex('u_img', tone.target, 0).tex('u_sharp', sharp?.target ?? tone.target, 1)
    .tex('u_lp2', lp?.[2] ?? gpu.dummy(), 2).b('u_layersOn', !!lp).tex('u_overlay', overlay ?? gpu.dummy(), 3).b('u_overlayOn', !!overlay)
    .i('u_offset', frame.inner.x - region.x, frame.inner.y - region.y).f('u_tileOrigin', frame.inner.x, frame.inner.y)
    .f('u_outSize', frame.outSize.width, frame.outSize.height).f('u_outLuma', ...outLuma).f('u_knee', params.kind === 'raw' ? 0.9 : 1)
    .b('u_sharpOn', sharpOn).f('u_sharpAmount', ds.sharpAmount).f('u_sharpHalo', ds.sharpHalo).f('u_mask', ds.mask[0], ds.mask[1])
    .f('u_vig', Math.max(-1, Math.min(1, e.vignette / 100)))
    .f('u_vigShape', 0.15 + (e.vignetteMidpoint / 100) * 0.9, 0.1 + (e.vignetteFeather / 100), e.vignetteRoundness / 100, frame.outSize.width / frame.outSize.height)
    // Grain finer than a processing pixel averages out: scale its strength like the export's downscale would.
    .f('u_grain', (e.grain / 100) * 0.09 * Math.min(1, cellProc))
    .f('u_grainShape', cellPx, e.grainRoughness / 100, 1 / frame.pixelScale)
    .b('u_clip', opts.clipping).b('u_dither', opts.dither)
  gpu.draw(out)

  return (x, y, radius) => {
    luts.update(params)
    const t = layers.length ? cache.run('toneBase', globalKey, W, H, 'rgba16f', false, (t) => drawTone(t, null)).target : tone.target
    const r = Math.max(0, Math.round(radius))
    const x0 = Math.max(0, Math.floor(x - region.x) - r), y0 = Math.max(0, Math.floor(y - region.y) - r)
    const x1 = Math.min(W, Math.floor(x - region.x) + r + 1), y1 = Math.min(H, Math.floor(y - region.y) + r + 1)
    if (x1 <= x0 || y1 <= y0) return null
    const px = gpu.read(t, x0, y0, x1 - x0, y1 - y0)
    const sum: Vec3 = [0, 0, 0]
    for (let i = 0; i < px.length; i += 4) for (let k = 0; k < 3; k++) sum[k] += px[i + k]
    const n = px.length / 4
    const enc = (v: number) => (v <= 0.0031308 ? 12.92 * Math.max(0, v) : 1.055 * Math.min(1, v) ** (1 / 2.4) - 0.055)
    return [enc(sum[0] / n), enc(sum[1] / n), enc(sum[2] / n)]
  }
}
