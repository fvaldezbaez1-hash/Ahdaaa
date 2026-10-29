import { normalizeCurve, type CurvePoint } from '../color/curve'
import { defaultRecipe, SPECS } from '../edit/defaults'
import { setPath } from '../edit/path'
import { BANDS, type EditRecipe, type PresetData, type ProfileId, type Rect, type SourceKind, type Treatment, type Variation } from '../edit/types'
import { applyPreset, findBuiltin, VARIATIONS } from '../presets/catalog'
import type { JsonSchema, ToolSpec } from './types'

// The tools the model edits with. Arguments are untrusted: everything is
// validated, clamped to the slider ranges and mapped onto the recipe here.

export interface Range {
  min: number
  max: number
  step: number
  /** Hue: wrap around instead of clamping. */
  wrap?: boolean
}

export const PROFILES: ProfileId[] = ['color', 'neutral', 'vivid', 'portrait', 'landscape', 'flat', 'mono']
const TREATMENTS: Treatment[] = ['color', 'bw']
const CHANNELS = ['rgb', 'r', 'g', 'b'] as const
type Channel = (typeof CHANNELS)[number]
export const WHEELS = ['shadows', 'midtones', 'highlights', 'global'] as const
const MIXER_GROUPS = ['hue', 'sat', 'lum', 'bw'] as const
const MAX_CURVE_POINTS = 16

/** Presets carry white balance as a relative shift (RAW: mireds, JPEG: slider units). */
const WB_SHIFT: Range = { min: -100, max: 100, step: 1 }

/** Every number the AI may set, keyed by recipe path, in a stable order. */
export function numericRanges(kind: SourceKind, forPreset = false): Map<string, Range> {
  const m = new Map<string, Range>()
  const spec = (k: string): Range => ({ min: SPECS[k].min, max: SPECS[k].max, step: SPECS[k].step })
  const fromSpecs = (prefix: string) => Object.keys(SPECS).filter((k) => k.startsWith(prefix)).forEach((k) => m.set(k, spec(k)))
  fromSpecs('basic.')
  m.set('wb.temp', forPreset ? WB_SHIFT : spec(`wb.temp.${kind}`))
  m.set('wb.tint', forPreset ? WB_SHIFT : spec(`wb.tint.${kind}`))
  for (const g of MIXER_GROUPS) for (const b of BANDS) m.set(`mixer.${g}.${b}`, { min: -100, max: 100, step: 1 })
  for (const w of WHEELS) {
    m.set(`grading.${w}.hue`, { min: 0, max: 360, step: 1, wrap: true })
    m.set(`grading.${w}.sat`, { min: 0, max: 100, step: 1 })
    m.set(`grading.${w}.lum`, { min: -100, max: 100, step: 1 })
  }
  m.set('grading.blending', spec('grading.blending'))
  m.set('grading.balance', spec('grading.balance'))
  fromSpecs('detail.')
  fromSpecs('effects.')
  if (!forPreset) m.set('geometry.angle', spec('geometry.angle'))
  return m
}

const decimals = (step: number) => (step < 1 ? (String(step).split('.')[1]?.length ?? 0) : 0)

/** Clamp (or wrap) to the range and snap to the slider step. */
export function fitToRange(v: number, r: Range): number {
  const snapped = Math.round(v / r.step) * r.step
  const x = r.wrap ? ((snapped % r.max) + r.max) % r.max : Math.min(r.max, Math.max(r.min, snapped))
  return Number(x.toFixed(decimals(r.step))) + 0
}

// ---------- JSON schemas ----------

const str = (description: string, extra: JsonSchema = {}): JsonSchema => ({ type: 'string', description, ...extra })
const num = (description?: string): JsonSchema => (description ? { type: 'number', description } : { type: 'number' })
const obj = (properties: Record<string, JsonSchema>, required: string[], description?: string): JsonSchema => ({
  type: 'object',
  ...(description ? { description } : {}),
  properties,
  required,
  additionalProperties: false,
})

