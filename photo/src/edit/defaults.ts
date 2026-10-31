import { IDENTITY_CURVE } from '../color/curve'
import { BANDS, type Band, type BandValues, type Basic, type Detail, type EditRecipe, type Effects, type Grading, type LensCorrection, type Levels, type LocalAdjust, type SourceKind, type Wheel } from './types'

export const zeroBands = (): BandValues => Object.fromEntries(BANDS.map((b) => [b, 0])) as Record<Band, number>
const wheel = (): Wheel => ({ hue: 0, sat: 0, lum: 0 })

export const DEFAULT_BASIC: Basic = {
  exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
  texture: 0, clarity: 0, dehaze: 0, vibrance: 0, saturation: 0,
}

export const DEFAULT_DETAIL: Detail = { sharpen: 40, radius: 1, detail: 25, masking: 0, noise: 0, noiseDetail: 50, colorNoise: 25 }
/** JPEGs were already sharpened and denoised by the camera. */
export const DEFAULT_DETAIL_DISPLAY: Detail = { sharpen: 0, radius: 1, detail: 25, masking: 0, noise: 0, noiseDetail: 50, colorNoise: 0 }

export const DEFAULT_EFFECTS: Effects = {
  vignette: 0, vignetteMidpoint: 50, vignetteRoundness: 0, vignetteFeather: 50,
  grain: 0, grainSize: 25, grainRoughness: 50, fade: 0,
}

export const defaultGrading = (): Grading => ({ shadows: wheel(), midtones: wheel(), highlights: wheel(), global: wheel(), blending: 50, balance: 0 })

/** A fresh recipe. RAW photos start at the camera's as-shot white balance. */
const LEVELS_IDENTITY = { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 }
export const defaultLevels = (): Levels => ({ rgb: { ...LEVELS_IDENTITY }, r: { ...LEVELS_IDENTITY }, g: { ...LEVELS_IDENTITY }, b: { ...LEVELS_IDENTITY } })

export const defaultLens = (): LensCorrection => ({
  enabled: false,
  profileId: '',
  vignetting: null,
  tca: null,
  autoCA: false,
  manualVignetting: 0,
  manualVignettingMidpoint: 50,
  defringe: { purple: 0, purpleHue: [270, 330], green: 0, greenHue: [70, 120] },
})

export function defaultRecipe(kind: SourceKind, asShot?: { temp: number; tint: number }): EditRecipe {
  return {
    v: 1,
    profile: 'color',
    treatment: 'color',
    wb: kind === 'raw' ? { preset: 'asShot', temp: Math.round(asShot?.temp ?? 5500), tint: Math.round(asShot?.tint ?? 0) } : { preset: 'asShot', temp: 0, tint: 0 },
    basic: { ...DEFAULT_BASIC },
    curve: { rgb: IDENTITY_CURVE.slice(), r: IDENTITY_CURVE.slice(), g: IDENTITY_CURVE.slice(), b: IDENTITY_CURVE.slice() },
    levels: defaultLevels(),
    mixer: { hue: zeroBands(), sat: zeroBands(), lum: zeroBands(), bw: zeroBands() },
    colorEditor: [],
    grading: defaultGrading(),
    detail: kind === 'raw' ? { ...DEFAULT_DETAIL } : { ...DEFAULT_DETAIL_DISPLAY },
    effects: { ...DEFAULT_EFFECTS },
    lens: defaultLens(),
    geometry: { crop: { x: 0, y: 0, w: 1, h: 1 }, angle: 0, rotate: 0, flipH: false, flipV: false, aspect: 'original' },
    retouch: [],
    layers: [],
  }
}

/** Fill in anything missing (older versions, hand-made or imported data). */
export function normalizeRecipe(r: Partial<EditRecipe> | undefined, kind: SourceKind, asShot?: { temp: number; tint: number }): EditRecipe {
  const d = defaultRecipe(kind, asShot)
  if (!r) return d
  return {
    ...d,
    ...r,
    v: 1,
    wb: { ...d.wb, ...r.wb },
    basic: { ...d.basic, ...r.basic },
    curve: { ...d.curve, ...r.curve },
    levels: { rgb: { ...d.levels.rgb, ...r.levels?.rgb }, r: { ...d.levels.r, ...r.levels?.r }, g: { ...d.levels.g, ...r.levels?.g }, b: { ...d.levels.b, ...r.levels?.b } },
    colorEditor: r.colorEditor ?? [],
    mixer: {
      hue: { ...d.mixer.hue, ...r.mixer?.hue },
      sat: { ...d.mixer.sat, ...r.mixer?.sat },
      lum: { ...d.mixer.lum, ...r.mixer?.lum },
      bw: { ...d.mixer.bw, ...r.mixer?.bw },
    },
    grading: {
      ...d.grading,
      ...r.grading,
      shadows: { ...d.grading.shadows, ...r.grading?.shadows },
      midtones: { ...d.grading.midtones, ...r.grading?.midtones },
      highlights: { ...d.grading.highlights, ...r.grading?.highlights },
      global: { ...d.grading.global, ...r.grading?.global },
    },
    detail: { ...d.detail, ...r.detail },
    effects: { ...d.effects, ...r.effects },
    lens: { ...d.lens, ...r.lens, defringe: { ...d.lens.defringe, ...r.lens?.defringe } },
    geometry: { ...d.geometry, ...r.geometry, crop: { ...d.geometry.crop, ...r.geometry?.crop } },
    retouch: r.retouch ?? [],
    layers: r.layers ?? [],
  }
}

