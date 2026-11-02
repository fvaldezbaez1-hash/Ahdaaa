// Straight line segments in a grey image, after LSD (Grompone von Gioi et
// al., "LSD: a Line Segment Detector", IPOL 2012), simplified: pixels whose
// gradient is strong enough are grown into regions of similar level-line
// direction (±22.5°), each region is fitted with a rectangle, and thin,
// long, dense rectangles become segments. No a-contrario validation; the
// Upright solver is robust to the occasional false segment.

export interface Segment {
  x1: number
  y1: number
  x2: number
  y2: number
  /** Length in pixels (the solver weights by it). */
  length: number
  /** Mean gradient magnitude along it (contrast). */
  strength: number
}

const TAU = Math.PI / 8 // 22.5°

/** Light Gaussian blur (σ ≈ 0.6 px … 1 px) so jpeg blocks and noise don't fragment regions. */
function blur(src: Float32Array, w: number, h: number): Float32Array {
  const k = [0.25, 0.5, 0.25]
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      tmp[i] = k[0] * src[y * w + Math.max(0, x - 1)] + k[1] * src[i] + k[2] * src[y * w + Math.min(w - 1, x + 1)]
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      out[i] = k[0] * tmp[Math.max(0, y - 1) * w + x] + k[1] * tmp[i] + k[2] * tmp[Math.min(h - 1, y + 1) * w + x]
    }
  return out
}

/**
 * Line segments in a grey image (values about 0…1, perceptual). Coordinates
 * are pixel positions (pixel centres at i + 0.5).
 * @param minLength shortest segment kept, in pixels.
 */
export function detectSegments(grey: Float32Array, w: number, h: number, minLength = Math.max(12, Math.round(Math.max(w, h) / 40))): Segment[] {
  const img = blur(grey, w, h)
  const n = w * h
  const mag = new Float32Array(n)
  const ang = new Float32Array(n)
  // LSD's 2×2 gradient; the level-line angle is perpendicular to the gradient.
  for (let y = 0; y < h - 1; y++)
    for (let x = 0; x < w - 1; x++) {
      const i = y * w + x
      const a = img[i], b = img[i + 1], c = img[i + w], d = img[i + w + 1]
      const gx = (b + d - a - c) / 2
      const gy = (c + d - a - b) / 2
      mag[i] = Math.hypot(gx, gy)
      ang[i] = Math.atan2(gx, -gy)
    }
  // Gradients weaker than LSD's quantization-noise bound (q = 2 on 0…255) are undefined.
  const rho = 2 / 255 / Math.sin(TAU)
  const used = new Uint8Array(n)
  for (let i = 0; i < n; i++) if (mag[i] <= rho) used[i] = 2
  for (let y = 0; y < h; y++) used[y * w + w - 1] = 2
  for (let x = 0; x < w; x++) used[(h - 1) * w + x] = 2

  // Seeds from strongest to weakest (bucketed, like LSD's pseudo-ordering).
  let maxMag = 0
  for (let i = 0; i < n; i++) if (used[i] === 0 && mag[i] > maxMag) maxMag = mag[i]
  const BINS = 1024
  const counts = new Uint32Array(BINS + 1)
  for (let i = 0; i < n; i++) if (used[i] === 0) counts[Math.min(BINS - 1, Math.floor((mag[i] / maxMag) * BINS))]++
  for (let b = BINS - 1; b >= 0; b--) counts[b] += counts[b + 1]
  const order = new Int32Array(counts[0])
  // Bin b fills order[counts[b + 1] … counts[b]), so the strongest bins come first.
  const pos = counts.slice()
  for (let i = 0; i < n; i++) if (used[i] === 0) order[--pos[Math.min(BINS - 1, Math.floor((mag[i] / maxMag) * BINS))]] = i

  const segments: Segment[] = []
  const region: number[] = []
  const aligned = (i: number, theta: number) => {
    let d = ang[i] - theta
    while (d > Math.PI) d -= 2 * Math.PI
    while (d < -Math.PI) d += 2 * Math.PI
    return Math.abs(d) <= TAU
  }
  for (let o = 0; o < order.length; o++) {
    const seed = order[o]
    if (used[seed]) continue
    region.length = 0
    region.push(seed)
    used[seed] = 1
    let sx = Math.cos(ang[seed]), sy = Math.sin(ang[seed])
    let theta = ang[seed]
    for (let r = 0; r < region.length; r++) {
      const p = region[r]
      const px = p % w, py = (p - px) / w
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const qx = px + dx, qy = py + dy
          if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue
          const q = qy * w + qx
          if (used[q] || !aligned(q, theta)) continue
          used[q] = 1
          region.push(q)
          sx += Math.cos(ang[q])
          sy += Math.sin(ang[q])
          theta = Math.atan2(sy, sx)
        }
    }
    if (region.length < minLength) continue
    const seg = fitRectangle(region, w, mag)
    if (seg && seg.length >= minLength) segments.push(seg)
  }
  return segments
}

/** Weighted centre and principal axis of a region; accepted when it is a thin, well-filled rectangle. */
function fitRectangle(region: number[], w: number, mag: Float32Array): Segment | null {
  let sw = 0, cx = 0, cy = 0
  for (const p of region) {
    const m = mag[p]
    sw += m
    cx += m * ((p % w) + 0.5)
    cy += m * (Math.floor(p / w) + 0.5)
  }
  cx /= sw
  cy /= sw
  let ixx = 0, iyy = 0, ixy = 0
  for (const p of region) {
    const m = mag[p]
    const dx = (p % w) + 0.5 - cx, dy = Math.floor(p / w) + 0.5 - cy
    ixx += m * dx * dx
    iyy += m * dy * dy
    ixy += m * dx * dy
  }
  // Direction of the largest second moment.
  const t = 0.5 * Math.atan2(2 * ixy, ixx - iyy)
  const ux = Math.cos(t), uy = Math.sin(t)
  let l0 = Infinity, l1 = -Infinity, w0 = Infinity, w1 = -Infinity
  for (const p of region) {
    const dx = (p % w) + 0.5 - cx, dy = Math.floor(p / w) + 0.5 - cy
    const l = dx * ux + dy * uy, d = -dx * uy + dy * ux
    if (l < l0) l0 = l
    if (l > l1) l1 = l
    if (d < w0) w0 = d
    if (d > w1) w1 = d
  }
  const length = l1 - l0 + 1
  const width = w1 - w0 + 1
  // Thin and dense: a line's support region, not a blob or a texture patch.
  if (width > Math.max(3, length / 6) || region.length < 0.6 * length * Math.min(width, 2)) return null
  return { x1: cx + l0 * ux, y1: cy + l0 * uy, x2: cx + l1 * ux, y2: cy + l1 * uy, length, strength: sw / region.length }
}
