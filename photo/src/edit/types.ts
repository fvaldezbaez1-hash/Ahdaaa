// The edit "recipe": everything Lumen changes about a photo, as plain data.
// The original file is never touched; rendering = original + recipe.
//
// Ranges follow Lightroom so slider values and presets feel familiar.
// Every field is required in a stored recipe (use `normalizeRecipe` on data
// from older versions or presets); `layers` holds local adjustments.

import type { CurvePoint } from '../color/curve'

export type { CurvePoint }

/** RAW = sensor data we develop ourselves; display = JPEG/PNG/HEIC/TIFF already developed by a camera or app. */
export type SourceKind = 'raw' | 'display'

/** Base rendering ("profile"): the starting tone curve and color before any slider. */
export type ProfileId = 'color' | 'neutral' | 'vivid' | 'portrait' | 'landscape' | 'flat' | 'mono'

export type WbPreset = 'asShot' | 'auto' | 'daylight' | 'cloudy' | 'shade' | 'tungsten' | 'fluorescent' | 'flash' | 'custom'

export interface WhiteBalance {
  preset: WbPreset
  /** RAW: Kelvin (2000…50000). Display: relative −100…+100 (+ = warmer). */
  temp: number
  /** RAW: −150…+150 (+ = magenta). Display: relative −100…+100. */
  tint: number
}

export interface Basic {
  /** Stops, −5…+5. */
  exposure: number
  /** All below −100…+100. */
  contrast: number
  highlights: number
  shadows: number
  whites: number
  blacks: number
  texture: number
  clarity: number
  dehaze: number
  vibrance: number
  saturation: number
}

/** Point curves; x/y in 0…1 on display-encoded (gamma) values. Identity = [{0,0},{1,1}]. */
export interface ToneCurve {
  rgb: CurvePoint[]
  r: CurvePoint[]
  g: CurvePoint[]
  b: CurvePoint[]
}

export const BANDS = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'] as const
export type Band = (typeof BANDS)[number]
/** Center hue of each band in degrees (OKLCh hue). */
export const BAND_HUES: Record<Band, number> = { red: 25, orange: 55, yellow: 95, green: 145, aqua: 195, blue: 255, purple: 300, magenta: 340 }

export type BandValues = Record<Band, number>

/** Color mixer, −100…+100 per band. `bw` is the black & white mix used when treatment = 'bw'. */
export interface Mixer {
  hue: BandValues
  sat: BandValues
  lum: BandValues
  bw: BandValues
}

/** Color wheel: hue 0…360, sat 0…100, lum −100…+100. */
export interface Wheel {
  hue: number
  sat: number
  lum: number
}

export interface Grading {
  shadows: Wheel
  midtones: Wheel
  highlights: Wheel
  global: Wheel
  /** 0…100, default 50: how much the three ranges overlap. */
  blending: number
  /** −100…+100: moves the split point between shadows and highlights. */
  balance: number
}

export interface Detail {
  /** Sharpening amount 0…150. */
  sharpen: number
  /** Sharpening radius 0.5…3 px. */
  radius: number
  /** 0…100: how much fine detail vs. edges get sharpened. */
  detail: number
  /** 0…100: restrict sharpening to edges. */
  masking: number
  /** Luminance noise reduction 0…100. */
  noise: number
  /** 0…100, default 50. */
  noiseDetail: number
  /** Color noise reduction 0…100. */
  colorNoise: number
}

export interface Effects {
  /** −100 (darken corners)…+100 (lighten). Note: negative = darker edges, like Lightroom. */
  vignette: number
  /** 0…100, default 50. */
  vignetteMidpoint: number
  /** −100…+100, default 0. */
  vignetteRoundness: number
  /** 0…100, default 50. */
  vignetteFeather: number
  /** 0…100. */
  grain: number
  /** 0…100, default 25. */
  grainSize: number
  /** 0…100, default 50. */
  grainRoughness: number
  /** 0…100: lifts the blacks for a faded / matte look. */
  fade: number
}

export type AspectId = 'original' | 'free' | '1:1' | '4:5' | '5:4' | '3:2' | '2:3' | '4:3' | '3:4' | '16:9' | '9:16' | '5:7'

/** Normalized rectangle (0…1) in the frame AFTER rotate/flip, BEFORE straightening. */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Geometry {
  crop: Rect
  /** Straighten angle in degrees, −45…+45, around the crop center (+ = clockwise). */
  angle: number
  /** Quarter turns clockwise, applied first. */
  rotate: 0 | 1 | 2 | 3
  flipH: boolean
  flipV: boolean
  aspect: AspectId
}

export type Treatment = 'color' | 'bw'

/**
 * Mask coordinates (Phase 2): positions are normalized to the SOURCE image as
 * decoded and oriented (0…1 across its width / height), before the user's
 * rotate, flip, straighten and crop — so a mask stays on the same part of the
 * photo when the crop changes. Lengths (radii, brush sizes, feather widths) are
 * fractions of the source's LONG edge, so circles stay round on any aspect.
 * Convert to and from what's on screen with engine/geometry.ts.
 */
