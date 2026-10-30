// Global tone, applied on the GPU with Adobe's hue-preserving RGB method (curve
// the max and min channels, interpolate the middle one). The RAW base curve is a
// lookup table; contrast, whites and blacks are evaluated per pixel so local
// layers can add to them.
//
// Scene-referred input (linear, 0.18 = middle gray, may exceed 1) goes through
// the base curve — RAW: filmic with a soft shoulder; display sources: identity,
// plus a highlight shoulder only while exposure pushes values past 1 — then
// contrast, whites and blacks in a perceptual (γ 2.2) domain.

export const MID_GRAY = 0.18
const GAMMA = 2.2

/** Filmic base curve for RAW, defined in log2 space around middle gray. */
export interface Filmic {
  /** Log-log slope at middle gray. */
  contrast: number
  /** Display value (linear) middle gray maps to. */
  gray: number
  /** Asymptote of the shoulder; slightly above 1 so white is reached at a finite exposure. */
  white: number
  /** Shoulder sharpness. */
  shoulder: number
  /** Stops below gray where the slope relaxes to `toeSlope` (keeps deep shadows from crushing). */
  toe: number
  toeSlope: number
}

export const FILMIC: Filmic = { contrast: 1.12, gray: 0.2, white: 1.06, shoulder: 2.6, toe: -4, toeSlope: 1 }

const softplus = (x: number) => (x > 30 ? x : Math.log1p(Math.exp(x)))

export function filmic(x: number, f: Filmic): number {
  const u = Math.log2(x / MID_GRAY)
  const k = 1.5
  const a = f.contrast * u + ((f.contrast - f.toeSlope) * (softplus(-k * (u - f.toe)) - softplus(k * f.toe))) / k
  const vmax = Math.log2(f.white / f.gray)
  const v = a - (softplus(f.shoulder * (a - vmax)) - softplus(-f.shoulder * vmax)) / f.shoulder
  return Math.min(1, f.gray * 2 ** v)
}

/**
 * Display sources: identity up to a knee, then a smooth roll-off that maps
 * `xmax` (the brightest value exposure can produce) to 1. Identity when xmax ≤ 1.
 */
export function displayShoulder(x: number, xmax: number): number {
  if (xmax <= 1 || x <= 0) return Math.min(x, 1)
  const knee = Math.max(0.45, 1 - 0.5 * Math.log2(xmax))
  if (x <= knee) return x
  const n = (xmax - knee) / (1 - knee) // slope 1 at the knee
  const t = Math.min(1, (x - knee) / (xmax - knee))
  return knee + (1 - knee) * (1 - (1 - t) ** n)
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x))
const STEEP = 5.5

/**
 * Contrast S-curve on perceptual values with fixed end points: `pivot` is moved
 * to 0.5 by a power, a symmetric sigmoid (or its inverse, for negative amounts)
 * is blended in, and the power is undone — so the pivot stays put.
 */
export function contrastCurve(p: number, amount: number, pivot: number): number {
  if (amount === 0 || p <= 0 || p >= 1) return p
  const g = Math.log(0.5) / Math.log(pivot)
  const q = p ** g
  const s0 = sigmoid(-STEEP / 2), s1 = sigmoid(STEEP / 2)
  let target: number
  if (amount > 0) target = (sigmoid(STEEP * (q - 0.5)) - s0) / (s1 - s0)
  else {
    const y = s0 + q * (s1 - s0)
    target = 0.5 + Math.log(y / (1 - y)) / STEEP
  }
  const r = q + Math.abs(amount) * (target - q)
  return Math.min(1, Math.max(0, r)) ** (1 / g)
}

/** Whites move the top of the range (+ clips sooner), blacks the bottom (+ lifts). Monotonic for ±1. */
export function whitesBlacks(p: number, whites: number, blacks: number): number {
  return p + whites * 0.25 * p ** 3 + blacks * 0.12 * (1 - Math.min(1, p)) ** 5
}

export interface ToneSpec {
  kind: 'raw' | 'display'
  filmic: Filmic
  /** Brightest scene value exposure can produce (display sources' shoulder). */
  xmax: number
  /** −1…1 each. */
  contrast: number
  whites: number
  blacks: number
}

/** Exponent that moves the contrast pivot (middle gray through the base curve, perceptual) to 0.5. */
export function contrastExponent(kind: 'raw' | 'display', f: Filmic): number {
  const base = kind === 'raw' ? filmic(MID_GRAY, f) : MID_GRAY
  return Math.log(0.5) / Math.log(base ** (1 / GAMMA))
}

/** Reference implementation of the whole global curve (the shader evaluates the same steps). */
export function toneCurve(s: ToneSpec): (x: number) => number {
  const base = s.kind === 'raw' ? (x: number) => filmic(x, s.filmic) : (x: number) => displayShoulder(x, s.xmax)
  const pivot = base(MID_GRAY) ** (1 / GAMMA)
  return (x) => {
    if (x <= 0) return 0
    let p = base(x) ** (1 / GAMMA)
    p = contrastCurve(p, s.contrast, pivot)
    p = whitesBlacks(p, s.whites, s.blacks)
    return Math.min(1, Math.max(0, p)) ** GAMMA
  }
}

/** LUT over log2(x) ∈ [LUT_LOG_MIN, LUT_LOG_MAX]; below it the curve is extended linearly. */
export const LUT_SIZE = 2048
export const LUT_LOG_MIN = -22
export const LUT_LOG_MAX = 8

/** RAW base curve as a LUT the shader reads; contrast, whites and blacks are evaluated per pixel. */
export function buildFilmicLut(f: Filmic): Float32Array {
  const lut = new Float32Array(LUT_SIZE)
  for (let i = 0; i < LUT_SIZE; i++) lut[i] = filmic(2 ** (LUT_LOG_MIN + ((LUT_LOG_MAX - LUT_LOG_MIN) * i) / (LUT_SIZE - 1)), f)
  return lut
}

/** CPU twin of the shader's lookup (used by Auto and tests). */
export function sampleToneLut(lut: Float32Array, x: number): number {
  const x0 = 2 ** LUT_LOG_MIN
  if (x <= x0) return (x * lut[0]) / x0
  const f = Math.min(LUT_SIZE - 1, ((Math.log2(x) - LUT_LOG_MIN) * (LUT_SIZE - 1)) / (LUT_LOG_MAX - LUT_LOG_MIN))
  const i = Math.floor(f), j = Math.min(LUT_SIZE - 1, i + 1)
  return lut[i] + (lut[j] - lut[i]) * (f - i)
}
