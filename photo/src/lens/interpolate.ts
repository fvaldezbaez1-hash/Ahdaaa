// Calibration interpolation exactly as lensfun does it (lens.cpp:
// InterpolateDistortion / InterpolateTCA / InterpolateVignetting,
// auxfun.cpp: _lf_interpolate), plus the conversion of the database's
// coefficients to the photo's own normalization (mod-coord.cpp & co.:
// rescale_polynomial_coefficients).
//
// Database units: distortion and TCA radii are relative to half the shorter
// side of the sensor the lens was calibrated on (its crop factor and aspect
// ratio); vignetting radii to half that sensor's diagonal.
import type { CalibrationJson, DbLens } from './db'

export type DistortionModel = 'poly3' | 'poly5' | 'ptlens'

export interface Distortion {
  model: DistortionModel
  /** poly3: [k1]; poly5: [k1, k2]; ptlens: [a, b, c]. */
  terms: number[]
}

export interface Tca {
  model: 'linear' | 'poly3'
  /** [vr, vb, cr, cb, br, bb] (linear: [kr, kb, 0, 0, 0, 0]). */
  terms: number[]
}

/** _lf_interpolate: Hermite spline through y2 (t = 0) and y3 (t = 1); y1 / y4 null at the ends. */
export function hermite(y1: number | null, y2: number, y3: number, y4: number | null, t: number): number {
  const t2 = t * t, t3 = t2 * t
  const tg2 = y1 === null ? y3 - y2 : (y3 - y1) * 0.5
  const tg3 = y4 === null ? y3 - y2 : (y4 - y2) * 0.5
  return (2 * t3 - 3 * t2 + 1) * y2 + (t3 - 2 * t2 + t) * tg2 + (-2 * t3 + 3 * t2) * y3 + (t3 - t2) * tg3
}

/** The calibration set lensfun uses for a camera crop factor: the closest one whose crop the camera's isn't smaller than (by 4 %). */
export function calibrationFor(lens: DbLens, crop: number, has: (c: CalibrationJson) => boolean): CalibrationJson | null {
  let best: CalibrationJson | null = null
  let ratio = 1e6
  for (const c of lens.cal) {
    const r = crop / c.crop
    if (has(c) && r >= 0.96 && r < ratio) {
      ratio = r
      best = c
    }
  }
  return best
}

/**
 * The spline points around `focal`: [1] the nearest calibrated focal above, [2] the nearest
 * below, [0] / [3] the next ones out (lensfun's __insert_spline). Returns an exact hit alone.
 */
function splinePoints(points: number[][], focal: number): { exact: number[] | null; s: (number[] | null)[] } {
  const s: (number[] | null)[] = [null, null, null, null]
  const d = [-Infinity, -Infinity, Infinity, Infinity]
  for (const p of points) {
    const df = focal - p[0]
    if (df === 0) return { exact: p, s }
    if (df < 0) {
      if (df > d[1]) {
        d[0] = d[1]
        d[1] = df
        s[0] = s[1]
        s[1] = p
      } else if (df > d[0]) {
        d[0] = df
        s[0] = p
      }
    } else if (df < d[2]) {
      d[3] = d[2]
      d[2] = df
      s[3] = s[2]
      s[2] = p
    } else if (df < d[3]) {
      d[3] = df
      s[3] = p
    }
  }
  return { exact: null, s }
}

/**
 * Interpolate per-focal terms. Terms with a 1/focal law (`scaled(i)`) are
 * multiplied by their focal before and divided by the target focal after
 * (lensfun's __parameter_scales).
 */
function interpolateTerms(points: number[][], focal: number, count: number, scaled: (i: number) => boolean): number[] | null {
  const term = (p: number[], i: number) => p[i + 1] ?? 0
  const { exact, s } = splinePoints(points, focal)
  if (exact) return Array.from({ length: count }, (_, i) => term(exact, i))
  if (!s[1] || !s[2]) {
    const only = s[1] ?? s[2]
    return only ? Array.from({ length: count }, (_, i) => term(only, i)) : null
  }
  const [p0, p1, p2, p3] = s
  const t = (focal - p1![0]) / (p2![0] - p1![0])
  return Array.from({ length: count }, (_, i) => {
    const k = (p: number[] | null) => (p && scaled(i) ? p[0] : 1)
    const v = (p: number[] | null) => (p ? term(p, i) * k(p) : null)
    return hermite(v(p0), v(p1)!, v(p2)!, v(p3), t) / (scaled(i) ? focal : 1)
  })
}

const DIST_TERMS: Record<DistortionModel, number> = { poly3: 1, poly5: 2, ptlens: 3 }

/** lfLens::InterpolateDistortion, in database units. */
export function interpolateDistortion(lens: DbLens, crop: number, focal: number): (Distortion & { cal: CalibrationJson }) | null {
  const cal = calibrationFor(lens, crop, (c) => !!c.d?.length)
  if (!cal || !cal.dm) return null
  const terms = interpolateTerms(cal.d!, focal, DIST_TERMS[cal.dm], () => true)
  return terms ? { model: cal.dm, terms, cal } : null
}

