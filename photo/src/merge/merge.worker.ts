// The merge worker: HDR and panorama analysis, previews and full-resolution
// rendering into a DNG, off the UI thread. Sources arrive one at a time (the
// main thread decodes them), so only the sources a panorama needs at once and
// the HDR accumulators are ever in memory here.
import type { Mat3 } from '../color/matrices'
import { DngWriter } from '../io/dng'
import type { PhotoMeta } from '../io/types'
import { greyOf, alignToReference, ghostMasks, HdrAccumulator, relativeExposure, scaleTransform, type Deghost, type Frame } from './hdr'
import { I3, type M3 } from './geometry'
import { linearLut } from './linearize'
import { blendTile, gainCompensation, largestRectangle, PanoMapper, planPanorama, type PanoPlan, type Projection, type RenderSource } from './pano'
import type { SourceColor } from '../engine/types'

interface SmallSource {
  data: Uint16Array
  width: number
  height: number
  color: SourceColor
  /** As-shot white balance the decoded data carry (1, 1, 1 for JPEG). */
  shotMul: number[]
  /** EXIF exposure (shutter × ISO / f²), or null. */
  exposure: number | null
}

type Progress = (f: number) => void

const lin = (s: { data: Uint16Array; color: SourceColor }) => {
  const lut = linearLut(s.color)
  return Float32Array.from(s.data, (v) => lut[v])
}

// ---------- display previews ----------

/** Linear camera RGB (white-balanced) → tone-mapped sRGB 8-bit RGBA. */
function toneMap(rgb: Float32Array, w: number, h: number, rgbCam: Mat3 | null, hdr: boolean): Uint8ClampedArray<ArrayBuffer> {
  const n = w * h
  const lum = new Float32Array(n)
  const srgb = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    let r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2]
    if (rgbCam) [r, g, b] = [rgbCam[0] * r + rgbCam[1] * g + rgbCam[2] * b, rgbCam[3] * r + rgbCam[4] * g + rgbCam[5] * b, rgbCam[6] * r + rgbCam[7] * g + rgbCam[8] * b]
    srgb[i * 3] = Math.max(0, r)
    srgb[i * 3 + 1] = Math.max(0, g)
    srgb[i * 3 + 2] = Math.max(0, b)
    lum[i] = 0.2126 * srgb[i * 3] + 0.7152 * srgb[i * 3 + 1] + 0.0722 * srgb[i * 3 + 2]
  }
  const sorted = Float32Array.from(lum.filter((_, i) => i % 5 === 0)).sort()
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] || 1e-6
  // Middle grey at the median; HDR gets a soft shoulder up to its brightest highlights.
  const k = 0.18 / Math.max(at(0.5), 1e-6)
  const white = hdr ? Math.max(1, at(0.999) * k) : 1e9
  const out = new Uint8ClampedArray(n * 4)
  const enc = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055) * 255 + 0.5
  for (let i = 0; i < n; i++) {
    const L = lum[i] * k
    const t = hdr ? (L * (1 + L / (white * white))) / (1 + L) / Math.max(L, 1e-9) : 1
    out[i * 4] = enc(Math.min(1, srgb[i * 3] * k * t))
    out[i * 4 + 1] = enc(Math.min(1, srgb[i * 3 + 1] * k * t))
    out[i * 4 + 2] = enc(Math.min(1, srgb[i * 3 + 2] * k * t))
    out[i * 4 + 3] = 255
  }
  return out
}

async function jpegOf(rgba: Uint8ClampedArray<ArrayBuffer>, w: number, h: number): Promise<Uint8Array> {
  const c = new OffscreenCanvas(w, h)
  c.getContext('2d')!.putImageData(new ImageData(rgba, w, h), 0, 0)
  return new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.85 })).arrayBuffer())
}

// ---------- HDR ----------

export interface HdrAnalysis {
  ref: number
  /** Exposure of each frame relative to the reference. */
  k: number[]
  /** Reference px → frame px at analysis size. */
  transforms: M3[]
  inliers: number[]
  masks: Float32Array[]
  width: number
  height: number
  preview: Uint8ClampedArray<ArrayBuffer>
  /** Dynamic range covered, in stops (brightest frame's to darkest frame's exposure). */
  stops: number
  notes: string[]
}

let hdrAcc: HdrAccumulator | null = null

