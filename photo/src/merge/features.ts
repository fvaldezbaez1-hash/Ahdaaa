// Feature points for alignment and stitching, ORB-style: Harris corners on a
// small scale pyramid, spread over the image, an orientation from the patch's
// intensity centroid, and a rotated binary (BRIEF) descriptor; matched by
// Hamming distance with a ratio test and a mutual check.
import { rng } from './geometry'

export interface Keypoint {
  x: number
  y: number
  /** Pyramid scale (1 = full analysis resolution). */
  scale: number
  angle: number
  response: number
}

export interface Features {
  points: Keypoint[]
  /** 8 × 32 bits per point. */
  desc: Uint32Array
}

const PATCH = 15 // half size of the 31×31 descriptor patch
const BORDER = PATCH + 3

/** Area-average downscale of a grey image. */
export function shrink(src: Float32Array, w: number, h: number, nw: number, nh: number): Float32Array {
  const out = new Float32Array(nw * nh)
  const cnt = new Float32Array(nw * nh)
  for (let y = 0; y < h; y++) {
    const oy = Math.min(nh - 1, Math.floor((y * nh) / h))
    for (let x = 0; x < w; x++) {
      const o = oy * nw + Math.min(nw - 1, Math.floor((x * nw) / w))
      out[o] += src[y * w + x]
      cnt[o]++
    }
  }
  for (let i = 0; i < out.length; i++) out[i] /= cnt[i] || 1
  return out
}

/** Separable box blur, radius r. */
export function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h)
  const n = 2 * r + 1
  for (let y = 0; y < h; y++) {
    let s = 0
    for (let i = -r; i <= r; i++) s += src[y * w + Math.min(w - 1, Math.max(0, i))]
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = s / n
      s += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)]
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0
    for (let i = -r; i <= r; i++) s += tmp[Math.min(h - 1, Math.max(0, i)) * w + x]
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s / n
      s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]
    }
  }
  return out
}

// The BRIEF sampling pattern: 256 point pairs, Gaussian around the centre (fixed seed: same everywhere).
const PATTERN = (() => {
  const rand = rng(31337)
  const gauss = () => {
    const u = Math.max(1e-9, rand()), v = rand()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * (PATCH / 2.5)
  }
  const clip = (v: number) => Math.max(-PATCH + 2, Math.min(PATCH - 2, Math.round(v)))
  const p = new Int8Array(256 * 4)
  for (let i = 0; i < 256; i++) for (let k = 0; k < 4; k++) p[i * 4 + k] = clip(gauss())
  return p
})()

function harris(img: Float32Array, w: number, h: number): Float32Array {
  const ixx = new Float32Array(w * h), iyy = new Float32Array(w * h), ixy = new Float32Array(w * h)
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const gx = img[i + 1] - img[i - 1] + 0.5 * (img[i - w + 1] - img[i - w - 1] + img[i + w + 1] - img[i + w - 1])
      const gy = img[i + w] - img[i - w] + 0.5 * (img[i + w - 1] - img[i - w - 1] + img[i + w + 1] - img[i - w + 1])
      ixx[i] = gx * gx
      iyy[i] = gy * gy
      ixy[i] = gx * gy
    }
  const a = boxBlur(ixx, w, h, 2), b = boxBlur(iyy, w, h, 2), c = boxBlur(ixy, w, h, 2)
  const r = new Float32Array(w * h)
  for (let i = 0; i < r.length; i++) r[i] = a[i] * b[i] - c[i] * c[i] - 0.04 * (a[i] + b[i]) ** 2
  return r
}

