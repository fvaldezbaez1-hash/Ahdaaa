// How a look lands on a recipe. A look is a set of *deltas* on top of the
// photo's own corrections (white balance moves relative to the photo's, sliders
// add to what's there, curves bend what's there), scaled by Amount 0…200 %.
// Everything the look changes is recorded on `recipe.look`, so a new amount,
// or another look first takes the old one off instead of stacking on it.

import { curveLut, isIdentity, normalizeCurve, type CurvePoint } from '../color/curve'
import { shiftWb } from '../color/wb'
import { SPECS } from '../edit/defaults'
import { getPath, setPath } from '../edit/path'
import { BANDS, type EditRecipe, type LookValue, type Preset, type SourceKind, type Variation, type Wheel } from '../edit/types'

const WHEELS = ['shadows', 'midtones', 'highlights', 'global'] as const
const MIXER_GROUPS = ['hue', 'sat', 'lum', 'bw'] as const
const CHANNELS = ['rgb', 'r', 'g', 'b'] as const

/** Look values that are settings (move to them) rather than amounts (add them). */
const SHAPE = new Set(['effects.vignetteMidpoint', 'effects.vignetteRoundness', 'effects.vignetteFeather', 'effects.grainSize', 'effects.grainRoughness', 'grading.blending'])
const isShape = (path: string) => SHAPE.has(path) || path.startsWith('detail.')

const round = (v: number, step: number) => {
  const r = Math.round(v / step) * step
  return Number(r.toFixed(step < 1 ? 2 : 0))
}

/** Clamp (and round to the slider step) a value written at `path`. */
function fit(path: string, v: number, kind: SourceKind): number {
  if (path.endsWith('.hue') && path.startsWith('grading.')) return round(((v % 360) + 360) % 360, 1)
  if (path.endsWith('.sat') && path.startsWith('grading.')) return round(Math.min(100, Math.max(0, v)), 1)
  // White balance keeps whole Kelvin (the slider's 50 K step would round away small mired shifts).
  const wb = path.startsWith('wb.') ? SPECS[`${path}.${kind}`] : undefined
  const s = wb ? { ...wb, step: 1 } : (SPECS[path] ?? { min: -100, max: 100, step: 1 })
  return round(Math.min(s.max, Math.max(s.min, v)), s.step)
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b)

/** Light-valued curve points (4 dp keep the stored recipe short). */
const tidy = (p: CurvePoint[]) => p.map((q) => ({ x: Number(q.x.toFixed(4)), y: Number(q.y.toFixed(4)) }))

/**
 * Move a curve toward (k < 1) or past (k > 1) its bend away from the identity
 * line. Past 100 % the result is clamped and kept non-decreasing.
 */
export function scaleCurve(points: CurvePoint[], k: number): CurvePoint[] {
  const p = normalizeCurve(points)
  let floor = 0
  return tidy(
    p.map((q) => {
      const y = Math.min(1, Math.max(floor, q.x + (q.y - q.x) * k))
      floor = y
      return { x: q.x, y }
    }),
  )
}

/** `look` applied after `base` (both point curves), resampled to 11 points. */
function composeCurves(base: CurvePoint[], look: CurvePoint[]): CurvePoint[] {
  const n = 1024
  const b = curveLut(base, n + 1), l = curveLut(look, n + 1)
  return tidy(Array.from({ length: 11 }, (_, i) => {
    const f = b[i * (n / 10)] * n, j = Math.min(n - 1, Math.floor(f))
    return { x: i / 10, y: l[j] + (l[j + 1] - l[j]) * (f - j) }
  }))
}

/** Wheels add as vectors (hue = direction, sat = length), so a look can tint on top of the photo's own grading. */
function addWheel(base: Wheel, look: Wheel, k: number): Wheel {
  const rad = (d: number) => (d * Math.PI) / 180
  const x = base.sat * Math.cos(rad(base.hue)) + k * look.sat * Math.cos(rad(look.hue))
  const y = base.sat * Math.sin(rad(base.hue)) + k * look.sat * Math.sin(rad(look.hue))
  const sat = Math.hypot(x, y)
  return { hue: sat < 0.5 ? base.hue : (Math.atan2(y, x) * 180) / Math.PI, sat, lum: base.lum + k * look.lum }
}