function adjustmentProperties(forPreset: boolean): Record<string, JsonSchema> {
  const paths = [...numericRanges('raw', forPreset).keys()]
  const props: Record<string, JsonSchema> = {
    changes: {
      type: 'array',
      description: forPreset
        ? 'Sliders the look sets. wb.temp / wb.tint are a relative shift −100…+100 (+ = warmer / more magenta). Other values are absolute, in the ranges from the instructions.'
        : "Sliders to set. Values are absolute targets in each slider's range (not deltas). Include only what should change.",
      items: obj({ path: str('Slider path.', { enum: paths }), value: num() }, ['path', 'value']),
    },
    profile: str('Base rendering. Leave out to keep it.', { enum: PROFILES }),
    treatment: str('"bw" for black & white (shape the grays with mixer.bw.*), "color" to go back.', { enum: TREATMENTS }),
    curves: {
      type: 'array',
      description: 'Tone curves to replace. Points x,y in 0–1, ascending x, from x=0 to x=1. Identity: (0,0) (1,1).',
      items: obj(
        {
          channel: str('rgb = all channels; r, g, b = single channels.', { enum: [...CHANNELS] }),
          points: { type: 'array', items: obj({ x: num(), y: num() }, ['x', 'y']) },
        },
        ['channel', 'points'],
      ),
    },
  }
  if (!forPreset) {
    props.crop = obj({ x: num(), y: num(), w: num(), h: num() }, ['x', 'y', 'w', 'h'], 'Crop rectangle, 0–1 of the full uncropped frame (x, y = top-left). Full frame: 0, 0, 1, 1.')
  }
  return props
}

const WHY = str('For the user, 1–2 short sentences in plain language: why these changes work (teach a little).')

export const SET_ADJUSTMENTS = 'set_adjustments'
export const APPLY_LOOK = 'apply_look'
export const RESET_ADJUSTMENTS = 'reset_adjustments'
export const CREATE_LOOK = 'create_look'

export function assistantTools(withLooks: boolean): ToolSpec[] {
  const tools: ToolSpec[] = [
    {
      name: SET_ADJUSTMENTS,
      description:
        "Move Lumen's real sliders for the whole photo (one undo step). Send only what should change, as absolute values. After it runs you get a fresh preview to check.",
      parameters: obj(
        { summary: str('2–5 word label for the undo history, e.g. "Warmer, brighter".'), why: WHY, ...adjustmentProperties(false) },
        ['summary', 'why'],
      ),
    },
    {
      name: RESET_ADJUSTMENTS,
      description: 'Return every slider to the original (as shot) settings.',
      parameters: obj({ keep_crop: { type: 'boolean', description: 'Keep the current crop and straightening.' }, why: WHY }, ['keep_crop', 'why']),
    },
  ]
  if (withLooks) {
    tools.splice(1, 0, {
      name: APPLY_LOOK,
      description: 'Apply one of the built-in looks listed in the instructions, then fine-tune with set_adjustments if needed.',
      parameters: obj(
        {
          look_id: str('A look id from the list.'),
          amount: num('Strength in %, 0–200. 100 = as designed.'),
          variation: str('Variation of the look.', { enum: VARIATIONS.map((v) => v.id) }),
          why: WHY,
        },
        ['look_id', 'amount', 'variation', 'why'],
      ),
    })
  }
  return tools
}

export const PRESET_TOOL: ToolSpec = {
  name: CREATE_LOOK,
  description: 'Save the look the user described as a reusable preset.',
  parameters: obj(
    { name: str('Short preset name, 1–4 words, title case.'), why: WHY, ...adjustmentProperties(true) },
    ['name', 'why', 'changes'],
  ),
}

/** OpenAI strict mode: every property is required, so optional ones become nullable. */
export function strictSchema(s: JsonSchema): JsonSchema {
  if (s.type === 'array') return { ...s, items: strictSchema(s.items as JsonSchema) }
  if (s.type !== 'object') return s
  const props = s.properties as Record<string, JsonSchema>
  const required = new Set((s.required as string[] | undefined) ?? [])
  const nullable = (p: JsonSchema): JsonSchema => ({ ...p, type: [p.type, 'null'], ...(Array.isArray(p.enum) ? { enum: [...p.enum, null] } : {}) })
  return {
    ...s,
    properties: Object.fromEntries(Object.entries(props).map(([k, p]) => [k, required.has(k) ? strictSchema(p) : nullable(strictSchema(p))])),
    required: Object.keys(props),
    additionalProperties: false,
  }
}

