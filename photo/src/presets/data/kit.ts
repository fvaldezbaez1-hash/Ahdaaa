// Shorthand for writing looks. Values are deltas on top of the photo's own
// settings (see presets/apply.ts); keep exposure and white balance moves small
// so a look holds up across photos, and get the character from curves,
// grading and the color mixer.
import type { CurvePoint, PresetData, Wheel } from '../../edit/types'

export interface LookDef {
  /** Unique within its collection; the preset id is `${collection}-${slug}`. */
  slug: string
  name: string
  description: string
  tags: string[]
  data: PresetData
}

export interface CollectionDef {
  id: string
  name: string
  description: string
  looks: LookDef[]
}

/** Curve points from x, y pairs (0…1). */
export function pts(...xy: number[]): CurvePoint[] {
  const out: CurvePoint[] = []
  for (let i = 0; i + 1 < xy.length; i += 2) out.push({ x: xy[i], y: xy[i + 1] })
  return out
}

/**
 * A tone curve from four ideas: `lift` raises the black point (matte),
 * `s` adds S-shaped contrast, `roll` lowers the white point (soft highlights),
 * `mid` brightens (+) or darkens (−) the midtones.
 */
export function tc(lift: number, s = 0, roll = 0, mid = 0): CurvePoint[] {
  return pts(0, lift, 0.25, 0.25 - s + lift * 0.35 + mid * 0.6, 0.5, 0.5 + mid, 0.75, 0.75 + s - roll * 0.35 + mid * 0.6, 1, 1 - roll)
}

/** A straight channel curve from `y0` at black to `y1` at white, optionally bent at the midpoint. */
export function lin(y0: number, y1: number, mid?: number): CurvePoint[] {
  return mid === undefined ? pts(0, y0, 1, y1) : pts(0, y0, 0.5, mid, 1, y1)
}

/** A grading wheel: hue 0…360, sat 0…100, lum −100…100. */
export const w = (hue: number, sat: number, lum = 0): Wheel => ({ hue, sat, lum })

export const look = (slug: string, name: string, description: string, tags: string[], data: PresetData): LookDef => ({ slug, name, description, tags, data })