/** True when the recipe would render the photo exactly as imported. */
export function isUnedited(r: EditRecipe, kind: SourceKind, asShot?: { temp: number; tint: number }): boolean {
  const d = defaultRecipe(kind, asShot)
  return JSON.stringify({ ...r, look: undefined }) === JSON.stringify({ ...d, look: undefined })
}

export interface SliderSpec {
  min: number
  max: number
  step: number
  /** Decimal places shown. */
  dp?: number
  unit?: string
}

/** Slider ranges for every scalar field, keyed by recipe path (e.g. 'basic.exposure'). */
export const SPECS: Record<string, SliderSpec> = {
  'basic.exposure': { min: -5, max: 5, step: 0.01, dp: 2 },
  'basic.contrast': { min: -100, max: 100, step: 1 },
  'basic.highlights': { min: -100, max: 100, step: 1 },
  'basic.shadows': { min: -100, max: 100, step: 1 },
  'basic.whites': { min: -100, max: 100, step: 1 },
  'basic.blacks': { min: -100, max: 100, step: 1 },
  'basic.texture': { min: -100, max: 100, step: 1 },
  'basic.clarity': { min: -100, max: 100, step: 1 },
  'basic.dehaze': { min: -100, max: 100, step: 1 },
  'basic.vibrance': { min: -100, max: 100, step: 1 },
  'basic.saturation': { min: -100, max: 100, step: 1 },
  'wb.temp.raw': { min: 2000, max: 50000, step: 50, unit: 'K' },
  'wb.tint.raw': { min: -150, max: 150, step: 1 },
  'wb.temp.display': { min: -100, max: 100, step: 1 },
  'wb.tint.display': { min: -100, max: 100, step: 1 },
  'detail.sharpen': { min: 0, max: 150, step: 1 },
  'detail.radius': { min: 0.5, max: 3, step: 0.1, dp: 1 },
  'detail.detail': { min: 0, max: 100, step: 1 },
  'detail.masking': { min: 0, max: 100, step: 1 },
  'detail.noise': { min: 0, max: 100, step: 1 },
  'detail.noiseDetail': { min: 0, max: 100, step: 1 },
  'detail.colorNoise': { min: 0, max: 100, step: 1 },
  'effects.vignette': { min: -100, max: 100, step: 1 },
  'effects.vignetteMidpoint': { min: 0, max: 100, step: 1 },
  'effects.vignetteRoundness': { min: -100, max: 100, step: 1 },
  'effects.vignetteFeather': { min: 0, max: 100, step: 1 },
  'effects.grain': { min: 0, max: 100, step: 1 },
  'effects.grainSize': { min: 0, max: 100, step: 1 },
  'effects.grainRoughness': { min: 0, max: 100, step: 1 },
  'effects.fade': { min: 0, max: 100, step: 1 },
  'grading.blending': { min: 0, max: 100, step: 1 },
  'grading.balance': { min: -100, max: 100, step: 1 },
  'geometry.angle': { min: -45, max: 45, step: 0.1, dp: 1, unit: '°' },
}

/** Ranges of the local (masked) adjustments; every one defaults to 0 = no change. */
export const LOCAL_SPECS: Record<Exclude<keyof LocalAdjust, 'color'>, SliderSpec> = {
  temp: { min: -100, max: 100, step: 1 },
  tint: { min: -100, max: 100, step: 1 },
  exposure: { min: -4, max: 4, step: 0.01, dp: 2 },
  contrast: { min: -100, max: 100, step: 1 },
  highlights: { min: -100, max: 100, step: 1 },
  shadows: { min: -100, max: 100, step: 1 },
  whites: { min: -100, max: 100, step: 1 },
  blacks: { min: -100, max: 100, step: 1 },
  texture: { min: -100, max: 100, step: 1 },
  clarity: { min: -100, max: 100, step: 1 },
  dehaze: { min: -100, max: 100, step: 1 },
  saturation: { min: -100, max: 100, step: 1 },
  sharpness: { min: -100, max: 100, step: 1 },
  noise: { min: 0, max: 100, step: 1 },
}

/** Temperature slider for RAW moves evenly in mireds; these map slider position ↔ Kelvin. */
export const kelvinToSlider = (k: number) => 1e6 / k
export const sliderToKelvin = (m: number) => Math.round(1e6 / m / 50) * 50
