// HDR merge of exposure brackets, in linear light (camera RGB for RAW).
//
// Exposure of each frame: from EXIF (shutter × ISO / aperture²), else
// estimated from the pixels both frames expose well. Frames are aligned to
// the reference (the middle exposure) with a similarity transform found from
// features on exposure-normalized luminance. Radiance = Σ wᵢ·Iᵢ/kᵢ / Σ wᵢ,
// with wᵢ ∝ kᵢ (longer exposures have less noise relative to signal) tapering
// to 0 as a frame nears clipping; the darkest frame keeps a small weight so
// highlights clipped everywhere still get a value. Deghosting: at low
// resolution, each frame's radiance is compared with the reference (or,
// where the reference is clipped or too dark, the exposure-weighted median
// of all frames); where it disagrees, that frame is left out (the mask
// is grown and softened, more aggressively at higher settings). Where the
// reference itself is well exposed it is the consensus, so a moving subject
// keeps the reference frame's position.
import type { PhotoMeta } from '../io/types'
import { detectFeatures, matchFeatures } from './features'
import { I3, apply3, mul3, ransac, scale3, type M3 } from './geometry'

export type Deghost = 'off' | 'low' | 'medium' | 'high'

/** Relative exposure of a frame from EXIF (bigger = brighter), or null if unknown. */
export function exifExposure(m: Pick<PhotoMeta, 'shutter' | 'aperture' | 'iso'>): number | null {
  if (!(m.shutter && m.shutter > 0)) return null
  const iso = m.iso && m.iso > 0 ? m.iso : 100
  const f = m.aperture && m.aperture > 0 ? m.aperture : 1
  return (m.shutter * iso) / (f * f)
}

/** Brightness of a linear RGB pixel used for weighting: its largest channel. */
const peak = (r: number, g: number, b: number) => (r > g ? (r > b ? r : b) : g > b ? g : b)

/** Weight of a sample by how far it is from clipping (1 below 0.80, 0 at 0.97). */
export function unclipped(v: number): number {
  if (v <= 0.8) return 1
  if (v >= 0.97) return 0
  const t = (0.97 - v) / 0.17
  return t * t * (3 - 2 * t)
}

/**
 * Exposure of `img` relative to `ref` from pixels both expose well
 * (median of ratios). Images are linear grey, same size, aligned.
 */
export function relativeExposure(img: Float32Array, ref: Float32Array): number {
  const ratios: number[] = []
  const step = Math.max(1, Math.floor(img.length / 40000))
  for (let i = 0; i < img.length; i += step) {
    const a = img[i], b = ref[i]
    if (a > 0.02 && a < 0.8 && b > 0.02 && b < 0.8) ratios.push(a / b)
  }
  if (ratios.length < 50) return NaN
  ratios.sort((x, y) => x - y)
  return ratios[Math.floor(ratios.length / 2)]
}

/** Grey (luminance-like) of interleaved linear RGB. */
export function greyOf(rgb: Float32Array): Float32Array {
  const n = rgb.length / 3
  const g = new Float32Array(n)
  for (let i = 0; i < n; i++) g[i] = 0.25 * rgb[i * 3] + 0.5 * rgb[i * 3 + 1] + 0.25 * rgb[i * 3 + 2]
  return g
}

/**
 * Transform mapping reference pixels → this frame's pixels (identity when
 * features don't agree). Both grey images linear; `k` = this frame's exposure
 * relative to the reference.
 */
export function alignToReference(img: Float32Array, ref: Float32Array, w: number, h: number, k: number): { transform: M3; inliers: number } {
  const norm = (a: Float32Array, s: number) => a.map((v) => Math.min(1, Math.max(0, v * s)) ** (1 / 2.2))
  // Bring both to the same brightness: the brighter one is scaled down (its clipped areas stay flat).
  const f1 = detectFeatures(norm(ref, k > 1 ? 1 : 1), w, h, 1500)
  const f2 = detectFeatures(norm(img, 1 / k), w, h, 1500)
  const m = matchFeatures(f1, f2)
  const r = ransac(m, 'similarity', Math.max(1.5, Math.max(w, h) / 600), 1500)
  if (!r || r.inliers.length < 12) return { transform: I3, inliers: r?.inliers.length ?? 0 }
  return { transform: r.model, inliers: r.inliers.length }
}

