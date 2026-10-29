import { adaptation, apply, D65_XY, inv, mul, SRGB_TO_XYZ, XYZ_TO_SRGB, xyToXYZ, type Mat3, type Vec3 } from './matrices'

// White balance.
//
// RAW photos: temperature in Kelvin and tint (−150…+150) describe the light the
// photo was taken under, exactly like Lightroom/Capture One. They're turned into
// per-channel multipliers in the CAMERA's own color space (before the camera
// matrix), which is what keeps colors clean when white balance moves a lot.
//
// JPEG/PNG/HEIC: the camera already baked its white balance in, so temperature
// and tint are relative (−100…+100) and applied as a chromatic adaptation.
//
// Temperature/tint ↔ chromaticity uses Robertson's isotemperature lines, the
// same method (and tint scale) as Adobe's DNG SDK, so numbers feel familiar.

const TINT_SCALE = -3000

// [mired, u, v, slope] — Robertson (1968), with the W&S 325-mired correction.
const TABLE: [number, number, number, number][] = [
  [0, 0.18006, 0.26352, -0.24341], [10, 0.18066, 0.26589, -0.25479], [20, 0.18133, 0.26846, -0.26876],
  [30, 0.18208, 0.27119, -0.28539], [40, 0.18293, 0.27407, -0.3047], [50, 0.18388, 0.27709, -0.32675],
  [60, 0.18494, 0.28021, -0.35156], [70, 0.18611, 0.28342, -0.37915], [80, 0.1874, 0.28668, -0.40955],
  [90, 0.1888, 0.28997, -0.44278], [100, 0.19032, 0.29326, -0.47888], [125, 0.19462, 0.30141, -0.58204],
  [150, 0.19962, 0.30921, -0.70471], [175, 0.20525, 0.31647, -0.84901], [200, 0.21142, 0.32312, -1.0182],
  [225, 0.21807, 0.32909, -1.2168], [250, 0.22511, 0.33439, -1.4512], [275, 0.23247, 0.33904, -1.7298],
  [300, 0.2401, 0.34308, -2.0637], [325, 0.24792, 0.34655, -2.4681], [350, 0.25591, 0.34951, -2.9641],
  [375, 0.264, 0.352, -3.5814], [400, 0.27218, 0.35407, -4.3633], [425, 0.28039, 0.35577, -5.3762],
  [450, 0.28863, 0.35714, -6.7262], [475, 0.29685, 0.35823, -8.5955], [500, 0.30505, 0.35907, -11.324],
  [525, 0.3132, 0.35968, -15.628], [550, 0.32129, 0.36011, -23.325], [575, 0.32931, 0.36038, -40.77],
  [600, 0.33724, 0.36051, -116.45],
]

export const TEMP_MIN = 2000
export const TEMP_MAX = 50000
export const TINT_MIN = -150
export const TINT_MAX = 150

/** CIE xy chromaticity of the light described by a temperature (K) and tint. */
export function xyFromTempTint(temp: number, tint: number): [number, number] {
  const r = 1e6 / Math.min(1e7, Math.max(1000, temp))
  const offset = tint / TINT_SCALE
  for (let i = 0; i < TABLE.length - 1; i++) {
    if (r < TABLE[i + 1][0] || i === TABLE.length - 2) {
      const f = (TABLE[i + 1][0] - r) / (TABLE[i + 1][0] - TABLE[i][0])
      let u = TABLE[i][1] * f + TABLE[i + 1][1] * (1 - f)
      let v = TABLE[i][2] * f + TABLE[i + 1][2] * (1 - f)
      const l1 = Math.hypot(1, TABLE[i][3]), l2 = Math.hypot(1, TABLE[i + 1][3])
      let du = (1 / l1) * f + (1 / l2) * (1 - f)
      let dv = (TABLE[i][3] / l1) * f + (TABLE[i + 1][3] / l2) * (1 - f)
      const l3 = Math.hypot(du, dv)
      du /= l3
      dv /= l3
      u += du * offset
      v += dv * offset
      const d = u - 4 * v + 2
      return [(1.5 * u) / d, v / d]
    }
  }
  return [0.31271, 0.32902]
}

/** Temperature (K) and tint of the light with chromaticity xy. */
export function tempTintFromXy(x: number, y: number): { temp: number; tint: number } {
  const den = 1.5 - x + 6 * y
  const u = (2 * x) / den, v = (3 * y) / den
  let lastDt = 0, lastDu = 0, lastDv = 0
  for (let i = 1; i < TABLE.length; i++) {
    const len = Math.hypot(1, TABLE[i][3])
    let du = 1 / len, dv = TABLE[i][3] / len
    let uu = u - TABLE[i][1], vv = v - TABLE[i][2]
    let dt = -uu * dv + vv * du
    if (dt <= 0 || i === TABLE.length - 1) {
      if (dt > 0) dt = 0
      dt = -dt
      const f = i === 1 ? 0 : dt / (lastDt + dt)
      const temp = 1e6 / (TABLE[i - 1][0] * f + TABLE[i][0] * (1 - f))
      uu = u - (TABLE[i - 1][1] * f + TABLE[i][1] * (1 - f))
      vv = v - (TABLE[i - 1][2] * f + TABLE[i][2] * (1 - f))
      du = du * (1 - f) + lastDu * f
      dv = dv * (1 - f) + lastDv * f
      const l = Math.hypot(du, dv)
      return { temp: Math.min(TEMP_MAX, Math.max(TEMP_MIN, temp)), tint: ((uu * du) / l + (vv * dv) / l) * TINT_SCALE }
    }
    lastDt = dt
    lastDu = du
    lastDv = dv
  }
  return { temp: 6504, tint: 0 }
}

