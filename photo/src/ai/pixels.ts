// Small image operations the AI tasks share: resizing, blurs, the guided
// filter (edge-aware mask refinement), morphology, connected regions and
// brush-stroke rasterization. Plain typed arrays, no DOM, unit-testable.
import type { BrushStroke } from '../edit/types'

/** Bilinear resize of an interleaved float image (pixel centres aligned). */
export function resize(src: Float32Array, w: number, h: number, nw: number, nh: number, channels = 1): Float32Array {
  const out = new Float32Array(nw * nh * channels)
  const sx = w / nw, sy = h / nh
  for (let y = 0; y < nh; y++) {
    const fy = Math.min(h - 1, Math.max(0, (y + 0.5) * sy - 0.5))
    const y0 = Math.floor(fy), y1 = Math.min(h - 1, y0 + 1), ty = fy - y0
    for (let x = 0; x < nw; x++) {
      const fx = Math.min(w - 1, Math.max(0, (x + 0.5) * sx - 0.5))
      const x0 = Math.floor(fx), x1 = Math.min(w - 1, x0 + 1), tx = fx - x0
      for (let c = 0; c < channels; c++) {
        const a = src[(y0 * w + x0) * channels + c], b = src[(y0 * w + x1) * channels + c]
        const d = src[(y1 * w + x0) * channels + c], e = src[(y1 * w + x1) * channels + c]
        out[(y * nw + x) * channels + c] = (a + (b - a) * tx) * (1 - ty) + (d + (e - d) * tx) * ty
      }
    }
  }
  return out
}

/** Area (box) downscale of an interleaved float image; falls back to bilinear when enlarging. */
export function downscale(src: Float32Array, w: number, h: number, nw: number, nh: number, channels = 1): Float32Array {
  if (nw >= w || nh >= h) return resize(src, w, h, nw, nh, channels)
  const out = new Float32Array(nw * nh * channels)
  const cnt = new Float32Array(nw * nh)
  for (let y = 0; y < h; y++) {
    const oy = Math.min(nh - 1, Math.floor((y * nh) / h))
    for (let x = 0; x < w; x++) {
      const o = oy * nw + Math.min(nw - 1, Math.floor((x * nw) / w))
      cnt[o]++
      for (let c = 0; c < channels; c++) out[o * channels + c] += src[(y * w + x) * channels + c]
    }
  }
  for (let o = 0; o < nw * nh; o++) for (let c = 0; c < channels; c++) out[o * channels + c] /= cnt[o] || 1
  return out
}

/** Size with the long edge at most `max` (never enlarges). */
export function fit(w: number, h: number, max: number): { width: number; height: number } {
  const s = Math.min(1, max / Math.max(w, h))
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) }
}

/** Mean over a (2r+1)² box, edges clamped. Separable running sums: O(1) per pixel. */
export function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  const n = 2 * r + 1
  for (let y = 0; y < h; y++) {
    const o = y * w
    let s = 0
    for (let i = -r; i <= r; i++) s += src[o + Math.min(w - 1, Math.max(0, i))]
    for (let x = 0; x < w; x++) {
      tmp[o + x] = s / n
      s += src[o + Math.min(w - 1, x + r + 1)] - src[o + Math.max(0, x - r)]
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

/**
 * Guided filter (He et al.): smooths `p` (a mask) while following the edges
 * of `guide` (grey 0…1). Mask boundaries snap to the photo's edges.
 */
export function guidedFilter(guide: Float32Array, p: Float32Array, w: number, h: number, r: number, eps: number): Float32Array {
  const n = w * h
  const ip = new Float32Array(n), ii = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    ip[i] = guide[i] * p[i]
    ii[i] = guide[i] * guide[i]
  }
  const mI = boxBlur(guide, w, h, r), mP = boxBlur(p, w, h, r), mIP = boxBlur(ip, w, h, r), mII = boxBlur(ii, w, h, r)
  const a = new Float32Array(n), b = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const varI = mII[i] - mI[i] * mI[i]
    a[i] = (mIP[i] - mI[i] * mP[i]) / (varI + eps)
    b[i] = mP[i] - a[i] * mI[i]
  }
  const mA = boxBlur(a, w, h, r), mB = boxBlur(b, w, h, r)
  const q = new Float32Array(n)
  for (let i = 0; i < n; i++) q[i] = Math.min(1, Math.max(0, mA[i] * guide[i] + mB[i]))
  return q
}

/** Grey (Rec.709 luma of the encoded values) from interleaved RGB. */
export function luma(rgb: Float32Array): Float32Array {
  const n = rgb.length / 3
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = 0.2126 * rgb[i * 3] + 0.7152 * rgb[i * 3 + 1] + 0.0722 * rgb[i * 3 + 2]
  return out
}