const handlers = {
  async hdrAnalyze(a: { frames: SmallSource[]; deghost: Deghost; rgbCam: Mat3 | null }): Promise<HdrAnalysis> {
    const notes: string[] = []
    const { width: w, height: h } = a.frames[0]
    const rgbs = a.frames.map(lin)
    const greys = rgbs.map(greyOf)
    // Reference: the middle exposure (by EXIF, else by brightness).
    const mean = (g: Float32Array) => g.reduce((s, v) => s + v, 0) / g.length
    const exif = a.frames.map((f) => f.exposure)
    const haveExif = exif.every((e) => e && e > 0)
    const brightness = haveExif ? (exif as number[]) : greys.map(mean)
    const order = brightness.map((_, i) => i).sort((x, y) => brightness[x] - brightness[y])
    const ref = order[Math.floor((order.length - 1) / 2)]
    let k = haveExif ? (exif as number[]).map((e) => e / exif[ref]!) : greys.map((g) => mean(g) / mean(greys[ref]))
    if (!haveExif) notes.push('No exposure information in the files: exposures were estimated from the photos.')
    const transforms: M3[] = [], inliers: number[] = []
    for (let i = 0; i < a.frames.length; i++) {
      if (i === ref) {
        transforms.push(I3)
        inliers.push(-1)
        continue
      }
      const r = alignToReference(greys[i], greys[ref], w, h, k[i])
      transforms.push(r.transform)
      inliers.push(r.inliers)
      if (r.transform === I3) notes.push(`Frame ${i + 1} couldn’t be aligned (kept as shot).`)
    }
    if (!haveExif) {
      // Refine the estimates on aligned pixels.
      k = k.map((ki, i) => {
        if (i === ref) return 1
        const t = transforms[i]
        const warped = new Float32Array(w * h)
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            const sx = Math.round(t[0] * (x + 0.5) + t[1] * (y + 0.5) + t[2] - 0.5), sy = Math.round(t[3] * (x + 0.5) + t[4] * (y + 0.5) + t[5] - 0.5)
            warped[y * w + x] = sx >= 0 && sy >= 0 && sx < w && sy < h ? greys[i][sy * w + sx] : 0
          }
        const e = relativeExposure(warped, greys[ref])
        return Number.isFinite(e) ? e : ki
      })
    }
    const frames: Frame[] = rgbs.map((rgb, i) => ({ rgb, k: k[i], transform: transforms[i] }))
    const masks = ghostMasks(frames, ref, w, h, a.deghost)
    // Preview: the merge itself at analysis size.
    const acc = new HdrAccumulator(w, h)
    const darkest = order[0]
    a.frames.forEach((f, i) => acc.add(f, linearLut(f.color), { k: k[i], transform: transforms[i], whiteBalance: f.shotMul, darkest: i === darkest, mask: { data: masks[i], width: w, height: h } }))
    const rad = new Float32Array(w * h * 3), px = [0, 0, 0]
    const wb = a.frames[ref].shotMul
    for (let i = 0; i < w * h; i++) {
      acc.radiance(i, px)
      for (let c = 0; c < 3; c++) rad[i * 3 + c] = px[c] * wb[c]
    }
    const stops = Math.log2(Math.max(...k) / Math.min(...k))
    return { ref, k, transforms, inliers, masks, width: w, height: h, preview: toneMap(rad, w, h, a.rgbCam, true), stops, notes }
  },

  async hdrBegin(a: { width: number; height: number }) {
    hdrAcc = new HdrAccumulator(a.width, a.height)
  },

  async hdrAdd(a: { frame: { data: Uint16Array; width: number; height: number; color: SourceColor }; k: number; transform: M3; shotMul: number[]; darkest: boolean; mask: { data: Float32Array; width: number; height: number } | null; analysisScale: number }) {
    if (!hdrAcc) throw new Error('HDR merge not started')
    // analysisScale: full-resolution px per analysis px.
    hdrAcc.add(a.frame, linearLut(a.frame.color), { k: a.k, transform: scaleTransform(a.transform, a.analysisScale), whiteBalance: a.shotMul, darkest: a.darkest, mask: a.mask ?? undefined })
  },

  /** Finish: scale to 16 bits, write the DNG. */
  async hdrFinish(a: { refShotMul: number[]; camXyz: Mat3; rgbCam: Mat3 | null; meta: PhotoMeta; uniqueCameraModel: string }, progress: Progress): Promise<{ dng: Blob; baselineExposure: number; width: number; height: number }> {
    const acc = hdrAcc
    if (!acc) throw new Error('HDR merge not started')
    hdrAcc = null
    const { width: W, height: H } = acc
    return writeOut(W, H, (y, row) => {
      const px = [0, 0, 0]
      for (let x = 0; x < W; x++) {
        acc.radiance(y * W + x, px)
        row[x * 3] = px[0]
        row[x * 3 + 1] = px[1]
        row[x * 3 + 2] = px[2]
      }
    }, a, true, progress)
  },

  // ---------- panorama ----------

  async panoAnalyze(a: { images: SmallSource[]; projection: Projection | 'auto'; autoCrop: boolean; rgbCam: Mat3 | null; refShotMul: number[] }): Promise<{ plan: PanoPlan; gains: number[]; crop: { x: number; y: number; w: number; h: number } | null; preview: Uint8ClampedArray<ArrayBuffer>; width: number; height: number }> {
    const greys = a.images.map((s) => {
      const g = greyOf(lin(s))
      // Perceptual, exposure-normalized grey for features.
      const sorted = Float32Array.from(g.filter((_, i) => i % 7 === 0)).sort()
      const top = sorted[Math.floor(sorted.length * 0.99)] || 1
      return g.map((v) => Math.min(1, v / top) ** (1 / 2.2))
    })
    const plan = planPanorama(
      a.images.map((s, i) => ({ grey: greys[i], width: s.width, height: s.height })),
      a.projection,
    )
    // Preview at about 1200 px wide.
    const b = plan.bounds
    const scale = Math.min(1, 1200 / Math.max(b.x1 - b.x0, b.y1 - b.y0))
    const sources = a.images.map((s): RenderSource => ({ data: s.data, width: s.width, height: s.height, lut: linearLut(s.color), gain: s.shotMul.map((m, c) => a.refShotMul[c] / m) }))
    const mapper = new PanoMapper(plan, scale, a.images.map(() => 1))
    const gains = gainCompensation(mapper, sources, 3)
    const withGains = sources.map((s, i) => ({ ...s, gain: s.gain.map((g) => g * gains[i]) }))
    const { rgb, covered } = blendTile(mapper, withGains, 0, 0, mapper.width, mapper.height, 4)
    const crop = a.autoCrop ? largestRectangle(covered, mapper.width, mapper.height) : null
    let preview = toneMap(rgb, mapper.width, mapper.height, a.rgbCam, false)
    for (let i = 0; i < covered.length; i++) if (!covered[i]) preview[i * 4] = preview[i * 4 + 1] = preview[i * 4 + 2] = 0
    if (crop) {
      // Dim what the crop removes, so the preview shows both.
      const x0 = crop.x * mapper.width, y0 = crop.y * mapper.height, x1 = x0 + crop.w * mapper.width, y1 = y0 + crop.h * mapper.height
      preview = preview.map((v, i) => {
        const p = i >> 2, x = p % mapper.width, y = (p - x) / mapper.width
        return (i & 3) === 3 || (x >= x0 && x < x1 && y >= y0 && y < y1) ? v : v * 0.35
      })
    }
    return { plan, gains, crop, preview, width: mapper.width, height: mapper.height }
  },

  async panoRender(
    a: {
      plan: PanoPlan
      gains: number[]
      crop: { x: number; y: number; w: number; h: number } | null
      /** Output px per analysis px. */
      scale: number
      sources: { data: Uint16Array; width: number; height: number; color: SourceColor; shotMul: number[]; analysisWidth: number }[]
      refShotMul: number[]
      camXyz: Mat3
      rgbCam: Mat3 | null
      meta: PhotoMeta
      uniqueCameraModel: string
    },
    progress: Progress,
  ): Promise<{ dng: Blob; baselineExposure: number; width: number; height: number }> {
    const mapper = new PanoMapper(a.plan, a.scale, a.sources.map((s) => s.width / s.analysisWidth), a.crop ?? undefined)
    // Native camera RGB × gain, in the reference frame's white balance units (WB divided out).
    const sources: RenderSource[] = a.sources.map((s, i) => ({ data: s.data, width: s.width, height: s.height, lut: linearLut(s.color), gain: s.shotMul.map((m) => a.gains[i] / m) }))
    const W = mapper.width, H = mapper.height
    const levels = Math.max(3, Math.min(6, Math.round(Math.log2(Math.max(W, H) / 200))))
    const T = 768
    let band: { rgb: Float32Array; y0: number; rows: number } | null = null
    const tileRow = (ty: number) => {
      const rows = Math.min(T, H - ty)
      const rgb = new Float32Array(W * rows * 3)
      for (let tx = 0; tx < W; tx += T) {
        const cols = Math.min(T, W - tx)
        const t = blendTile(mapper, sources, tx, ty, cols, rows, levels)
        for (let y = 0; y < rows; y++) rgb.set(t.rgb.subarray(y * cols * 3, (y + 1) * cols * 3), (y * W + tx) * 3)
      }
      return { rgb, y0: ty, rows }
    }
    // No value can exceed a source's clipping point times its gain and white balance change.
    const wbRef = a.refShotMul.map((m) => m / Math.min(...a.refShotMul))
    const peak = Math.max(...a.sources.map((s, i) => a.gains[i] * Math.max(...s.shotMul.map((m, c) => (wbRef[c] * 1) / m))))
    return writeOut(W, H, (y, row) => {
      if (!band || y >= band.y0 + band.rows) band = tileRow(y)
      row.set(band.rgb.subarray((y - band.y0) * W * 3, (y - band.y0 + 1) * W * 3))
    }, a, false, progress, peak)
  },

  async release() {
    hdrAcc = null
  },
}