/** Bilinear sample of interleaved RGB at (x, y) (pixel centres at i + 0.5); null outside. */
export function sampleRgb(img: Float32Array, w: number, h: number, x: number, y: number, out: number[]): boolean {
  const fx = x - 0.5, fy = y - 0.5
  if (fx < -0.5 || fy < -0.5 || fx > w - 0.5 || fy > h - 0.5) return false
  const x0 = Math.max(0, Math.min(w - 1, Math.floor(fx))), y0 = Math.max(0, Math.min(h - 1, Math.floor(fy)))
  const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1)
  const tx = Math.min(1, Math.max(0, fx - x0)), ty = Math.min(1, Math.max(0, fy - y0))
  for (let c = 0; c < 3; c++) {
    const a = img[(y0 * w + x0) * 3 + c], b = img[(y0 * w + x1) * 3 + c], d = img[(y1 * w + x0) * 3 + c], e = img[(y1 * w + x1) * 3 + c]
    out[c] = (a + (b - a) * tx) * (1 - ty) + (d + (e - d) * tx) * ty
  }
  return true
}

export interface Frame {
  /** Interleaved linear RGB (0…1), aligned or not. */
  rgb: Float32Array
  /** Exposure relative to the reference. */
  k: number
  /** Reference px → this frame's px. */
  transform: M3
}

/**
 * Per-frame deghost masks (1 = use, 0 = leave out) at the frames' resolution.
 * The reference is always fully used.
 */
export function ghostMasks(frames: readonly Frame[], refIndex: number, w: number, h: number, level: Deghost): Float32Array[] {
  const masks = frames.map(() => new Float32Array(w * h).fill(1))
  if (level === 'off') return masks
  const tol = { low: 0.6, medium: 0.35, high: 0.2 }[level] // stops
  const grow = { low: 1, medium: 2, high: 4 }[level]
  const px = [0, 0, 0]
  const vals = frames.map(() => 0), wts = frames.map(() => 0), ok = frames.map(() => false)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      frames.forEach((f, i) => {
        const [sx, sy] = apply3(f.transform, x + 0.5, y + 0.5)
        ok[i] = sampleRgb(f.rgb, w, h, sx, sy, px)
        const p = peak(px[0], px[1], px[2])
        const g = 0.25 * px[0] + 0.5 * px[1] + 0.25 * px[2]
        vals[i] = Math.log2(Math.max(1e-6, g / f.k))
        wts[i] = ok[i] && p > 0.004 ? unclipped(p) * f.k : 0
      })
      // The consensus: the reference where it is well exposed, else the exposure-weighted median.
      const order = vals.map((_, i) => i).filter((i) => wts[i] > 0).sort((a, b) => vals[a] - vals[b])
      if (order.length < 2) continue
      let med: number
      if (wts[refIndex] > 0.5 * frames[refIndex].k) med = vals[refIndex]
      else {
        const half = order.reduce((n, i) => n + wts[i], 0) / 2
        let acc = 0
        med = vals[order[0]]
        for (const i of order)
          if ((acc += wts[i]) >= half) {
            med = vals[i]
            break
          }
      }
      for (let i = 0; i < frames.length; i++) if (i !== refIndex && wts[i] > 0 && Math.abs(vals[i] - med) > tol) masks[i][y * w + x] = 0
    }
  // Grow the left-out areas a little and soften their edges.
  return masks.map((m, i) => (i === refIndex ? m : soften(erode(m, w, h, grow), w, h, grow + 1)))
}

function erode(m: Float32Array, w: number, h: number, r: number): Float32Array {
  let cur = m
  for (let k = 0; k < r; k++) {
    const out = new Float32Array(w * h)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let v = cur[y * w + x]
        if (x > 0) v = Math.min(v, cur[y * w + x - 1])
        if (x < w - 1) v = Math.min(v, cur[y * w + x + 1])
        if (y > 0) v = Math.min(v, cur[(y - 1) * w + x])
        if (y < h - 1) v = Math.min(v, cur[(y + 1) * w + x])
        out[y * w + x] = v
      }
    cur = out
  }
  return cur
}