// ---------- Validation ----------

/** Bad tool input; the message goes back to the model so it can correct itself. */
export class ToolInputError extends Error {}

export interface Adjustments {
  summary: string
  why: string
  changes: [path: string, value: number][]
  profile?: ProfileId
  treatment?: Treatment
  curves?: { channel: Channel; points: CurvePoint[] }[]
  crop?: Rect
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '')
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** Validate and clamp set_adjustments / create_look input. `notes` tell the model what was corrected. */
export function parseAdjustments(args: unknown, kind: SourceKind, forPreset = false): { value: Adjustments; notes: string[] } {
  if (!isObj(args)) throw new ToolInputError('Arguments must be a JSON object.')
  const ranges = numericRanges(kind, forPreset)
  const notes: string[] = []
  const value: Adjustments = { summary: text(args.summary ?? args.name, 60), why: text(args.why, 600), changes: [] }

  if (args.changes != null && !Array.isArray(args.changes)) throw new ToolInputError('"changes" must be an array of {path, value}.')
  const seen = new Map<string, number>()
  for (const c of (args.changes as unknown[] | undefined) ?? []) {
    if (!isObj(c) || typeof c.path !== 'string' || !finite(c.value)) {
      notes.push(`Skipped an invalid change: ${JSON.stringify(c).slice(0, 60)}`)
      continue
    }
    const range = ranges.get(c.path)
    if (!range) {
      notes.push(`Unknown slider "${c.path.slice(0, 40)}" skipped.`)
      continue
    }
    const v = fitToRange(c.value, range)
    if (!range.wrap && Math.abs(v - c.value) > range.step) notes.push(`${c.path} ${c.value} is out of range; set to ${v}.`)
    seen.set(c.path, v)
  }
  value.changes = [...seen]

  if (args.profile != null) {
    if (PROFILES.includes(args.profile as ProfileId)) value.profile = args.profile as ProfileId
    else notes.push(`Unknown profile "${String(args.profile).slice(0, 20)}" skipped.`)
  }
  if (args.treatment != null) {
    if (TREATMENTS.includes(args.treatment as Treatment)) value.treatment = args.treatment as Treatment
    else notes.push(`Unknown treatment "${String(args.treatment).slice(0, 20)}" skipped.`)
  }
  if (args.curves != null) {
    if (!Array.isArray(args.curves)) throw new ToolInputError('"curves" must be an array of {channel, points}.')
    value.curves = []
    for (const c of args.curves) {
      if (!isObj(c) || !CHANNELS.includes(c.channel as Channel) || !Array.isArray(c.points)) throw new ToolInputError('Each curve needs a channel (rgb, r, g, b) and points.')
      const points = c.points.filter((p): p is { x: number; y: number } => isObj(p) && finite(p.x) && finite(p.y))
      if (points.length < 2) throw new ToolInputError(`The ${String(c.channel)} curve needs at least two points.`)
      if (points.length > MAX_CURVE_POINTS) throw new ToolInputError(`Use at most ${MAX_CURVE_POINTS} curve points.`)
      value.curves.push({ channel: c.channel as Channel, points: normalizeCurve(points).map((p) => ({ x: round3(p.x), y: round3(p.y) })) })
    }
  }
  if (!forPreset && args.crop != null) {
    const c = args.crop
    if (!isObj(c) || ![c.x, c.y, c.w, c.h].every(finite)) throw new ToolInputError('"crop" needs numeric x, y, w, h between 0 and 1.')
    const w = Math.max(0.05, clamp01(c.w as number))
    const h = Math.max(0.05, clamp01(c.h as number))
    value.crop = { x: round3(Math.min(1 - w, clamp01(c.x as number))), y: round3(Math.min(1 - h, clamp01(c.y as number))), w: round3(w), h: round3(h) }
  }
  return { value, notes }
}