class Writer {
  r: EditRecipe
  readonly base: EditRecipe
  readonly kind: SourceKind
  readonly before = new Map<string, LookValue>()
  constructor(base: EditRecipe, kind: SourceKind) {
    this.r = base
    this.base = base
    this.kind = kind
  }
  put(path: string, v: LookValue) {
    if (!this.before.has(path)) this.before.set(path, getPath(this.base, path) as LookValue)
    this.r = setPath(this.r, path, typeof v === 'number' ? fit(path, v, this.kind) : v)
  }
  add(path: string, d: number | undefined, k: number) {
    if (!d) return
    this.put(path, (getPath(this.base, path) as number) + d * k)
  }
  /** Shape settings snap to the look's value. */
  to(path: string, v: number | undefined) {
    if (v !== undefined && v !== getPath(this.base, path)) this.put(path, v)
  }
}

/** The recipe as it was before its look (keeping edits made since). */
export function stripLook(r: EditRecipe): EditRecipe {
  if (!r.look) return r
  const { look, ...rest } = r
  let out = rest as EditRecipe
  const kind: SourceKind = r.wb.temp >= 1000 ? 'raw' : 'display'
  for (const [path, before] of Object.entries(look.base ?? {})) {
    const now = getPath(r, path), was = look.set?.[path]
    if (same(now, was)) out = setPath(out, path, before)
    else if (typeof now === 'number' && typeof was === 'number' && typeof before === 'number') out = setPath(out, path, fit(path, before + now - was, kind))
  }
  return out
}

/**
 * Apply a look to a recipe. `amount` is 0…200 (%): below 100 is a softer take,
 * above it a stronger one. Keeps crop/geometry and anything the preset doesn't
 * set. White balance shifts relative to the recipe's current values. Records
 * `look` on the result. (`_variation` is kept for existing callers; looks no
 * longer come in variations.)
 */
export function applyPreset(recipe: EditRecipe, preset: Preset, amount: number, _variation: Variation, kind: SourceKind): EditRecipe {
  const base = stripLook(recipe)
  const k = Math.min(200, Math.max(0, amount)) / 100
  const d = preset.data
  const w = new Writer(base, kind)

  if (k > 0) {
    if (d.profile && d.profile !== base.profile) w.put('profile', d.profile)
    if (d.treatment && d.treatment !== base.treatment) w.put('treatment', d.treatment)
    const ws = d.wbShift
    if (ws && (ws.temp || ws.tint)) {
      const next = shiftWb(kind, base.wb, ws.temp * k, ws.tint * k)
      w.put('wb.temp', next.temp)
      w.put('wb.tint', next.tint)
      if (base.wb.preset !== 'custom') w.put('wb.preset', 'custom')
    }
    for (const [key, v] of Object.entries(d.basic ?? {})) w.add(`basic.${key}`, v, k)
    for (const ch of CHANNELS) {
      const pts = d.curve?.[ch]
      if (!pts || isIdentity(normalizeCurve(pts))) continue
      const scaled = scaleCurve(pts, k)
      w.put(`curve.${ch}`, isIdentity(base.curve[ch]) ? scaled : composeCurves(base.curve[ch], scaled))
    }
    for (const g of MIXER_GROUPS) for (const band of BANDS) w.add(`mixer.${g}.${band}`, d.mixer?.[g]?.[band], k)
    for (const name of WHEELS) {
      const look = d.grading?.[name]
      if (!look || (!look.sat && !look.lum)) continue
      const next = addWheel(base.grading[name], look, k)
      w.put(`grading.${name}.hue`, next.hue)
      w.put(`grading.${name}.sat`, next.sat)
      w.put(`grading.${name}.lum`, next.lum)
    }
    w.to('grading.blending', d.grading?.blending)
    w.add('grading.balance', d.grading?.balance, k)
    for (const [key, v] of Object.entries(d.detail ?? {})) w.to(`detail.${key}`, v)
    for (const [key, v] of Object.entries(d.effects ?? {})) {
      const path = `effects.${key}`
      if (isShape(path)) w.to(path, v)
      else w.add(path, v, k)
    }
  }

  const changed = [...w.before.keys()]
  return {
    ...w.r,
    look: {
      presetId: preset.id,
      name: preset.name,
      amount: Math.round(amount),
      variation: 'original',
      base: Object.fromEntries(w.before),
      set: Object.fromEntries(changed.map((p) => [p, getPath(w.r, p) as LookValue])),
    },
  }
}