/**
 * Render rows of native-camera linear RGB (in units where 1 = the reference's
 * clipping point, white balance divided out) into a DNG, scaled to fill 16
 * bits without clipping (BaselineExposure says by how much). HDR: `peak`
 * unknown, so the rows (cheap, from the accumulator) are read twice.
 * Panoramas: `peak` is known (no value can exceed the brightest gain), one pass.
 */
async function writeOut(
  W: number,
  H: number,
  row: (y: number, out: Float32Array) => void,
  a: { refShotMul: number[]; camXyz: Mat3; rgbCam: Mat3 | null; meta: PhotoMeta; uniqueCameraModel: string },
  hdr: boolean,
  progress: Progress,
  knownPeak?: number,
): Promise<{ dng: Blob; baselineExposure: number; width: number; height: number }> {
  const buf = new Float32Array(W * 3)
  // LibRaw multiplies the stored values by the white balance normalized to its smallest multiplier.
  const wb = a.refShotMul.map((m) => m / Math.min(...a.refShotMul))
  let peakV = knownPeak ?? 1
  if (knownPeak === undefined) {
    // The 99.995th percentile, so a few hot pixels don't waste the range.
    const hist = new Uint32Array(4096)
    for (let y = 0; y < H; y++) {
      row(y, buf)
      for (let x = 0; x < W; x++) {
        const p = Math.max(buf[x * 3] * wb[0], buf[x * 3 + 1] * wb[1], buf[x * 3 + 2] * wb[2])
        hist[Math.min(4095, Math.floor(Math.log2(Math.max(p, 0) + 1) * 256))]++
      }
      if (y % 64 === 0) progress((0.3 * y) / H)
    }
    let acc = 0
    for (let b = 4095; b >= 0; b--) {
      acc += hist[b]
      if (acc > W * H * 5e-5) {
        peakV = 2 ** ((b + 1) / 256) - 1
        break
      }
    }
  }
  const scale = Math.min(1, 1 / Math.max(peakV, 1e-6)) // only ever scale down
  const baselineExposure = Math.log2(1 / scale)
  const PW = Math.max(1, Math.round(Math.min(1, 1024 / Math.max(W, H)) * W)), PH = Math.max(1, Math.round((PW / W) * H))
  const prev = new Float32Array(PW * PH * 3), prevN = new Float32Array(PW * PH)
  const dng = new DngWriter({
    width: W,
    height: H,
    colorMatrix: a.camXyz,
    asShotNeutral: [1 / a.refShotMul[0], 1 / a.refShotMul[1], 1 / a.refShotMul[2]].map((v, _, arr) => v / arr[1]) as [number, number, number],
    baselineExposure,
    meta: a.meta,
    uniqueCameraModel: a.uniqueCameraModel,
  })
  const k = scale * 65535
  const out = new Uint16Array(W * 3)
  const p0 = knownPeak === undefined ? 0.3 : 0
  for (let y = 0; y < H; y++) {
    row(y, buf)
    const py = Math.min(PH - 1, Math.floor((y * PH) / H))
    for (let x = 0; x < W; x++) {
      const pi = py * PW + Math.min(PW - 1, Math.floor((x * PW) / W))
      prevN[pi]++
      for (let c = 0; c < 3; c++) {
        const v = buf[x * 3 + c]
        prev[pi * 3 + c] += v * a.refShotMul[c]
        const q = v * k
        out[x * 3 + c] = q <= 0 ? 0 : q >= 65535 ? 65535 : Math.round(q)
      }
    }
    dng.addRows(out)
    if (y % 32 === 0) progress(p0 + ((1 - p0) * y) / H)
  }
  for (let i = 0; i < PW * PH; i++) for (let c = 0; c < 3; c++) prev[i * 3 + c] /= prevN[i] || 1
  const jpeg = await jpegOf(toneMap(prev, PW, PH, a.rgbCam, hdr), PW, PH)
  progress(1)
  return { dng: dng.finish({ jpeg, width: PW, height: PH }), baselineExposure, width: W, height: H }
}

export type MergeOps = typeof handlers

self.onmessage = async (e: MessageEvent<{ id: number; op: keyof MergeOps; args: never }>) => {
  const { id, op, args } = e.data
  try {
    const result = await (handlers[op] as (a: never, p: Progress) => Promise<unknown>)(args, (f) => self.postMessage({ id, progress: f }))
    self.postMessage({ id, result })
  } catch (err) {
    self.postMessage({ id, error: { name: (err as Error).name ?? 'Error', message: (err as Error).message ?? String(err) } })
  }
}
