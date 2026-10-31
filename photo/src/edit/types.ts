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
  /** Phase 4: lens distortion correction, applied to the source before everything else. Absent = none. */
  lens?: LensGeometry
  /** Phase 4: perspective (Upright / Transform), after quarter turns and flips, before straighten and crop. Absent = none. */
  perspective?: Perspective
}

/**
 * Phase 4: distortion correction. `profile` holds coefficients resolved from the lens database for
 * this photo (lensfun models; radius normalized to half the source's shorter side, as lensfun does),
 * so rendering never needs the database.
 */
export interface LensGeometry {
  profile: { model: 'poly3' | 'poly5' | 'ptlens'; k: number[]; amount: number } | null
  /** Manual distortion −100…+100 (+ fixes barrel, − fixes pincushion). */
  manual: number
}

/** A line the user drew that should end up vertical or horizontal (Guided Upright), in mask coordinates. */
export interface UprightGuide {
  x1: number
  y1: number
  x2: number
  y2: number
}

/** Phase 4: perspective correction. All sliders are 0 at "no change" except scale (100). */
export interface Perspective {
  /** −100…+100: keystone (vertical lines converge / diverge). */
  vertical: number
  horizontal: number
  /** −10…+10 degrees, fine rotation applied with the perspective. */
  rotate: number
  /** −100…+100: stretch vertically (+) or horizontally (−) to undo the squash keystoning causes. */
  aspect: number
  /** 50…150 %. */
  scale: number
  /** −100…+100 % of the frame. */
  offsetX: number
  offsetY: number
  /** Which Upright mode set these values ('manual' once sliders are moved). */
  mode: 'off' | 'auto' | 'level' | 'vertical' | 'full' | 'guided' | 'manual'
  guides: UprightGuide[]
}

export type Treatment = 'color' | 'bw'

/** Phase 4: Levels on display-encoded values, 0…255 like Photoshop and Capture One. */
export interface LevelsChannel {
  inBlack: number
  inWhite: number
  /** Midtone gamma 0.1…10; 1 = no change, > 1 brightens. */
  gamma: number
  outBlack: number
  outWhite: number
}

export interface Levels {
  rgb: LevelsChannel
  r: LevelsChannel
  g: LevelsChannel
  b: LevelsChannel
}

/**
 * Phase 4: one range of the advanced color editor (Capture One style), selected on a
 * hue / saturation wheel around a picked color and shifted. With `uniformity` it's a
 * Skin Tone range: colors inside are pulled toward the picked color.
 */
export interface ColorRange {
  id: string
  name: string
  enabled: boolean
  /** Picked color: hue 0…360, saturation 0…100. */
  hue: number
  sat: number
  /** Half-width of the hue slice, 1…90 degrees. */
  hueWidth: number
  /** Saturation bounds of the slice, 0…100. */
  satLow: number
  satHigh: number
  /** 0…100: soft edge of the slice. */
  smooth: number
  /** −30…+30 degrees. */
  hueShift: number
  /** −100…+100. */
  satShift: number
  lightShift: number
  /** Skin Tone: 0…100 pull toward the picked hue / saturation / lightness. */
  uniformity?: { hue: number; sat: number; light: number }
}

/** Phase 4: lens corrections that aren't geometry (see Geometry.lens for distortion). */
export interface LensCorrection {
  /** Use the lens profile; `profileId` names it ('' = none found / not chosen). */
  enabled: boolean
  profileId: string
  /** Resolved profile vignetting (lensfun "pa" model k1…k3) and amount 0…200 %. */
  vignetting: { k: [number, number, number]; amount: number } | null
  /** Resolved profile lateral chromatic aberration (lensfun poly3 per channel: red, blue). */
  tca: { r: [number, number, number]; b: [number, number, number] } | null
  /** Detect and remove lateral chromatic aberration from the image itself. */
  autoCA: boolean
  /** Manual lens vignetting compensation −100…+100 and its midpoint 0…100. */
  manualVignetting: number
  manualVignettingMidpoint: number
  /** Defringe (axial / purple and green fringes): amount 0…20 and hue ranges in degrees. */
  defringe: { purple: number; purpleHue: [number, number]; green: number; greenHue: [number, number] }
}

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
  /** Painted strokes (see BrushStroke). */
  | { type: 'brush'; strokes: BrushStroke[] }
  /**
   * Phase 3: a selection made by an on-device AI model. The model runs once; its result is a
   * stored mask image (`raster`, an id in the io rasters store, normalized to the whole source)
   * that the engine refines edge-aware at render resolution. `raster` is '' until computed.
   * person: `parts` picks classes (all when omitted). object: `points` are the user's clicks.
   */
  | { type: 'ai'; target: AiTarget; parts?: PersonPart[]; points?: { x: number; y: number; positive: boolean }[]; raster: string; model: string }
  /**
   * Select by brightness or color of the photo as developed before local layers.
   * luminance: low/high 0…100 (display-encoded), smooth 0…100 = feathering of both ends.
   * color: hue 0…360 and sat 0…100 of the sampled color, `low…high` = tolerance 0…100 (high used as the width), smooth 0…100.
   */
  | { type: 'range'; range: 'luminance' | 'color'; low: number; high: number; smooth: number; hue?: number; sat?: number }

/** One brush stroke: r = brush radius, feather 0…100 = soft part of r (%), flow 0…1 per dab; `erase` removes. */
export interface BrushStroke {
  points: { x: number; y: number }[]
  r: number
  feather: number
  flow: number
  erase?: boolean
}

export type AiTarget = 'subject' | 'sky' | 'background' | 'person' | 'object'
export type PersonPart = 'face' | 'body' | 'hair' | 'clothes' | 'accessories'

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

/**
 * Phase 3: AI object removal. The painted area is filled by an inpainting model once; the fill
 * is a stored image (`fill`, an id in the io rasters store, linear RGB in the source's color
 * space) covering `rect` (mask coordinates) and blended in through the strokes. '' until computed.
 */
export interface RemoveArea {
  id: string
  mode: 'remove'
  strokes: BrushStroke[]
  rect: Rect
  fill: string
  model: string
}

export type Retouch = RetouchSpot | RemoveArea

/**
 * Phase 3: AI noise reduction. A denoised full-resolution copy of the source is made once and
 * stored (`raster`, an id in the io rasters store); `amount` blends it with the original.
 */
export interface AiDenoise {
  /** 0…100. */
  amount: number
  raster: string
  model: string
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
  /** Phase 4. */
  levels: Levels
  mixer: Mixer
  /** Phase 4: advanced color editor ranges, applied in order after the mixer. */
  colorEditor: ColorRange[]
  grading: Grading
  detail: Detail
  effects: Effects
  /** Phase 4. */
  lens: LensCorrection
  geometry: Geometry
  /** Healing / clone spots and AI removals, applied in order first (to the photo itself). */
  retouch: Retouch[]
  /** AI noise reduction (Phase 3); applies before everything else. */
  denoise?: AiDenoise
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
