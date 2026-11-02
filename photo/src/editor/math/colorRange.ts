import type { ColorRange } from '../../edit/types'
import { hueDistance } from '../../engine/colorEditor'
import { hueSatToPoint, pointToHueSat } from './wheel'

// The color editor's slice on the hue / saturation wheel (Capture One style):
// a hue sector of ±hueWidth around the picked hue, between two saturations,
// with a soft edge. Hue wraps at 0/360.

export const wrapHue = (h: number) => ((h % 360) + 360) % 360
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export const HUE_WIDTH = { min: 1, max: 90 }
/** Satuation low and high never come closer than this. */
export const SAT_GAP = 4

/** A range around a picked color: a moderate slice, soft edges, nothing shifted yet. */
export function newRange(id: string, name: string, hue: number, sat: number, skin = false): ColorRange {
  return {
    id,
    name,
    enabled: true,
    hue: Math.round(wrapHue(hue)),
    sat: Math.round(clamp(sat, 0, 100)),
    hueWidth: skin ? 25 : 15,
    // Near-gray pixels have no real hue: a muted pick starts the slice at 40 % of its saturation, not at gray.
    satLow: Math.round(clamp(Math.max(sat - (skin ? 30 : 35), sat * 0.4), 0, 100 - SAT_GAP)),
    satHigh: Math.round(clamp(sat + (skin ? 30 : 35), SAT_GAP, 100)),
    smooth: 50,
    hueShift: 0,
    satShift: 0,
    lightShift: 0,
    ...(skin && { uniformity: { hue: 0, sat: 0, light: 0 } }),
  }
}

export type SliceHandle = 'center' | 'hueA' | 'hueB' | 'satLow' | 'satHigh'

/** Handle positions on a wheel of radius R (offsets from the center, y down). */
export function sliceHandles(r: ColorRange, R: number): Record<SliceHandle, { x: number; y: number }> {
  const midSat = (r.satLow + r.satHigh) / 2
  return {
    center: hueSatToPoint(r.hue, r.sat, R),
    hueA: hueSatToPoint(wrapHue(r.hue - r.hueWidth), midSat, R),
    hueB: hueSatToPoint(wrapHue(r.hue + r.hueWidth), midSat, R),
    satLow: hueSatToPoint(r.hue, r.satLow, R),
    satHigh: hueSatToPoint(r.hue, r.satHigh, R),
  }
}

/** The handle within `reach` of (x, y), nearest first. */
export function hitSlice(r: ColorRange, R: number, x: number, y: number, reach: number): SliceHandle | null {
  let best: SliceHandle | null = null, bestD = reach
  for (const [id, p] of Object.entries(sliceHandles(r, R)) as [SliceHandle, { x: number; y: number }][]) {
    const d = Math.hypot(p.x - x, p.y - y)
    if (d <= bestD) {
      best = id
      bestD = d
    }
  }
  return best
}

/** Drag a handle to the wheel point (x, y). Moving the center carries the saturation bounds along. */
export function dragSlice(r: ColorRange, h: SliceHandle, x: number, y: number, R: number): ColorRange {
  const { hue, sat } = pointToHueSat(x, y, R)
  switch (h) {
    case 'center': {
      const d = sat - r.sat
      const low = clamp(r.satLow + d, 0, 100 - SAT_GAP), high = clamp(r.satHigh + d, low + SAT_GAP, 100)
      return { ...r, hue: Math.round(wrapHue(hue)), sat: Math.round(sat), satLow: Math.round(low), satHigh: Math.round(high) }
    }
    case 'hueA':
    case 'hueB':
      return { ...r, hueWidth: Math.round(clamp(hueDistance(hue, r.hue), HUE_WIDTH.min, HUE_WIDTH.max)) }
    case 'satLow':
      return { ...r, satLow: Math.round(clamp(sat, 0, r.satHigh - SAT_GAP)) }
    case 'satHigh':
      return { ...r, satHigh: Math.round(clamp(sat, r.satLow + SAT_GAP, 100)) }
  }
}

/** True when a hue lies inside the slice's sector (edges included), across 0/360. */
export const hueInSlice = (r: ColorRange, h: number) => hueDistance(h, r.hue) <= r.hueWidth

/** SVG path of an annular sector from hue a to hue b (counter-clockwise on screen), radii r0…r1. */
export function sectorPath(cx: number, cy: number, a: number, b: number, r0: number, r1: number): string {
  const span = wrapHue(b - a) || 360
  const steps = Math.max(2, Math.ceil(span / 6))
  const pt = (h: number, r: number) => {
    const t = (h * Math.PI) / 180
    return `${(cx + Math.cos(t) * r).toFixed(2)} ${(cy - Math.sin(t) * r).toFixed(2)}`
  }
  const outer: string[] = [], inner: string[] = []
  for (let i = 0; i <= steps; i++) {
    const h = a + (span * i) / steps
    outer.push(pt(h, r1))
    inner.push(pt(h, r0))
  }
  return `M${outer.join('L')}L${inner.reverse().join('L')}Z`
}
