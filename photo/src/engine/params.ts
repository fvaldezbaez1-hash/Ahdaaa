// Recipe → plain numbers and lookup tables for the shaders. Pure (no GL), so
// it is unit-tested and shared by the interactive view and the export.

import { curveLut, isIdentity } from '../color/curve'
import { apply, IDENTITY, mul, OKLAB_M2, REC2020_TO_LMS, REC2020_TO_SRGB, SRGB_TO_REC2020, type Mat3, type Vec3 } from '../color/matrices'
import { rawWbRatio, relativeWbMatrix } from '../color/wb'
import { BAND_HUES, BANDS, type BandValues, type Detail, type EditRecipe, type Effects, type LocalLayer, type ProfileId, type Wheel } from '../edit/types'
import { buildFilmicLut, contrastExponent, FILMIC, type Filmic } from './tone'
import type { SourceColor } from './types'

/** Base rendering of a profile. For display sources only the relative tweaks apply ('color' = untouched). */
interface ProfileLook {
  /** RAW only: base-curve overrides. */
  filmic?: Partial<Filmic>
  /** −1…1, added to the sliders. */
  contrast?: number
  saturation?: number
  vibrance?: number
  blacks?: number
  /** Color mixer offsets in slider units. */
  sat?: Partial<BandValues>
  lum?: Partial<BandValues>
  mono?: boolean
}

const PROFILES: Record<ProfileId, ProfileLook> = {
  color: {},
  neutral: { contrast: -0.15, saturation: -0.08, filmic: { contrast: 1.02, shoulder: 2.1 } },
  vivid: { contrast: 0.15, saturation: 0.14, vibrance: 0.12 },
  portrait: { contrast: -0.08, filmic: { contrast: 1.06 }, sat: { red: -6, orange: -8 }, lum: { red: 3, orange: 7 } },
  landscape: { contrast: 0.08, vibrance: 0.06, sat: { yellow: 8, green: 18, aqua: 12, blue: 14 }, lum: { aqua: -4, blue: -6 } },
  flat: { contrast: -0.45, saturation: -0.2, blacks: 0.35, filmic: { contrast: 0.92 } },
  mono: { contrast: 0.06, mono: true },
}

/** RAW's camera-like default: a touch of color on top of the filmic curve. */
const RAW_VIBRANCE = 0.1

export const REC2020_LUMA: Vec3 = [0.2627002, 0.6779981, 0.0593017]

export interface InputTransform {
  raw: boolean
  /** Per-channel white-balance factors applied to the source (RAW). */
  wbMul: Vec3
  /** Applied after `wbMul` in the source's own primaries (relative WB of display sources). */
  pre: Mat3
  /** Input primaries → linear Rec.2020. */
  toWorking: Mat3
  /** Rec.2020 luminance expressed in input primaries. */
  luma: Vec3
}

export function inputTransform(color: SourceColor, wb: { temp: number; tint: number }): InputTransform {
  if (color.space === 'camera' && color.camXyz && color.shotMul && color.rgbCam) {
    const toWorking = mul(SRGB_TO_REC2020, color.rgbCam)
    return { raw: true, wbMul: rawWbRatio(color.camXyz, color.shotMul, wb.temp, wb.tint), pre: IDENTITY, toWorking, luma: lumaIn(toWorking) }
  }
  return { raw: false, wbMul: [1, 1, 1], pre: relativeWbMatrix(wb.temp, wb.tint), toWorking: SRGB_TO_REC2020, luma: lumaIn(SRGB_TO_REC2020) }
}

function lumaIn(m: Mat3): Vec3 {
  const [r, g, b] = REC2020_LUMA
  return [r * m[0] + g * m[3] + b * m[6], r * m[1] + g * m[4] + b * m[7], r * m[2] + g * m[5] + b * m[8]]
}

/** Full input transform of one pixel on the CPU (no highlight handling) — for Auto and dehaze. */
export function toWorkingSpace(t: InputTransform, v: Vec3): Vec3 {
  return apply(t.toWorking, apply(t.pre, [v[0] * t.wbMul[0], v[1] * t.wbMul[1], v[2] * t.wbMul[2]]))
}

/**
 * Local temperature / tint: log2 von Kries gains in OKLab's LMS for a full (±100) slider,
 * from the same relative white balance as the global JPEG sliders (the shader scales them
 * linearly — white balance is close to linear in mireds).
 */