function soften(m: Float32Array, w: number, h: number, r: number): Float32Array {
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0, n = 0
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const xx = Math.min(w - 1, Math.max(0, x + dx)), yy = Math.min(h - 1, Math.max(0, y + dy))
          s += m[yy * w + xx]
          n++
        }
      out[y * w + x] = s / n
    }
  return out
}

/**
 * Accumulates frames into radiance (reference exposure units), one frame at a
 * time, at any resolution. Each frame: linear RGB via `lut` from its 16-bit
 * codes, divided by `whiteBalance` (back to native camera RGB, so frames with
 * different white balance agree), sampled through `transform` (output px →
 * frame px), weighted, and optionally masked by a low-resolution ghost mask.
 */
export class HdrAccumulator {
  readonly width: number
  readonly height: number
  readonly sum: Float32Array
  readonly weight: Float32Array

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    this.sum = new Float32Array(width * height * 3)
    this.weight = new Float32Array(width * height)
  }

  add(
    frame: { data: Uint16Array; width: number; height: number },
    lut: Float32Array,
    opts: { k: number; transform: M3; whiteBalance: readonly number[]; darkest: boolean; mask?: { data: Float32Array; width: number; height: number } },
  ): void {
    const { width: W, height: H } = this
    const fw = frame.width, fh = frame.height, d = frame.data
    const T = opts.transform
    const wb = opts.whiteBalance
    const mask = opts.mask
    const mx = mask ? mask.width / W : 0, my = mask ? mask.height / H : 0
    const px = [0, 0, 0]
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const X = x + 0.5, Y = y + 0.5
        const w3 = T[6] * X + T[7] * Y + T[8]
        const sx = (T[0] * X + T[1] * Y + T[2]) / w3 - 0.5, sy = (T[3] * X + T[4] * Y + T[5]) / w3 - 0.5
        if (sx < -0.5 || sy < -0.5 || sx > fw - 0.5 || sy > fh - 0.5) continue
        const x0 = Math.max(0, Math.min(fw - 1, Math.floor(sx))), y0 = Math.max(0, Math.min(fh - 1, Math.floor(sy)))
        const x1 = Math.min(fw - 1, x0 + 1), y1 = Math.min(fh - 1, y0 + 1)
        const tx = Math.min(1, Math.max(0, sx - x0)), ty = Math.min(1, Math.max(0, sy - y0))
        let clip = 0
        for (let c = 0; c < 3; c++) {
          const a = lut[d[(y0 * fw + x0) * 3 + c]], b = lut[d[(y0 * fw + x1) * 3 + c]], e = lut[d[(y1 * fw + x0) * 3 + c]], f = lut[d[(y1 * fw + x1) * 3 + c]]
          // Clipping is judged on the brightest of the 4 neighbours (interpolation hides it otherwise).
          clip = Math.max(clip, a, b, e, f)
          px[c] = (a + (b - a) * tx) * (1 - ty) + (e + (f - e) * tx) * ty
        }
        let w = unclipped(clip) * opts.k
        if (opts.darkest) w = Math.max(w, 1e-4 * opts.k)
        if (mask && w > 0) {
          const mi = Math.min(mask.height - 1, Math.floor(y * my)) * mask.width + Math.min(mask.width - 1, Math.floor(x * mx))
          w *= opts.darkest ? Math.max(mask.data[mi], 1e-3) : mask.data[mi]
        }
        if (w <= 0) continue
        const o = (y * W + x) * 3
        const inv = w / opts.k
        this.sum[o] += (px[0] / wb[0]) * inv
        this.sum[o + 1] += (px[1] / wb[1]) * inv
        this.sum[o + 2] += (px[2] / wb[2]) * inv
        this.weight[y * W + x] += w
      }
  }

  /** Radiance at a pixel (native camera RGB, reference exposure units; 0 where nothing landed). */
  radiance(i: number, out: number[]): void {
    const w = this.weight[i] || 1
    out[0] = this.sum[i * 3] / w
    out[1] = this.sum[i * 3 + 1] / w
    out[2] = this.sum[i * 3 + 2] / w
  }
}

/** Full-resolution transform from one found at analysis resolution (factor `s` = full / analysis). */
export function scaleTransform(t: M3, s: number): M3 {
  return mul3(scale3(s), mul3(t, scale3(1 / s)))
}
