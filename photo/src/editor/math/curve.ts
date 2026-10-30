import { curveLut, normalizeCurve, type CurvePoint } from '../../color/curve'

// Point editing for the tone curve. End points keep x at 0 and 1 (only their
// output moves); inner points stay strictly between their neighbors.

/** Closest gap allowed between neighboring points on the input axis. */
export const MIN_GAP = 0.02

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** Value of the curve at x. */
export function evalCurve(points: CurvePoint[], x: number): number {
  const lut = curveLut(points, 1024)
  return lut[Math.round(clamp01(x) * 1023)]
}

/** Add a point at x on the current curve (so the curve doesn't jump). Returns the new list and the point's index. */
export function insertPoint(points: CurvePoint[], x: number): { points: CurvePoint[]; index: number } {
  const p = normalizeCurve(points)
  const nx = clamp01(x)
  const i = p.findIndex((q) => q.x > nx)
  if (i <= 0 || nx - p[i - 1].x < MIN_GAP || p[i].x - nx < MIN_GAP) return { points: p, index: -1 }
  const next = [...p.slice(0, i), { x: nx, y: evalCurve(p, nx) }, ...p.slice(i)]
  return { points: next, index: i }
}

/** Move point `i`, kept between its neighbors and inside the box. */
export function movePoint(points: CurvePoint[], i: number, x: number, y: number): CurvePoint[] {
  const p = points.slice()
  const last = p.length - 1
  const nx = i === 0 ? 0 : i === last ? 1 : Math.min(p[i + 1].x - MIN_GAP, Math.max(p[i - 1].x + MIN_GAP, x))
  p[i] = { x: nx, y: clamp01(y) }
  return p
}

/** Remove an inner point (end points stay). */
export function removePoint(points: CurvePoint[], i: number): CurvePoint[] {
  if (i <= 0 || i >= points.length - 1) return points
  return points.filter((_, k) => k !== i)
}

/** Index of the point nearest (x, y) within `radius` (all in 0…1 units), or −1. */
export function nearestPoint(points: CurvePoint[], x: number, y: number, radius: number): number {
  let best = -1, bestD = radius
  points.forEach((p, i) => {
    const d = Math.hypot(p.x - x, p.y - y)
    if (d <= bestD) {
      best = i
      bestD = d
    }
  })
  return best
}