function lmsLogGains(temp: number, tint: number): Vec3 {
  const m = mul(SRGB_TO_REC2020, mul(relativeWbMatrix(temp, tint), REC2020_TO_SRGB))
  const a = apply(REC2020_TO_LMS, apply(m, [1, 1, 1])), b = apply(REC2020_TO_LMS, [1, 1, 1])
  return [Math.log2(a[0] / b[0]), Math.log2(a[1] / b[1]), Math.log2(a[2] / b[2])]
}
export const WB_TEMP = lmsLogGains(100, 0)
export const WB_TINT = lmsLogGains(0, 100)

export const HUE_LUT_SIZE = 360

/** Partition-of-unity weights of the 8 mixer bands at an OKLCh hue (degrees). */
export function bandWeights(h: number): number[] {
  const centers = BANDS.map((b) => BAND_HUES[b])
  const w = new Array<number>(BANDS.length).fill(0)
  const hh = ((h % 360) + 360) % 360
  for (let i = 0; i < centers.length; i++) {
    const a = centers[i], b = centers[(i + 1) % centers.length] + (i === centers.length - 1 ? 360 : 0)
    const x = hh < a ? hh + 360 : hh
    if (x >= a && x <= b) {
      const t = (x - a) / (b - a)
      const s = t * t * (3 - 2 * t)
      w[i] += 1 - s
      w[(i + 1) % centers.length] += s
      return w
    }
  }
  return w
}

/** RGBA per degree: hue shift (°), saturation factor, luminance gain, B&W luminance gain. */
export function buildHueLut(hue: BandValues, sat: BandValues, lum: BandValues, bw: BandValues): Float32Array {
  const out = new Float32Array(HUE_LUT_SIZE * 4)
  for (let d = 0; d < HUE_LUT_SIZE; d++) {
    const w = bandWeights(d)
    let dh = 0, s = 0, l = 0, k = 0
    BANDS.forEach((band, i) => {
      dh += w[i] * hue[band]
      s += w[i] * sat[band]
      l += w[i] * lum[band]
      k += w[i] * bw[band]
    })
    out.set([dh * 0.3, Math.max(0, 1 + s / 100), (l / 100) * 0.3, (k / 100) * 0.35], d * 4)
  }
  return out
}

/** Composite per-channel curves (channel ∘ master) as RGBA rows, or null when all are identity. */
export const CURVE_LUT_SIZE = 1024
export function buildCurveLut(c: EditRecipe['curve']): Float32Array | null {
  if (isIdentity(c.rgb) && isIdentity(c.r) && isIdentity(c.g) && isIdentity(c.b)) return null
  const n = CURVE_LUT_SIZE
  const master = curveLut(c.rgb, n)
  const ch = [curveLut(c.r, n), curveLut(c.g, n), curveLut(c.b, n)]
  const out = new Float32Array(n * 4)
  for (let i = 0; i < n; i++) {
    const f = master[i] * (n - 1), j = Math.floor(f), t = f - j, j1 = Math.min(n - 1, j + 1)
    for (let k = 0; k < 3; k++) out[i * 4 + k] = ch[k][j] + (ch[k][j1] - ch[k][j]) * t
    out[i * 4 + 3] = 1
  }
  return out
}

/** Unit OKLab (a, b) direction of an HSL hue (0 = red, 120 = green, 240 = blue), as on the grading wheels. */
export function wheelDirection(hueDeg: number): [number, number] {
  const h = (((hueDeg % 360) + 360) % 360) / 60
  const x = 1 - Math.abs((h % 2) - 1)
  const rgb: Vec3 = h < 1 ? [1, x, 0] : h < 2 ? [x, 1, 0] : h < 3 ? [0, 1, x] : h < 4 ? [0, x, 1] : h < 5 ? [x, 0, 1] : [1, 0, x]
  const lms = apply(REC2020_TO_LMS, apply(SRGB_TO_REC2020, rgb)).map(Math.cbrt) as Vec3
  const lab = apply(OKLAB_M2, lms)
  const len = Math.hypot(lab[1], lab[2]) || 1
  return [lab[1] / len, lab[2] / len]
}

function wheelVec(w: Wheel, lumScale: number): [number, number, number, number] {
  const [a, b] = wheelDirection(w.hue)
  const s = (w.sat / 100) * 0.1
  return [a * s, b * s, (w.lum / 100) * lumScale, 0]
}