const round3 = (v: number) => Math.round(v * 1000) / 1000

const isFullFrame = (c: Rect) => c.x <= 0.001 && c.y <= 0.001 && c.w >= 0.999 && c.h >= 0.999

export function applyAdjustments(recipe: EditRecipe, a: Adjustments): EditRecipe {
  let r = recipe
  for (const [path, value] of a.changes) r = setPath(r, path, value)
  if (a.changes.some(([p]) => p.startsWith('wb.'))) r = setPath(r, 'wb.preset', 'custom')
  if (a.profile) r = { ...r, profile: a.profile }
  if (a.treatment) r = { ...r, treatment: a.treatment }
  for (const c of a.curves ?? []) r = setPath(r, `curve.${c.channel}`, c.points)
  if (a.crop) r = { ...r, geometry: { ...r.geometry, crop: a.crop, aspect: isFullFrame(a.crop) ? 'original' : 'free' } }
  return r
}

/** create_look input → the preset format (wheels and the white balance shift are stored whole). */
export function toPresetData(a: Adjustments): PresetData {
  const out: Obj = {}
  const put = (keys: string[], v: unknown) => {
    let o = out
    for (const k of keys.slice(0, -1)) o = (o[k] ??= {}) as Obj
    o[keys[keys.length - 1]] = v
  }
  for (const [path, v] of a.changes) {
    const keys = path.split('.')
    put(keys[0] === 'wb' ? ['wbShift', keys[1]] : keys, v)
  }
  const grading = out.grading as Obj | undefined
  for (const w of WHEELS) if (grading?.[w]) grading[w] = { hue: 0, sat: 0, lum: 0, ...(grading[w] as Obj) }
  if (out.wbShift) out.wbShift = { temp: 0, tint: 0, ...(out.wbShift as Obj) }
  if (a.profile) out.profile = a.profile
  if (a.treatment) out.treatment = a.treatment
  for (const c of a.curves ?? []) put(['curve', c.channel], c.points)
  return out as PresetData
}

// ---------- Running a tool call ----------

export interface ToolContext {
  kind: SourceKind
  asShot?: { temp: number; tint: number }
}

export interface ToolOutcome {
  recipe: EditRecipe
  /** Short label for the undo history. */
  summary: string
  why: string
  notes: string[]
}

/** Apply one tool call to a recipe (pure). Throws ToolInputError for input the model should fix. */
export function runTool(name: string, args: unknown, recipe: EditRecipe, ctx: ToolContext): ToolOutcome {
  switch (name) {
    case SET_ADJUSTMENTS: {
      const { value, notes } = parseAdjustments(args, ctx.kind)
      return { recipe: applyAdjustments(recipe, value), summary: value.summary, why: value.why, notes }
    }
    case APPLY_LOOK: {
      if (!isObj(args)) throw new ToolInputError('Arguments must be a JSON object.')
      const preset = typeof args.look_id === 'string' ? findBuiltin(args.look_id) : undefined
      if (!preset) throw new ToolInputError(`Unknown look id "${String(args.look_id).slice(0, 40)}". Use an id from the list.`)
      const amount = finite(args.amount) ? fitToRange(args.amount, { min: 0, max: 200, step: 1 }) : 100
      const variation = VARIATIONS.some((v) => v.id === args.variation) ? (args.variation as Variation) : 'original'
      return { recipe: applyPreset(recipe, preset, amount, variation, ctx.kind), summary: `Look: ${preset.name}`, why: text(args.why, 600), notes: [] }
    }
    case RESET_ADJUSTMENTS: {
      const d = defaultRecipe(ctx.kind, ctx.asShot)
      const keep = !isObj(args) || args.keep_crop !== false
      return { recipe: keep ? { ...d, geometry: recipe.geometry } : d, summary: 'Reset', why: isObj(args) ? text(args.why, 600) : '', notes: [] }
    }
    default:
      throw new ToolInputError(`There is no tool called "${name.slice(0, 40)}".`)
  }
}