function normG(v: Vec3): Vec3 {
  return [v[0] / v[1], 1, v[2] / v[1]]
}

/**
 * Camera white-balance multipliers (green = 1) that make light of the given
 * temperature/tint neutral. `camXyz` maps XYZ to camera RGB (LibRaw `cam_xyz`).
 */
export function cameraMultipliers(camXyz: Mat3, temp: number, tint: number): Vec3 {
  const [x, y] = xyFromTempTint(temp, tint)
  const n = apply(camXyz, xyToXYZ(x, y))
  return normG([1 / n[0], 1 / n[1], 1 / n[2]])
}

/** The temperature/tint that a set of camera multipliers corresponds to (e.g. the camera's as-shot WB). */
export function tempTintFromMultipliers(camXyz: Mat3, mul: Vec3): { temp: number; tint: number } {
  const xyz = apply(inv(camXyz), [1 / mul[0], 1 / mul[1], 1 / mul[2]])
  const s = xyz[0] + xyz[1] + xyz[2]
  return tempTintFromXy(xyz[0] / s, xyz[1] / s)
}

/**
 * Per-channel factors to apply to RAW data that already carries the as-shot
 * multipliers `shotMul`, to move it to temperature/tint (green stays 1).
 */
export function rawWbRatio(camXyz: Mat3, shotMul: Vec3, temp: number, tint: number): Vec3 {
  const m = cameraMultipliers(camXyz, temp, tint)
  return [m[0] / shotMul[0], 1, m[2] / shotMul[2]]
}

/** Temperature/tint that makes a sampled RAW pixel (as-shot balanced camera RGB) neutral. */
export function rawWbForNeutral(camXyz: Mat3, shotMul: Vec3, sample: Vec3): { temp: number; tint: number } {
  const cam: Vec3 = [sample[0] / shotMul[0], sample[1] / shotMul[1], sample[2] / shotMul[2]]
  return tempTintFromMultipliers(camXyz, [1 / cam[0], 1 / cam[1], 1 / cam[2]])
}

// ---- Display-referred (JPEG etc.): relative −100…+100 sliders ----

const D65_MIRED = 1e6 / 6504
/** Mired change per slider unit; ±100 spans roughly 3,900 K … 18,600 K of assumed light. */
const MIRED_PER_UNIT = 1.0
const TINT_PER_UNIT = 1.0

/** Light the relative sliders say the scene was lit by (D65 at 0/0). */
export function relativeLightXy(temp: number, tint: number): [number, number] {
  // Positive temperature = warmer result, i.e. the light is assumed bluer (higher K).
  const mired = Math.max(5, D65_MIRED - temp * MIRED_PER_UNIT)
  // Positive tint = more magenta result, i.e. the light is assumed greener.
  return xyFromTempTint(1e6 / mired, tint * TINT_PER_UNIT + tempTintFromXy(D65_XY[0], D65_XY[1]).tint)
}

/** Linear-sRGB → linear-sRGB matrix for the relative white-balance sliders. */
export function relativeWbMatrix(temp: number, tint: number): Mat3 {
  if (temp === 0 && tint === 0) return [1, 0, 0, 0, 1, 0, 0, 0, 1]
  return mul(XYZ_TO_SRGB, mul(adaptation(relativeLightXy(temp, tint), D65_XY), SRGB_TO_XYZ))
}

/** Relative temperature/tint that make a linear-sRGB pixel neutral (eyedropper / auto WB on JPEGs). */
export function relativeWbForNeutral(rgb: Vec3): { temp: number; tint: number } {
  const xyz = apply(SRGB_TO_XYZ, rgb)
  const s = xyz[0] + xyz[1] + xyz[2]
  if (!(s > 0)) return { temp: 0, tint: 0 }
  const { temp, tint } = tempTintFromXy(xyz[0] / s, xyz[1] / s)
  const base = tempTintFromXy(D65_XY[0], D65_XY[1]).tint
  const t = (D65_MIRED - 1e6 / temp) / MIRED_PER_UNIT
  const c = (tint - base) / TINT_PER_UNIT
  return { temp: Math.round(Math.max(-100, Math.min(100, t))), tint: Math.round(Math.max(-100, Math.min(100, c))) }
}

/** Common light sources, in Kelvin / tint, for the RAW white-balance menu. */
export const WB_PRESETS: Record<'daylight' | 'cloudy' | 'shade' | 'tungsten' | 'fluorescent' | 'flash', { temp: number; tint: number }> = {
  daylight: { temp: 5500, tint: 10 },
  cloudy: { temp: 6500, tint: 10 },
  shade: { temp: 7500, tint: 10 },
  tungsten: { temp: 2850, tint: 0 },
  fluorescent: { temp: 3800, tint: 21 },
  flash: { temp: 5500, tint: 0 },
}

/**
 * Shift a white balance by relative units (used by presets and "warmer/cooler"
 * variations so they work on RAW and JPEG alike). RAW: 1 unit = 1 mired.
 */
export function shiftWb(kind: 'raw' | 'display', wb: { temp: number; tint: number }, dTemp: number, dTint: number): { temp: number; tint: number } {
  if (kind === 'display')
    return { temp: Math.max(-100, Math.min(100, wb.temp + dTemp)), tint: Math.max(-100, Math.min(100, wb.tint + dTint)) }
  const mired = 1e6 / wb.temp - dTemp * MIRED_PER_UNIT
  return {
    temp: Math.round(Math.min(TEMP_MAX, Math.max(TEMP_MIN, 1e6 / Math.max(20, mired)))),
    tint: Math.round(Math.min(TINT_MAX, Math.max(TINT_MIN, wb.tint + dTint))),
  }
}