export interface FrameParams {
  kind: 'raw' | 'display'
  input: InputTransform
  /** Stops. */
  exposure: number
  /** −1…1. */
  highlights: number
  shadows: number
  clarity: number
  texture: number
  dehaze: number
  /** RAW base curve LUT (display sources use an analytic highlight shoulder instead). */
  toneLut: Float32Array
  /** −1…1, incl. the profile's offsets. */
  contrast: number
  whites: number
  blacks: number
  /** See contrastExponent. */
  contrastExp: number
  saturation: number
  vibrance: number
  bw: boolean
  hueLut: Float32Array | null
  grading: { wheels: Float32Array; balance: number; k: number } | null
  /** OKLab L the blacks are lifted to. */
  fade: number
  curveLut: Float32Array | null
  detail: Detail
  effects: Effects
  /** The recipe's local layers (the pipeline renders the active ones). */
  layers: LocalLayer[]
  /** Cache keys: equal key ⇒ equal data. */
  keys: { input: string; tone: string; hue: string; curve: string }
}

const clamp1 = (x: number) => Math.max(-1, Math.min(1, x))
let lutCache: { key: string; lut: Float32Array } | null = null

export function frameParams(r: EditRecipe, color: SourceColor): FrameParams {
  const kind = color.space === 'camera' ? 'raw' : 'display'
  const p = PROFILES[r.profile] ?? PROFILES.color
  const b = r.basic
  const fm: Filmic = { ...FILMIC, ...p.filmic }
  const toneKey = JSON.stringify(fm)
  if (lutCache?.key !== toneKey) lutCache = { key: toneKey, lut: buildFilmicLut(fm) }

  const m = r.mixer
  const add = (v: BandValues, o?: Partial<BandValues>) => (o ? Object.fromEntries(BANDS.map((k) => [k, v[k] + (o[k] ?? 0)])) as BandValues : v)
  const sat = add(m.sat, p.sat), lum = add(m.lum, p.lum)
  const bw = r.treatment === 'bw' || !!p.mono
  const mixerActive = BANDS.some((k) => (bw ? m.bw[k] !== 0 : m.hue[k] !== 0 || sat[k] !== 0 || lum[k] !== 0))
  const hueKey = JSON.stringify([bw, m.hue, sat, lum, m.bw])

  const g = r.grading
  const wheels = [g.shadows, g.midtones, g.highlights, g.global]
  const gradingActive = wheels.some((w) => w.sat !== 0 || w.lum !== 0)
  const blend = Math.max(0, Math.min(100, g.blending))

  const input = inputTransform(color, r.wb)
  return {
    kind,
    input,
    exposure: b.exposure,
    highlights: clamp1(b.highlights / 100),
    shadows: clamp1(b.shadows / 100),
    clarity: clamp1(b.clarity / 100),
    texture: clamp1(b.texture / 100),
    dehaze: clamp1(b.dehaze / 100),
    toneLut: lutCache.lut,
    contrast: clamp1(b.contrast / 100 + (p.contrast ?? 0)),
    whites: clamp1(b.whites / 100),
    blacks: clamp1(b.blacks / 100 + (p.blacks ?? 0)),
    contrastExp: contrastExponent(kind, fm),
    saturation: clamp1(b.saturation / 100 + (p.saturation ?? 0)),
    vibrance: clamp1(b.vibrance / 100 + (p.vibrance ?? 0) + (kind === 'raw' ? RAW_VIBRANCE : 0)),
    bw,
    hueLut: mixerActive ? buildHueLut(m.hue, sat, lum, m.bw) : null,
    grading: gradingActive
      ? {
          wheels: new Float32Array([...wheelVec(g.shadows, 0.12), ...wheelVec(g.midtones, 0.1), ...wheelVec(g.highlights, 0.12), ...wheelVec(g.global, 0.1)]),
          balance: 2 ** (-clamp1(g.balance / 100)),
          k: blend <= 50 ? 4 - (blend / 50) * 2 : 2 - ((blend - 50) / 50) * 0.8,
        }
      : null,
    fade: (Math.max(0, Math.min(100, r.effects.fade)) / 100) * 0.25,
    curveLut: buildCurveLut(r.curve),
    detail: r.detail,
    effects: r.effects,
    layers: r.layers ?? [],
    keys: {
      input: JSON.stringify([input.wbMul, input.pre, kind]),
      tone: toneKey,
      hue: mixerActive ? hueKey : '',
      curve: JSON.stringify(r.curve),
    },
  }
}
