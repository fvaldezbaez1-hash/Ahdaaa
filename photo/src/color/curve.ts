// Tone curves: smooth monotone (Fritsch–Carlson) interpolation through the
// user's points, sampled into a lookup table the GPU reads.

export interface CurvePoint {
  x: number
  y: number
}

export const IDENTITY_CURVE: CurvePoint[] = [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
]

export function isIdentity(points: CurvePoint[]): boolean {
  return points.length === 2 && points[0].x === 0 && points[0].y === 0 && points[1].x === 1 && points[1].y === 1
}

/** Sorted, deduplicated, clamped copy of the points with the end points present. */
export function normalizeCurve(points: CurvePoint[]): CurvePoint[] {
  const p = points
    .map((q) => ({ x: Math.min(1, Math.max(0, q.x)), y: Math.min(1, Math.max(0, q.y)) }))
    .sort((a, b) => a.x - b.x)
    .filter((q, i, a) => i === 0 || q.x - a[i - 1].x > 1e-4)
  if (p.length === 0) return IDENTITY_CURVE.slice()
  if (p[0].x > 0) p.unshift({ x: 0, y: p[0].y })
  if (p[p.length - 1].x < 1) p.push({ x: 1, y: p[p.length - 1].y })
  return p
}

/** Evaluate the curve at `size` evenly spaced inputs in [0, 1]. */
export function curveLut(points: CurvePoint[], size = 256): Float32Array {
  const p = normalizeCurve(points)
  const n = p.length
  const out = new Float32Array(size)
  if (n === 2) {
    for (let i = 0; i < size; i++) {
      const x = i / (size - 1)
      out[i] = p[0].y + ((p[1].y - p[0].y) * (x - p[0].x)) / (p[1].x - p[0].x)
    }
    return out
  }
  const d = new Array<number>(n - 1)
  for (let i = 0; i < n - 1; i++) d[i] = (p[i + 1].y - p[i].y) / (p[i + 1].x - p[i].x)
  const m = new Array<number>(n)
  m[0] = d[0]
  m[n - 1] = d[n - 2]
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0
      m[i + 1] = 0
      continue
    }
    const a = m[i] / d[i], b = m[i + 1] / d[i]
    const s = a * a + b * b
    if (s > 9) {
      const t = 3 / Math.sqrt(s)
      m[i] = t * a * d[i]
      m[i + 1] = t * b * d[i]
    }
  }
  let k = 0
  for (let i = 0; i < size; i++) {
    const x = i / (size - 1)
    while (k < n - 2 && x > p[k + 1].x) k++
    const h = p[k + 1].x - p[k].x
    const t = Math.min(1, Math.max(0, (x - p[k].x) / h))
    const t2 = t * t, t3 = t2 * t
    const y = (2 * t3 - 3 * t2 + 1) * p[k].y + (t3 - 2 * t2 + t) * h * m[k] + (-2 * t3 + 3 * t2) * p[k + 1].y + (t3 - t2) * h * m[k + 1]
    out[i] = Math.min(1, Math.max(0, y))
  }
  return out
}