export type MaskShape =
  /** Full effect on the (x1, y1) side, fading to none at (x2, y2). */
  | { type: 'linear'; x1: number; y1: number; x2: number; y2: number }
  /** Ellipse at (cx, cy), radii rx/ry, rotated `angle` degrees; feather 0…100 = soft edge width as % of the radius. */
  | { type: 'radial'; cx: number; cy: number; rx: number; ry: number; angle: number; feather: number }
  /** Painted strokes; r = brush radius, feather 0…100 = soft part of r (%), flow 0…1 per dab; `erase` strokes remove. */
  | { type: 'brush'; strokes: { points: { x: number; y: number }[]; r: number; feather: number; flow: number; erase?: boolean }[] }
  /** Phase 3 (on-device AI). Not rendered yet. */
  | { type: 'ai'; target: 'sky' | 'subject' | 'background' | 'person' }
  /**
   * Select by brightness or color of the photo as developed before local layers.
   * luminance: low/high 0…100 (display-encoded), smooth 0…100 = feathering of both ends.
   * color: hue 0…360 and sat 0…100 of the sampled color, `low…high` = tolerance 0…100 (high used as the width), smooth 0…100.
   */
  | { type: 'range'; mode: 'luminance' | 'color'; low: number; high: number; smooth: number; hue?: number; sat?: number }

/** How a mask combines with the ones before it in the layer (the first one is always `add`). */
export type MaskMode = 'add' | 'subtract' | 'intersect'

export type Mask = MaskShape & { id: string; mode: MaskMode; invert: boolean }

/** What a local layer can change. All optional; missing = no change. */
export interface LocalAdjust {
  /** Relative white balance, −100…+100 (+ = warmer / more magenta). */
  temp?: number
  tint?: number
  /** Stops, −4…+4. */
  exposure?: number
  /** All below −100…+100 unless noted. */
  contrast?: number
  highlights?: number
  shadows?: number
  whites?: number
  blacks?: number
  texture?: number
  clarity?: number
  dehaze?: number
  saturation?: number
  /** Negative softens (skin), positive sharpens. */
  sharpness?: number
  /** Extra luminance noise reduction, 0…100. */
  noise?: number
  /** Tint the area with a color: hue 0…360, sat 0…100. */
  color?: { hue: number; sat: number }
}

/** Local adjustment layer: its masks pick where, `adjust` says what. Layers apply in order. */
export interface LocalLayer {
  id: string
  name: string
  enabled: boolean
  /** 0…1: scales the whole layer. */
  opacity: number
  masks: Mask[]
  adjust: LocalAdjust
}

/**
 * Healing / clone spot (Phase 2). Same coordinate rules as masks. The circle at
 * (x, y) with radius r is filled from the circle at (sx, sy). 'heal' also matches
 * the brightness and color of the surroundings; 'clone' copies exactly.
 */
export interface RetouchSpot {
  id: string
  mode: 'heal' | 'clone'
  x: number
  y: number
  r: number
  sx: number
  sy: number
  /** 0…100: soft edge as % of r. */
  feather: number
  /** 0…1. */
  opacity: number
}

export type Variation = 'original' | 'warmer' | 'cooler' | 'softer' | 'stronger'

/** A recipe value a look changed, keyed by its path (see edit/path.ts). */
export type LookValue = number | string | CurvePoint[]

/** Which preset (look) produced the current settings, for the UI. */
export interface AppliedLook {
  presetId: string
  name: string
  /** 0…200 (%). */
  amount: number
  variation: Variation
  /**
   * Values of every field the look changed, from before it was applied, so a
   * new amount, variation or look starts from the photo as it was (no stacking).
   */
  base?: Record<string, LookValue>
  /** What the look set those fields to; a field edited since keeps the user's change. */
  set?: Record<string, LookValue>
}

export interface EditRecipe {
  v: 1
  profile: ProfileId
  treatment: Treatment
  wb: WhiteBalance
  basic: Basic
  curve: ToneCurve
  mixer: Mixer
  grading: Grading
  detail: Detail
  effects: Effects
  geometry: Geometry
  /** Healing / clone spots, applied first (to the photo itself). */
  retouch: RetouchSpot[]
  layers: LocalLayer[]
  look?: AppliedLook
}

/** What a preset contains: any subset of the recipe, with white balance as a relative shift. */
export interface PresetData {
  profile?: ProfileId
  treatment?: Treatment
  /** Relative shift: + = warmer / more magenta. RAW: 1 unit = 1 mired; JPEG: 1 slider unit. */
  wbShift?: { temp: number; tint: number }
  basic?: Partial<Basic>
  curve?: Partial<ToneCurve>
  mixer?: { hue?: Partial<BandValues>; sat?: Partial<BandValues>; lum?: Partial<BandValues>; bw?: Partial<BandValues> }
  grading?: { shadows?: Wheel; midtones?: Wheel; highlights?: Wheel; global?: Wheel; blending?: number; balance?: number }
  detail?: Partial<Detail>
  effects?: Partial<Effects>
}

export interface Preset {
  id: string
  name: string
  /** Collection id, e.g. 'film'. User presets use 'mine', imported Lightroom ones 'lightroom'. */
  collection: string
  description?: string
  tags?: string[]
  data: PresetData
}
