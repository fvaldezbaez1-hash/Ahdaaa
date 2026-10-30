import type { RetouchSpot } from '../../edit/types'
import type { Size } from '../../engine/geometry'
import type { Pt } from './space'

// Brush strokes and healing spots in mask coordinates (0…1 of the source;
// radii in units of its long edge).

/** The Size slider (1…100) covers 0.2 % … 25 % of the long edge, evenly in ratio. */
export const sizeToRadius = (size: number) => 0.002 * Math.pow(125, Math.min(100, Math.max(0, size)) / 100)
export const radiusToSize = (r: number) => Math.min(100, Math.max(0, (100 * Math.log(r / 0.002)) / Math.log(125)))

/** Distance between two mask points in long-edge units (x and y are normalized separately). */
export function maskDist(a: Pt, b: Pt, src: Size): number {
  const long = Math.max(src.width, src.height)
  return Math.hypot(((a.x - b.x) * src.width) / long, ((a.y - b.y) * src.height) / long)
}

/** Dabs closer than this fraction of the radius add nothing visible. */
const SPACING = 0.25

/** The stroke with p appended, or null when p is too close to the last point to matter. */
export function extendStroke(points: Pt[], p: Pt, r: number, src: Size): Pt[] | null {
  const last = points[points.length - 1]
  if (last && maskDist(last, p, src) < r * SPACING) return null
  return [...points, { x: p.x, y: p.y }]
}

/**
 * Where to copy from when the engine can't suggest a source: the first of
 * right, left, below, above (2.5 radii away) that stays on the photo.
 */
export function fallbackSource(x: number, y: number, r: number, src: Size): { sx: number; sy: number } {
  const long = Math.max(src.width, src.height)
  const dx = (2.5 * r * long) / src.width, dy = (2.5 * r * long) / src.height
  const mx = (r * long) / src.width, my = (r * long) / src.height
  const fits = (sx: number, sy: number) => sx - mx >= 0 && sx + mx <= 1 && sy - my >= 0 && sy + my <= 1
  for (const [sx, sy] of [[x + dx, y], [x - dx, y], [x, y + dy], [x, y - dy]]) if (fits(sx, sy)) return { sx, sy }
  return { sx: Math.min(1 - mx, Math.max(mx, x + dx)), sy: y }
}

/** Spots along a drag, one radius apart, all copying from the same offset. */
export function spotsAlong(first: RetouchSpot, path: Pt[], src: Size, newId: () => string): RetouchSpot[] {
  const out = [first]
  const ox = first.sx - first.x, oy = first.sy - first.y
  for (const p of path) {
    const last = out[out.length - 1]
    if (maskDist(last, p, src) < first.r) continue
    out.push({ ...first, id: newId(), x: p.x, y: p.y, sx: p.x + ox, sy: p.y + oy })
  }
  return out
}
