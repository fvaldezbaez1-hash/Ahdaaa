import { isIdentity, type CurvePoint } from '../color/curve'
import { defaultRecipe, SPECS } from '../edit/defaults'
import { getPath, setPath } from '../edit/path'
import type { EditRecipe, Rect, SourceKind } from '../edit/types'
import { formatValue } from '../ui/Slider'
import { numericRanges } from './schema'

// Recipes as text: a compact summary the model reads every turn, and the
// old → new list the change cards show (and revert).

const BASIC: Record<string, string> = {
  exposure: 'Exposure', contrast: 'Contrast', highlights: 'Highlights', shadows: 'Shadows', whites: 'Whites', blacks: 'Blacks',
  texture: 'Texture', clarity: 'Clarity', dehaze: 'Dehaze', vibrance: 'Vibrance', saturation: 'Saturation',
}
const DETAIL: Record<string, string> = {
  sharpen: 'Sharpening', radius: 'Sharpen radius', detail: 'Sharpen detail', masking: 'Sharpen masking',
  noise: 'Noise reduction', noiseDetail: 'Noise detail', colorNoise: 'Color noise reduction',
}
const EFFECTS: Record<string, string> = {
  vignette: 'Vignette', vignetteMidpoint: 'Vignette midpoint', vignetteRoundness: 'Vignette roundness', vignetteFeather: 'Vignette feather',
  grain: 'Grain', grainSize: 'Grain size', grainRoughness: 'Grain roughness', fade: 'Fade',
}
const MIXER: Record<string, string> = { hue: 'hue', sat: 'saturation', lum: 'luminance' }
const CHANNEL: Record<string, string> = { rgb: 'RGB', r: 'Red', g: 'Green', b: 'Blue' }
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

/** Human label for a numeric slider path. */
export function sliderLabel(path: string): string {
  const [group, key, sub] = path.split('.')
  switch (group) {
    case 'basic':
      return BASIC[key] ?? key
    case 'wb':
      return key === 'temp' ? 'Temperature' : 'Tint'
    case 'mixer':
      return key === 'bw' ? `B&W ${sub}` : `${cap(sub)} ${MIXER[key]}`
    case 'grading':
      return sub ? `${cap(key)} ${sub === 'sat' ? 'saturation' : sub === 'lum' ? 'luminance' : 'hue'}` : `Grading ${key}`
    case 'detail':
      return DETAIL[key] ?? key
    case 'effects':
      return EFFECTS[key] ?? key
    case 'geometry':
      return 'Straighten'
    default:
      return path
  }
}

/** Plain number for the model: no unicode minus, at most 2 decimals. */
const n = (v: number) => String(Math.round(v * 100) / 100)

const curveText = (p: CurvePoint[]) => p.map((q) => `(${n(q.x)},${n(q.y)})`).join(' ')
const cropText = (c: Rect) => `x=${n(c.x)} y=${n(c.y)} w=${n(c.w)} h=${n(c.h)}`
const isFull = (c: Rect) => c.x === 0 && c.y === 0 && c.w === 1 && c.h === 1

/** The current settings in the same paths the tools use. Defaults are left out to save tokens. */
export function describeRecipe(r: EditRecipe, kind: SourceKind, asShot?: { temp: number; tint: number }): string {
  const d = defaultRecipe(kind, asShot)
  const parts = [`profile=${r.profile}`, `treatment=${r.treatment}`, `wb.temp=${n(r.wb.temp)}`, `wb.tint=${n(r.wb.tint)}`]
  for (const path of numericRanges(kind).keys()) {
    if (path.startsWith('wb.')) continue
    const v = getPath(r, path)
    if (typeof v === 'number' && v !== getPath(d, path)) parts.push(`${path}=${n(v)}`)
  }
  for (const ch of ['rgb', 'r', 'g', 'b'] as const) if (!isIdentity(r.curve[ch])) parts.push(`curve.${ch}=${curveText(r.curve[ch])}`)
  if (!isFull(r.geometry.crop)) parts.push(`crop: ${cropText(r.geometry.crop)}`)
  if (r.look) parts.push(`look=${r.look.presetId} ${r.look.amount}% ${r.look.variation}`)
  return parts.join(', ')
}

// ---------- Diffs ----------

export type DiffGroup = 'photo' | 'geometry'
export const GROUP_LABELS: Record<DiffGroup, string> = { photo: 'Whole photo', geometry: 'Crop & straighten' }