/** Detect and describe up to `max` features of a grey image (values ≈ 0…1). */
export function detectFeatures(grey: Float32Array, w: number, h: number, max = 1500): Features {
  const points: Keypoint[] = []
  const descs: number[] = []
  const levels: { img: Float32Array; smooth: Float32Array; w: number; h: number; s: number }[] = []
  for (let s = 1, lw = w, lh = h, img = grey; levels.length < 4 && Math.min(lw, lh) > 4 * BORDER; ) {
    levels.push({ img, smooth: boxBlur(boxBlur(img, lw, lh, 1), lw, lh, 1), w: lw, h: lh, s })
    const nw = Math.round(lw / 1.5), nh = Math.round(lh / 1.5)
    img = shrink(img, lw, lh, nw, nh)
    s = s * (nw / lw)
    lw = nw
    lh = nh
  }
  const perLevel = levels.map((l, i) => Math.round((max * (l.w * l.h)) / levels.reduce((n, x) => n + x.w * x.h, 0)) + (i ? 0 : 1))
  levels.forEach((L, li) => {
    const R = harris(L.img, L.w, L.h)
    // Strongest corners per grid cell, so features cover the whole frame.
    const cells = 8
    const cw = Math.ceil(L.w / cells), ch = Math.ceil(L.h / cells)
    const quota = Math.max(4, Math.ceil(perLevel[li] / (cells * cells)))
    let maxR = 0
    for (const v of R) if (v > maxR) maxR = v
    const thr = maxR * 1e-4
    for (let cy = 0; cy < cells; cy++)
      for (let cx = 0; cx < cells; cx++) {
        const cand: [number, number][] = []
        for (let y = Math.max(BORDER, cy * ch); y < Math.min(L.h - BORDER, (cy + 1) * ch); y++)
          for (let x = Math.max(BORDER, cx * cw); x < Math.min(L.w - BORDER, (cx + 1) * cw); x++) {
            const i = y * L.w + x, v = R[i]
            if (v <= thr) continue
            if (v < R[i - 1] || v < R[i + 1] || v < R[i - L.w] || v < R[i + L.w] || v < R[i - L.w - 1] || v < R[i - L.w + 1] || v < R[i + L.w - 1] || v < R[i + L.w + 1]) continue
            cand.push([i, v])
          }
        cand.sort((a, b) => b[1] - a[1])
        for (const [i] of cand.slice(0, quota)) {
          const x = i % L.w, y = (i - x) / L.w
          // Orientation: intensity centroid of the round patch.
          let m01 = 0, m10 = 0
          for (let dy = -PATCH; dy <= PATCH; dy++) {
            const rr = Math.floor(Math.sqrt(PATCH * PATCH - dy * dy))
            for (let dx = -rr; dx <= rr; dx++) {
              const v = L.smooth[(y + dy) * L.w + x + dx]
              m10 += dx * v
              m01 += dy * v
            }
          }
          const angle = Math.atan2(m01, m10)
          const ca = Math.cos(angle), sa = Math.sin(angle)
          const d = new Uint32Array(8)
          for (let b = 0; b < 256; b++) {
            const p = b * 4
            const ax = Math.round(PATTERN[p] * ca - PATTERN[p + 1] * sa), ay = Math.round(PATTERN[p] * sa + PATTERN[p + 1] * ca)
            const bx = Math.round(PATTERN[p + 2] * ca - PATTERN[p + 3] * sa), by = Math.round(PATTERN[p + 2] * sa + PATTERN[p + 3] * ca)
            if (L.smooth[(y + ay) * L.w + x + ax] < L.smooth[(y + by) * L.w + x + bx]) d[b >> 5] |= 1 << (b & 31)
          }
          points.push({ x: (x + 0.5) / L.s - 0.5, y: (y + 0.5) / L.s - 0.5, scale: L.s, angle, response: R[i] })
          for (const v of d) descs.push(v)
        }
      }
  })
  return { points, desc: Uint32Array.from(descs) }
}

function popcount(v: number): number {
  v = v - ((v >>> 1) & 0x55555555)
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333)
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
}

function nearest(a: Uint32Array, i: number, b: Uint32Array, nb: number): [number, number, number] {
  let best = 1e9, second = 1e9, bi = -1
  for (let j = 0; j < nb; j++) {
    let d = 0
    for (let k = 0; k < 8; k++) d += popcount(a[i * 8 + k] ^ b[j * 8 + k])
    if (d < best) {
      second = best
      best = d
      bi = j
    } else if (d < second) second = d
  }
  return [bi, best, second]
}

/** Matches between two feature sets: ratio test (0.8), mutual nearest, Hamming ≤ 64. */
export function matchFeatures(a: Features, b: Features, ratio = 0.8): { x1: number; y1: number; x2: number; y2: number }[] {
  const na = a.points.length, nb = b.points.length
  if (!na || !nb) return []
  const back = new Int32Array(nb).fill(-1)
  for (let j = 0; j < nb; j++) back[j] = nearest(b.desc, j, a.desc, na)[0]
  const out: { x1: number; y1: number; x2: number; y2: number }[] = []
  for (let i = 0; i < na; i++) {
    const [j, d1, d2] = nearest(a.desc, i, b.desc, nb)
    if (j < 0 || d1 > 64 || d1 >= ratio * d2 || back[j] !== i) continue
    out.push({ x1: a.points[i].x, y1: a.points[i].y, x2: b.points[j].x, y2: b.points[j].y })
  }
  return out
}
