// 3×3 color matrices (row-major) and the constants Lumen's pipeline uses.
//
// Working space: scene-referred LINEAR Rec.2020 primaries with a D65 white.
// It is wide enough for every camera color that matters, shares its white
// with sRGB / Display P3 (no adaptation on output), and OKLab is defined
// from D65 XYZ, so color tools work directly on it.

export type Vec3 = [number, number, number]
export type Mat3 = [number, number, number, number, number, number, number, number, number]

export function mat3(rows: number[][]): Mat3 {
  return [rows[0][0], rows[0][1], rows[0][2], rows[1][0], rows[1][1], rows[1][2], rows[2][0], rows[2][1], rows[2][2]]
}

export function mul(a: Mat3, b: Mat3): Mat3 {
  const o = new Array<number>(9)
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]
  return o as Mat3
}

export function apply(m: Mat3, v: Vec3): Vec3 {
  return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]]
}

export function inv(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g
  const det = a * A + b * B + c * C
  if (Math.abs(det) < 1e-12) throw new Error('Matrix is not invertible')
  const k = 1 / det
  return [A * k, -(b * i - c * h) * k, (b * f - c * e) * k, B * k, (a * i - c * g) * k, -(a * f - c * d) * k, C * k, -(a * h - b * g) * k, (a * e - b * d) * k]
}

export function diag(v: Vec3): Mat3 {
  return [v[0], 0, 0, 0, v[1], 0, 0, 0, v[2]]
}

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]

/** Linear sRGB (D65) → CIE XYZ (D65), IEC 61966-2-1. */
export const SRGB_TO_XYZ: Mat3 = [0.4123908, 0.35758434, 0.18048079, 0.21263901, 0.71516868, 0.07219232, 0.01933082, 0.11919478, 0.95053215]
export const XYZ_TO_SRGB = inv(SRGB_TO_XYZ)

/** Linear Rec.2020 (D65) → XYZ (D65), ITU-R BT.2020. */
export const REC2020_TO_XYZ: Mat3 = [0.63695805, 0.1446169, 0.16888098, 0.2627002, 0.67799807, 0.05930172, 0, 0.02807269, 1.06098506]
export const XYZ_TO_REC2020 = inv(REC2020_TO_XYZ)

/** Linear Display P3 (D65) → XYZ (D65). */
export const P3_TO_XYZ: Mat3 = [0.48657095, 0.26566769, 0.19821729, 0.22897456, 0.69173852, 0.07928691, 0, 0.04511338, 1.04394437]
export const XYZ_TO_P3 = inv(P3_TO_XYZ)

export const SRGB_TO_REC2020 = mul(XYZ_TO_REC2020, SRGB_TO_XYZ)
export const REC2020_TO_SRGB = mul(XYZ_TO_SRGB, REC2020_TO_XYZ)
export const REC2020_TO_P3 = mul(XYZ_TO_P3, REC2020_TO_XYZ)

/** OKLab (Björn Ottosson): XYZ(D65) → LMS, and cube-rooted LMS → Lab. */
export const OKLAB_M1: Mat3 = [0.8189330101, 0.3618667424, -0.1288597137, 0.0329845436, 0.9293118715, 0.0361456387, 0.0482003018, 0.2643662691, 0.633851707]
export const OKLAB_M2: Mat3 = [0.2104542553, 0.793617785, -0.0040720468, 1.9779984951, -2.428592205, 0.4505937099, 0.0259040371, 0.7827717662, -0.808675766]
/** Working space (linear Rec.2020) straight to OKLab's LMS. */
export const REC2020_TO_LMS = mul(OKLAB_M1, REC2020_TO_XYZ)
export const LMS_TO_REC2020 = inv(REC2020_TO_LMS)

/** Bradford cone response, for chromatic adaptation between white points. */
const BRADFORD: Mat3 = [0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296]
const BRADFORD_INV = inv(BRADFORD)

export function xyToXYZ(x: number, y: number): Vec3 {
  return [x / y, 1, (1 - x - y) / y]
}

export const D65_XY: [number, number] = [0.31271, 0.32902]
export const D50_XY: [number, number] = [0.34567, 0.3585]

/** XYZ→XYZ matrix that maps colors seen under white `from` to how they'd look under white `to`. */
export function adaptation(from: [number, number], to: [number, number]): Mat3 {
  const s = apply(BRADFORD, xyToXYZ(from[0], from[1]))
  const d = apply(BRADFORD, xyToXYZ(to[0], to[1]))
  return mul(BRADFORD_INV, mul(diag([d[0] / s[0], d[1] / s[1], d[2] / s[2]]), BRADFORD))
}

export function luminance2020(v: Vec3): number {
  return 0.2627002 * v[0] + 0.67799807 * v[1] + 0.05930172 * v[2]
}