export interface DiffItem {
  /** Recipe path, for reverting. */
  path: string
  label: string
  group: DiffGroup
  from: unknown
  to: unknown
  fromText: string
  toText: string
  /** Changed alongside a visible item (e.g. the white balance preset); reverted but not shown. */
  hidden?: boolean
  /** Display order. */
  order: number
}

interface Descriptor {
  path: string
  label: string
  group: DiffGroup
  format: (v: unknown) => string
  hidden?: boolean
}

function descriptors(kind: SourceKind): Descriptor[] {
  const list: Descriptor[] = [
    { path: 'profile', label: 'Profile', group: 'photo', format: (v) => cap(String(v)) },
    { path: 'treatment', label: 'Black & white', group: 'photo', format: (v) => (v === 'bw' ? 'On' : 'Off') },
    {
      path: 'look',
      label: 'Look',
      group: 'photo',
      format: (v) => {
        const l = v as EditRecipe['look']
        return l ? `${l.name} ${l.amount}%${l.variation === 'original' ? '' : ` ${l.variation}`}` : 'None'
      },
    },
    { path: 'wb.preset', label: 'White balance', group: 'photo', format: String, hidden: true },
  ]
  for (const [path, range] of numericRanges(kind)) {
    const key = path === 'wb.temp' || path === 'wb.tint' ? `${path}.${kind}` : path
    const spec = SPECS[key]
    const signed = range.min < 0
    const unit = spec?.unit ?? (path.endsWith('.hue') ? '°' : '')
    list.push({ path, label: sliderLabel(path), group: path.startsWith('geometry.') ? 'geometry' : 'photo', format: (v) => formatValue(Number(v), spec?.dp ?? 0, signed, unit) })
    if (path === 'basic.saturation') {
      for (const ch of ['rgb', 'r', 'g', 'b']) {
        list.push({ path: `curve.${ch}`, label: `Curve · ${CHANNEL[ch]}`, group: 'photo', format: (v) => (isIdentity(v as CurvePoint[]) ? 'Linear' : 'Custom') })
      }
    }
  }
  list.push(
    { path: 'geometry.crop', label: 'Crop', group: 'geometry', format: (v) => (isFull(v as Rect) ? 'Full frame' : `${Math.round((v as Rect).w * 100)}% × ${Math.round((v as Rect).h * 100)}%`) },
    { path: 'geometry.aspect', label: 'Aspect', group: 'geometry', format: String, hidden: true },
    { path: 'geometry.rotate', label: 'Rotate', group: 'geometry', format: String, hidden: true },
    { path: 'geometry.flipH', label: 'Flip', group: 'geometry', format: String, hidden: true },
    { path: 'geometry.flipV', label: 'Flip', group: 'geometry', format: String, hidden: true },
    { path: 'layers', label: 'Masks', group: 'photo', format: String, hidden: true },
  )
  return list
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Everything that differs between two recipes, in panel order. */
export function diffRecipes(before: EditRecipe, after: EditRecipe, kind: SourceKind): DiffItem[] {
  const out: DiffItem[] = []
  descriptors(kind).forEach((d, order) => {
    const from = getPath(before, d.path)
    const to = getPath(after, d.path)
    if (same(from, to)) return
    let toText = d.format(to)
    // Two different custom curves would read "Custom → Custom".
    if (d.path.startsWith('curve.') && toText === 'Custom' && d.format(from) === 'Custom') toText = 'Adjusted'
    out.push({ path: d.path, label: d.label, group: d.group, from, to, fromText: d.format(from), toText, hidden: d.hidden, order })
  })
  return out
}

/** Combine the diffs of successive steps: first `from`, last `to`; items that ended where they began drop out. */
export function mergeDiffs(a: DiffItem[], b: DiffItem[]): DiffItem[] {
  const map = new Map(a.map((i) => [i.path, i]))
  for (const i of b) {
    const prev = map.get(i.path)
    map.set(i.path, prev ? { ...i, from: prev.from, fromText: prev.fromText } : i)
  }
  return [...map.values()].filter((i) => !same(i.from, i.to)).sort((x, y) => x.order - y.order)
}

/** Undo these changes where the value is still what the AI set (later manual edits win). */
export function revertDiff(r: EditRecipe, items: DiffItem[]): EditRecipe {
  let next = r
  for (const i of items) if (same(getPath(next, i.path), i.to)) next = setPath(next, i.path, i.from)
  return next
}

/** One line per visible change, for the model's memory of earlier turns. */
export function diffSummary(items: DiffItem[]): string {
  return items
    .filter((i) => !i.hidden)
    .map((i) => `${i.label} ${i.fromText} → ${i.toText}`)
    .join(', ')
}
