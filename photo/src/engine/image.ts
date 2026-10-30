// CPU-side image helpers: the small linear copy used for the local-tone guide,
// Auto and dehaze, integer box reduction before upload, and the eyedropper.

import type { Vec3 } from '../color/matrices'
import type { SourceImage } from './types'

/** Linear RGB, interleaved, in the source's own space (1.0 = white). */
export interface FloatImage {
  width: number
  height: number
  data: Float32Array
}

/** Long edge of the low-res guide. Fixed so preview and export compute the same local tone. */
export const GUIDE_LONG_EDGE = 512

export function lowResSize(w: number, h: number, maxLong = GUIDE_LONG_EDGE): { width: number; height: number } {
  const s = Math.min(1, maxLong / Math.max(w, h))
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) }
}

function areaWeights(n: number, m: number) {
  const scale = n / m
  const taps = Math.ceil(scale) + 1
  const start = new Int32Array(m)
  const w = new Float32Array(m * taps)
  for (let i = 0; i < m; i++) {
    const a = i * scale, b = a + scale, j0 = Math.floor(a)
    start[i] = j0
    for (let t = 0; t < taps && j0 + t < n; t++) w[i * taps + t] = Math.max(0, Math.min(b, j0 + t + 1) - Math.max(a, j0 + t)) / scale
  }
  return { start, w, taps }
}

/** Exact area-average downscale (each output pixel = mean of the source area it covers). */
export function areaDownscale(src: SourceImage, dw: number, dh: number): FloatImage {
  const { width: W, height: H, data } = src
  const hx = areaWeights(W, dw), vy = areaWeights(H, dh)
  const tmp = new Float32Array(dw * H * 3)
  for (let y = 0; y < H; y++) {
    const row = y * W * 3, orow = y * dw * 3
    for (let i = 0; i < dw; i++) {
      let r = 0, g = 0, b = 0
      for (let t = 0; t < hx.taps; t++) {
        const wt = hx.w[i * hx.taps + t]
        if (wt === 0) continue
        const o = row + (hx.start[i] + t) * 3
        r += wt * data[o]
        g += wt * data[o + 1]
        b += wt * data[o + 2]
      }
      tmp[orow + i * 3] = r
      tmp[orow + i * 3 + 1] = g
      tmp[orow + i * 3 + 2] = b
    }
  }
  const out = new Float32Array(dw * dh * 3)
  const k = 1 / 65535
  for (let i = 0; i < dh; i++) {
    const o = i * dw * 3
    for (let t = 0; t < vy.taps; t++) {
      const wt = vy.w[i * vy.taps + t] * k
      if (wt === 0) continue
      const s = (vy.start[i] + t) * dw * 3
      for (let x = 0; x < dw * 3; x++) out[o + x] += wt * tmp[s + x]
    }
  }
  return { width: dw, height: dh, data: out }
}

/** Integer k×k box average (drops the < k leftover columns/rows) — cheap, alias-free pre-reduction for big downscales. */
export function boxReduce(src: SourceImage, k: number): SourceImage {
  if (k <= 1) return src
  const W = Math.floor(src.width / k), H = Math.floor(src.height / k)
  const out = new Uint16Array(W * H * 3)
  const acc = new Float64Array(W * 3)
  const inv = 1 / (k * k)
  for (let y = 0; y < H; y++) {
    acc.fill(0)
    for (let dy = 0; dy < k; dy++) {
      const row = (y * k + dy) * src.width * 3
      for (let x = 0; x < W; x++) {
        let o = row + x * k * 3
        for (let dx = 0; dx < k; dx++, o += 3) {
          acc[x * 3] += src.data[o]
          acc[x * 3 + 1] += src.data[o + 1]
          acc[x * 3 + 2] += src.data[o + 2]
        }
      }
    }
    const o = y * W * 3
    for (let x = 0; x < W * 3; x++) out[o + x] = Math.round(acc[x] * inv)
  }
  return { width: W, height: H, data: out }
}

/** Mean source pixel (0…1) of the pixels whose centers lie within `r` px of (x, y); null when outside. */
export function averagePixel(src: SourceImage, x: number, y: number, r: number): Vec3 | null {
  if (x < 0 || y < 0 || x > src.width || y > src.height) return null
  const x0 = Math.max(0, Math.floor(x - r)), x1 = Math.min(src.width - 1, Math.floor(x + r))
  const y0 = Math.max(0, Math.floor(y - r)), y1 = Math.min(src.height - 1, Math.floor(y + r))
  const sum: Vec3 = [0, 0, 0]
  let n = 0
  for (let j = y0; j <= y1; j++)
    for (let i = x0; i <= x1; i++) {
      const o = (j * src.width + i) * 3
      sum[0] += src.data[o]
      sum[1] += src.data[o + 1]
      sum[2] += src.data[o + 2]
      n++
    }
  return n ? [sum[0] / n / 65535, sum[1] / n / 65535, sum[2] / n / 65535] : null
}

/** Airlight for dehaze: mean color of the 0.2 % of pixels with the brightest dark channel (He et al.). */
export function atmosphericLight(img: FloatImage): Vec3 {
  const n = img.width * img.height
  const dark = new Float32Array(n)
  for (let i = 0; i < n; i++) dark[i] = Math.min(img.data[i * 3], img.data[i * 3 + 1], img.data[i * 3 + 2])
  const threshold = Float32Array.from(dark).sort()[Math.max(0, Math.floor(n * 0.998) - 1)]
  const a: Vec3 = [0, 0, 0]
  let count = 0
  for (let i = 0; i < n; i++)
    if (dark[i] >= threshold) {
      a[0] += img.data[i * 3]
      a[1] += img.data[i * 3 + 1]
      a[2] += img.data[i * 3 + 2]
      count++
    }
  // Never let a dark scene's "airlight" be dim: that would make dehaze blow everything up.
  const floor = 0.25
  return a.map((v) => Math.max(floor, v / Math.max(1, count))) as Vec3
}

/** Area-average resize to 16-bit (e.g. the denoised full-resolution raster to the working image's size). */
export function resizeArea16(src: SourceImage, width: number, height: number): SourceImage {
  if (src.width === width && src.height === height) return src
  const f = areaDownscale(src, width, height).data
  const data = new Uint16Array(f.length)
  for (let i = 0; i < f.length; i++) data[i] = Math.round(Math.min(1, Math.max(0, f[i])) * 65535)
  return { width, height, data }
}