/** Max (dilate) or min (erode) over a (2r+1)² square, separable. */
export function morph(src: Float32Array, w: number, h: number, r: number, op: 'dilate' | 'erode'): Float32Array {
  if (r <= 0) return src.slice()
  const pick = op === 'dilate' ? Math.max : Math.min
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = src[y * w + x]
      for (let i = Math.max(0, x - r); i <= Math.min(w - 1, x + r); i++) v = pick(v, src[y * w + i])
      tmp[y * w + x] = v
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = tmp[y * w + x]
      for (let j = Math.max(0, y - r); j <= Math.min(h - 1, y + r); j++) v = pick(v, tmp[j * w + x])
      out[y * w + x] = v
    }
  return out
}

/**
 * Pixels connected (4-neighbourhood) to the seeds through pixels where
 * `inside` holds. Returns 1 for reached pixels.
 */
export function floodFrom(w: number, h: number, seeds: number[], inside: (i: number) => boolean): Uint8Array {
  const reached = new Uint8Array(w * h)
  const stack: number[] = []
  for (const s of seeds)
    if (inside(s) && !reached[s]) {
      reached[s] = 1
      stack.push(s)
    }
  while (stack.length) {
    const i = stack.pop()!
    const x = i % w
    const next = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i < w * (h - 1) ? i + w : -1]
    for (const j of next)
      if (j >= 0 && !reached[j] && inside(j)) {
        reached[j] = 1
        stack.push(j)
      }
  }
  return reached
}

/** Float 0…1 → 8-bit. */
export function toMask8(m: Float32Array): Uint8Array {
  const out = new Uint8Array(m.length)
  for (let i = 0; i < m.length; i++) out[i] = Math.round(Math.min(1, Math.max(0, m[i])) * 255)
  return out
}

/** Smoothstep remap of a soft mask: `lo`…`hi` → 0…1. */
export function contrast(m: Float32Array, lo: number, hi: number): Float32Array {
  const out = new Float32Array(m.length)
  for (let i = 0; i < m.length; i++) {
    const t = Math.min(1, Math.max(0, (m[i] - lo) / (hi - lo)))
    out[i] = t * t * (3 - 2 * t)
  }
  return out
}

/**
 * Where the strokes paint, at w × h pixels covering `area` (normalized source
 * coordinates) of a source `srcW` × `srcH`: 1 inside a stroke's radius
 * (feathered edge included), erase strokes clear it again. Radii are
 * fractions of the source's long edge.
 */
export function rasterizeStrokes(strokes: readonly BrushStroke[], area: { x: number; y: number; w: number; h: number }, w: number, h: number, srcW: number, srcH: number): Float32Array {
  const out = new Float32Array(w * h)
  const long = Math.max(srcW, srcH)
  // Pixel ↔ source pixels.
  const px = (area.w * srcW) / w, py = (area.h * srcH) / h
  for (const s of strokes) {
    const r = s.r * long
    const pts = s.points.map((p) => ({ x: p.x * srcW, y: p.y * srcH }))
    if (!pts.length) continue
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const p of pts) {
      x0 = Math.min(x0, p.x - r)
      y0 = Math.min(y0, p.y - r)
      x1 = Math.max(x1, p.x + r)
      y1 = Math.max(y1, p.y + r)
    }
    const ax = area.x * srcW, ay = area.y * srcH
    const i0 = Math.max(0, Math.floor((x0 - ax) / px)), i1 = Math.min(w - 1, Math.ceil((x1 - ax) / px))
    const j0 = Math.max(0, Math.floor((y0 - ay) / py)), j1 = Math.min(h - 1, Math.ceil((y1 - ay) / py))
    // Erasing keeps the soft rim of what was painted (only the hard core is cleared).
    const reach = s.erase ? r * (1 - (s.feather / 100) * 0.5) : r
    const r2 = reach * reach
    for (let j = j0; j <= j1; j++) {
      const cy = ay + (j + 0.5) * py
      for (let i = i0; i <= i1; i++) {
        const cx = ax + (i + 0.5) * px
        if (distToPolyline2(cx, cy, pts) <= r2) out[j * w + i] = s.erase ? 0 : 1
      }
    }
  }
  return out
}

function distToPolyline2(x: number, y: number, pts: { x: number; y: number }[]): number {
  if (pts.length === 1) return (x - pts[0].x) ** 2 + (y - pts[0].y) ** 2
  let best = Infinity
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1], b = pts[k]
    const dx = b.x - a.x, dy = b.y - a.y
    const len2 = dx * dx + dy * dy
    const t = len2 ? Math.min(1, Math.max(0, ((x - a.x) * dx + (y - a.y) * dy) / len2)) : 0
    const d = (x - a.x - t * dx) ** 2 + (y - a.y - t * dy) ** 2
    if (d < best) best = d
  }
  return best
}