/** lfLens::InterpolateTCA, in database units. */
export function interpolateTca(lens: DbLens, crop: number, focal: number): (Tca & { cal: CalibrationJson }) | null {
  const cal = calibrationFor(lens, crop, (c) => !!c.t?.length)
  if (!cal || !cal.tm) return null
  const terms = interpolateTerms(cal.t!, focal, 6, (i) => i >= 2)
  return terms ? { model: cal.tm, terms, cal } : null
}

/** lfLens::InterpolateVignetting (inverse distance weighting, p = 3.5), in database units. */
export function interpolateVignetting(lens: DbLens, crop: number, focal: number, aperture: number, distance: number): { k: [number, number, number]; cal: CalibrationJson } | null {
  const cal = calibrationFor(lens, crop, (c) => !!c.v?.length)
  if (!cal) return null
  const df = lens.maxFocal - lens.minFocal
  const fn = (f: number) => (df !== 0 ? (f - lens.minFocal) / df : f - lens.minFocal)
  const k: [number, number, number] = [0, 0, 0]
  let total = 0
  let nearest = Infinity
  for (const p of cal.v!) {
    const dist = Math.hypot(fn(p[0]) - fn(focal), 4 / p[1] - 4 / aperture, 0.1 / p[2] - 0.1 / distance)
    if (dist < 0.0001) return { k: [p[3], p[4], p[5]], cal }
    nearest = Math.min(nearest, dist)
    const w = Math.abs(1 / dist ** 3.5)
    for (let i = 0; i < 3; i++) k[i] += w * p[3 + i]
    total += w
  }
  if (nearest > 1 || !(total > 0)) return null
  return { k: [k[0] / total, k[1] / total, k[2] / total], cal }
}

// ---------- to the photo's own normalization ----------

const DIAG_35 = Math.hypot(36, 24)

/**
 * Factor q with r(database) = q · r(photo), where r(photo) is relative to half
 * the photo's shorter side (distortion, TCA) or half its diagonal (vignetting).
 */
export function radiusScale(cal: CalibrationJson, crop: number, aspect: number, kind: 'shortSide' | 'diagonal'): number {
  const photo = DIAG_35 / crop / 2 / (kind === 'shortSide' ? Math.hypot(aspect, 1) : 1)
  const db = DIAG_35 / cal.crop / 2 / (kind === 'shortSide' ? Math.hypot(cal.aspect, 1) : 1)
  return photo / db
}

/**
 * Distortion terms for radii relative to the photo's half shorter side. The
 * poly3 / ptlens models keep lensfun's form (r_d = r_u at r = 1) by dividing
 * out a uniform scale, which only changes the corrected image's size.
 */
export function rescaleDistortion(d: Distortion, q: number): Distortion {
  const t = d.terms
  if (d.model === 'poly5') return { model: 'poly5', terms: [t[0] * q ** 2, t[1] * q ** 4] }
  if (d.model === 'poly3') {
    const D = 1 - t[0] + t[0] * q ** 2
    return { model: 'poly3', terms: [(t[0] * q ** 2) / D] }
  }
  const [a, b, c] = t
  const D = a * q ** 3 + b * q ** 2 + c * q + (1 - a - b - c)
  return { model: 'ptlens', terms: [(a * q ** 3) / D, (b * q ** 2) / D, (c * q) / D] }
}

/** TCA poly3 per channel [v, c, b] (r_d = r_u · (v + c·r_u + b·r_u²)) for the photo's half shorter side. */
export function rescaleTca(t: Tca, q: number): { r: [number, number, number]; b: [number, number, number] } {
  const [vr, vb, cr, cb, br, bb] = t.terms
  return { r: [vr, cr * q, br * q * q], b: [vb, cb * q, bb * q * q] }
}

/** Vignetting pa k1…k3 for radii relative to the photo's half diagonal. */
export function rescaleVignetting(k: [number, number, number], q: number): [number, number, number] {
  return [k[0] * q ** 2, k[1] * q ** 4, k[2] * q ** 6]
}

// ---------- the models themselves (for tests, the solver and anyone who needs a point mapped) ----------

/** Distorted radius for an undistorted one (lensfun's forward models). Correction samples the photo here. */
export function distortRadius(model: DistortionModel, k: readonly number[], ru: number): number {
  const r2 = ru * ru
  if (model === 'poly3') return ru * (1 - k[0] + k[0] * r2)
  if (model === 'poly5') return ru * (1 + k[0] * r2 + k[1] * r2 * r2)
  return ru * (k[0] * r2 * ru + k[1] * r2 + k[2] * ru + 1 - k[0] - k[1] - k[2])
}

/** Vignetting gain at radius r (half-diagonal units): the photo is darker by this factor (lensfun "pa"). */
export function vignettingFactor(k: readonly number[], r: number): number {
  const r2 = r * r
  return 1 + k[0] * r2 + k[1] * r2 * r2 + k[2] * r2 * r2 * r2
}
