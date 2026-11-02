// The advanced color editor (Capture One style) on the CPU: slice membership
// and the per-range numbers the tone shader reads. Membership is measured on
// HSV of sRGB-encoded color — the same hue / saturation the picker reports
// (masks.ts hueSat) — and shifts are applied in OKLCh, where they look even.

import type { ColorRange } from '../edit/types'

const ss = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / Math.max(b - a, 1e-9)))
  return t * t * (3 - 2 * t)
}

/** Circular hue distance in degrees (0…180). */
export const hueDistance = (a: number, b: number) => Math.abs((((a - b) % 360) + 540) % 360 - 180)

/** Soft edges: `smooth` 0…100 → up to 30° of hue and 0.25 of saturation. */
const hueSoft = (r: ColorRange) => 1 + (r.smooth / 100) * 30
const satSoft = (r: ColorRange) => 0.01 + (r.smooth / 100) * 0.25

/** Below this saturation hue is mostly noise (gray clouds, white walls); membership fades out (GRAY_FADE in shaders.ts). */
const GRAY_FADE: [number, number] = [0.02, 0.08]

/** How much a color (HSV hue°, saturation 0…1) belongs to the range, 0…1, smooth (no banding). */
export function rangeMembership(r: ColorRange, h: number, s: number): number {
  const mh = 1 - ss(r.hueWidth, r.hueWidth + hueSoft(r), hueDistance(h, r.hue))
  const lo = r.satLow / 100, hi = r.satHigh / 100, k = satSoft(r)
  const ms = (lo <= 0 ? 1 : ss(lo - k, lo, s)) * (hi >= 1 ? 1 : 1 - ss(hi, hi + k, s))
  return mh * ms * ss(GRAY_FADE[0], GRAY_FADE[1], s)
}

/** Skin uniformity: hue and saturation pulled toward the picked color in proportion to membership m. */
export function uniformityPull(r: ColorRange, h: number, s: number, m: number): { h: number; s: number } {
  const u = r.uniformity
  if (!u) return { h, s }
  const d = ((((r.hue - h) % 360) + 540) % 360) - 180
  return { h: (h + d * m * (u.hue / 100) + 360) % 360, s: s + (r.sat / 100 - s) * m * (u.sat / 100) }
}

export const MAX_RANGES = 16

/**
 * Per enabled range, 4 × vec4 for the shader: (hue, sat, width, soft) with angles in radians,
 * (satLow, satHigh, satSoft, 1), (hueShift rad, satShift ±1, lightShift ±1, 0),
 * (uniformity hue, sat, light 0…1, 0).
 */
export function packRanges(ranges: ColorRange[] | undefined): { n: number; data: Float32Array } | null {
  const on = (ranges ?? []).filter((r) => r.enabled).slice(0, MAX_RANGES)
  if (!on.length) return null
  const rad = Math.PI / 180
  const data = new Float32Array(MAX_RANGES * 16)
  on.forEach((r, i) => {
    const u = r.uniformity
    data.set([
      r.hue * rad, r.sat / 100, r.hueWidth * rad, hueSoft(r) * rad,
      r.satLow / 100, r.satHigh / 100, satSoft(r), 1,
      r.hueShift * rad, r.satShift / 100, r.lightShift / 100, 0,
      (u?.hue ?? 0) / 100, (u?.sat ?? 0) / 100, (u?.light ?? 0) / 100, 0,
    ], i * 16)
  })
  return { n: on.length, data }
}
