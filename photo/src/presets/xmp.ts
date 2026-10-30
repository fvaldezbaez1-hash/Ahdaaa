// Lightroom / Camera Raw presets (.xmp, the `crs:` namespace) ↔ Lumen presets.
// Settings may be attributes or child elements; masks, calibration, lens and
// transform settings have no equivalent here and are reported as not mapped.

import { BANDS, type Band, type CurvePoint, type PresetData, type ProfileId } from '../edit/types'

const CRS = 'http://ns.adobe.com/camera-raw-settings/1.0/'

export interface XmpImport {
  name: string
  data: PresetData
  /** Number of settings carried over (exactly or approximately). */
  mapped: number
  /** Settings carried over approximately, for the report. */
  approximated: string[]
  /** Groups of settings Lumen couldn't use, e.g. "Calibration (3)". */
  unmapped: string[]
}

const decode = (s: string) =>
  s.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
    if (named[e.toLowerCase()]) return named[e.toLowerCase()]
    return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
  })
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** Blocks Lumen can't translate: removed before reading settings so their inner values don't leak. */
const BLOCKS: [RegExp, string][] = [
  [/MaskGroupBasedCorrections|GradientBasedCorrections|CircularGradientBasedCorrections|PaintBasedCorrections/, 'Masks & local adjustments'],
  [/RetouchAreas|RetouchInfo|SpotRemoval/, 'Healing & spot removal'],
  [/Look$/, ''],
]

interface Raw {
  values: Map<string, string | string[]>
  blocks: Map<string, number>
  look?: string
}

/** Every `crs:` setting in the file, as text (lists for rdf:Seq), plus untranslatable blocks. */
function scan(xml: string): Raw {
  const prefix = /xmlns:([\w.-]+)\s*=\s*["']http:\/\/ns\.adobe\.com\/camera-raw-settings\/1\.0\/["']/.exec(xml)?.[1] ?? 'crs'
  const p = prefix.replace(/[.-]/g, '\\$&')
  const blocks = new Map<string, number>()
  let look: string | undefined
  // Child elements with content: <crs:Name>…</crs:Name>, <crs:ToneCurvePV2012><rdf:Seq>…
  const elements: [string, string][] = []
  let body = xml.replace(new RegExp(`<${p}:([\\w]+)(?:\\s[^>]*)?>([\\s\\S]*?)</${p}:\\1\\s*>`, 'g'), (_, key: string, inner: string) => {
    const block = BLOCKS.find(([re]) => re.test(key))
    if (block) {
      if (key === 'Look') look = new RegExp(`${p}:Name\\s*=\\s*["']([^"']*)["']`).exec(inner)?.[1] ?? /<rdf:li[^>]*>([^<]*)</.exec(inner)?.[1]
      else blocks.set(block[1], (blocks.get(block[1]) ?? 0) + 1)
      return ''
    }
    elements.push([key, inner])
    return ''
  })
  const values = new Map<string, string | string[]>()
  for (const [key, inner] of elements) {
    const items = [...inner.matchAll(/<rdf:li(?:\s[^>]*)?>([\s\S]*?)<\/rdf:li>/g)].map((m) => decode(m[1].trim()))
    values.set(key, /<rdf:Seq|<rdf:Bag/.test(inner) ? items : items.length ? items[0] : decode(inner.trim()))
  }
  // Attributes: crs:Exposure2012="+0.30" (self-closing look blocks were removed above when they had content).
  body = body.replace(new RegExp(`<${p}:Look[^>]*/>`, 'g'), (m) => {
    look = new RegExp(`${p}:Name\\s*=\\s*["']([^"']*)["']`).exec(m)?.[1] ?? look
    return ''
  })
  for (const m of body.matchAll(new RegExp(`\\b${p}:([\\w]+)\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'g'))) values.set(m[1], decode(m[2] ?? m[3] ?? ''))
  return { values, blocks, look: look && decode(look) }
}

/** Lightroom's band names. */
const LR_BANDS: Record<Band, string> = { red: 'Red', orange: 'Orange', yellow: 'Yellow', green: 'Green', aqua: 'Aqua', blue: 'Blue', purple: 'Purple', magenta: 'Magenta' }

const BASIC: [string, keyof NonNullable<PresetData['basic']>][] = [
  ['Exposure2012', 'exposure'], ['Contrast2012', 'contrast'], ['Highlights2012', 'highlights'], ['Shadows2012', 'shadows'], ['Whites2012', 'whites'], ['Blacks2012', 'blacks'],
  ['Texture', 'texture'], ['Clarity2012', 'clarity'], ['Dehaze', 'dehaze'], ['Vibrance', 'vibrance'], ['Saturation', 'saturation'],
]
const DETAIL: [string, keyof NonNullable<PresetData['detail']>][] = [
  ['Sharpness', 'sharpen'], ['SharpenRadius', 'radius'], ['SharpenDetail', 'detail'], ['SharpenEdgeMasking', 'masking'],
  ['LuminanceSmoothing', 'noise'], ['LuminanceNoiseReductionDetail', 'noiseDetail'], ['ColorNoiseReduction', 'colorNoise'],
]
const EFFECTS: [string, keyof NonNullable<PresetData['effects']>][] = [
  ['PostCropVignetteAmount', 'vignette'], ['PostCropVignetteMidpoint', 'vignetteMidpoint'], ['PostCropVignetteRoundness', 'vignetteRoundness'], ['PostCropVignetteFeather', 'vignetteFeather'],
  ['GrainAmount', 'grain'], ['GrainSize', 'grainSize'], ['GrainFrequency', 'grainRoughness'],
]
const WHEELS: [string, 'shadows' | 'midtones' | 'highlights' | 'global'][] = [['Shadow', 'shadows'], ['Midtone', 'midtones'], ['Highlight', 'highlights'], ['Global', 'global']]
const CURVES: [string, 'rgb' | 'r' | 'g' | 'b'][] = [['ToneCurvePV2012', 'rgb'], ['ToneCurvePV2012Red', 'r'], ['ToneCurvePV2012Green', 'g'], ['ToneCurvePV2012Blue', 'b']]
const PROFILES: Record<string, ProfileId> = { 'adobe color': 'color', 'adobe standard': 'color', 'adobe vivid': 'vivid', 'adobe portrait': 'portrait', 'adobe landscape': 'landscape', 'adobe neutral': 'neutral', 'camera neutral': 'neutral', 'camera flat': 'flat' }

/** Bookkeeping, identity and naming fields: not settings. */
const META = new Set([
  'PresetType', 'Cluster', 'UUID', 'SupportsAmount', 'SupportsAmount2', 'SupportsColor', 'SupportsMonochrome', 'SupportsHighDynamicRange', 'SupportsNormalDynamicRange',
  'SupportsSceneReferred', 'SupportsOutputReferred', 'RequiresRGBTables', 'CameraModelRestriction', 'Copyright', 'ContactInfo', 'Version', 'ProcessVersion', 'HasSettings',
  'Name', 'ShortName', 'SortName', 'Group', 'Description', 'ToneCurveName', 'ToneCurveName2012', 'WhiteBalance', 'CameraProfile', 'CameraProfileDigest', 'AlreadyApplied',
  'HasCrop', 'Amount', 'Look', 'OverrideLookVignette', 'ConvertToGrayscale', 'Temperature', 'Tint', 'IncrementalTemperature', 'IncrementalTint',
])

/** Lightroom defaults for settings Lumen ignores: a default value isn't worth reporting. */
const LR_DEFAULTS: Record<string, number> = {
  PerspectiveScale: 100, ColorNoiseReductionDetail: 50, ColorNoiseReductionSmoothness: 50, PostCropVignetteStyle: 1, LensProfileDistortionScale: 100, LensProfileVignettingScale: 100,
  DefringePurpleHueLo: 30, DefringePurpleHueHi: 70, DefringeGreenHueLo: 40, DefringeGreenHueHi: 60, ParametricShadowSplit: 25, ParametricMidtoneSplit: 50, ParametricHighlightSplit: 75,
  GrainSize: 25, GrainFrequency: 50, SharpenRadius: 1, SharpenDetail: 25, LuminanceNoiseReductionDetail: 50, PostCropVignetteMidpoint: 50, PostCropVignetteFeather: 50,
  ColorGradeBlending: 50, Sharpness: 40, ColorNoiseReduction: 25,
}

function groupOf(key: string): string {
  if (/^(Red|Green|Blue)(Hue|Saturation)$|^ShadowTint$/.test(key)) return 'Calibration'
  if (/^Lens|^AutoLateralCA|^VignetteAmount$|^VignetteMidpoint$|^ChromaticAberration/.test(key)) return 'Lens corrections'
  if (/^Perspective|^Upright|^AutoPerspective/.test(key)) return 'Transform'
  if (/^Defringe/.test(key)) return 'Defringe'
  if (/^Crop/.test(key)) return 'Crop'
  if (/^Parametric/.test(key)) return 'Parametric curve'
  if (/Noise|Smoothness/.test(key)) return 'Noise reduction details'
  if (/^PostCropVignette/.test(key)) return 'Vignette style'
  if (/^(Enhance|Super|Denoise|Lens Blur|LensBlur)/.test(key)) return 'AI enhancements'
  if (/^(Exposure|Contrast|Highlights|Shadows|Brightness|Clarity|FillLight|HighlightRecovery)$/.test(key)) return 'Older process-version tone settings'
  return key
}

const num = (v: string | string[] | undefined): number | undefined => {
  if (typeof v !== 'string' || v.trim() === '') return undefined
  const n = Number(v.trim().replace(/^\+/, ''))
  return Number.isFinite(n) ? n : undefined
}
const isDefault = (key: string, v: string | string[]) => {
  if (Array.isArray(v)) return v.length === 0
  const n = num(v)
  if (n !== undefined) return n === (LR_DEFAULTS[key] ?? 0)
  return /^(false|off|)$/i.test(v.trim())
}

function curveOf(v: string | string[] | undefined): CurvePoint[] | undefined {
  if (!Array.isArray(v)) return undefined
  const pts = v.map((s) => s.split(',').map(Number)).filter((p) => p.length === 2 && p.every(Number.isFinite)).map(([x, y]) => ({ x: Math.min(1, Math.max(0, x / 255)), y: Math.min(1, Math.max(0, y / 255)) }))
  const identity = pts.length < 2 || pts.every((p) => Math.abs(p.x - p.y) < 1e-6)
  return identity ? undefined : pts
}

/** Lightroom's parametric curve, sampled into points (regions keep their default splits). */
function parametricCurve(get: (k: string) => number | undefined): CurvePoint[] | undefined {
  const r = [get('ParametricShadows') ?? 0, get('ParametricDarks') ?? 0, get('ParametricLights') ?? 0, get('ParametricHighlights') ?? 0]
  if (r.every((v) => v === 0)) return undefined
  const xs = [0.125, 0.375, 0.625, 0.875]
  return [{ x: 0, y: 0 }, ...xs.map((x, i) => ({ x, y: Math.min(1, Math.max(0, x + (r[i] / 100) * 0.1)) })), { x: 1, y: 1 }]
}

/** Read one .xmp preset. Throws if the file has no Camera Raw settings. */
export function parseXmp(xml: string, fileName = 'Preset'): XmpImport {
  if (!xml.includes(CRS) && !/\bcrs:/.test(xml)) throw new Error('Not a Lightroom or Camera Raw preset (no Camera Raw settings found).')
  const { values, blocks, look } = scan(xml)
  const used = new Set<string>()
  const approximated: string[] = []
  const get = (k: string) => {
    const n = num(values.get(k))
    if (n !== undefined) used.add(k)
    return n
  }
  const data: PresetData = {}
  const set = <K extends keyof PresetData>(group: K, key: string, v: number | undefined) => {
    if (v === undefined) return
    const g = (data[group] ?? {}) as Record<string, number>
    g[key] = v
    ;(data as Record<string, unknown>)[group] = g
  }

  for (const [lr, k] of BASIC) set('basic', k, get(lr))
  for (const [lr, k] of DETAIL) set('detail', k, get(lr))
  for (const [lr, k] of EFFECTS) set('effects', k, get(lr))

  // Only settings the preset changes travel; Lightroom files list everything, mostly at defaults.
  const prune = (group: 'basic' | 'detail' | 'effects', table: [string, string][]) => {
    const g = data[group] as Record<string, number> | undefined
    if (!g) return
    for (const [lr, k] of table) if (g[k] === (LR_DEFAULTS[lr] ?? 0)) delete g[k]
    if (!Object.keys(g).length) delete data[group]
  }
  prune('basic', BASIC)
  prune('detail', DETAIL)
  prune('effects', EFFECTS)

  const mixer: NonNullable<PresetData['mixer']> = {}
  for (const b of BANDS) {
    const lr = LR_BANDS[b]
    const put = (g: 'hue' | 'sat' | 'lum' | 'bw', v: number | undefined) => {
      if (v) mixer[g] = { ...mixer[g], [b]: v }
    }
    put('hue', get(`HueAdjustment${lr}`))
    put('sat', get(`SaturationAdjustment${lr}`))
    put('lum', get(`LuminanceAdjustment${lr}`))
    put('bw', get(`GrayMixer${lr}`))
  }
  if (Object.keys(mixer).length) data.mixer = mixer

  const gray = values.get('ConvertToGrayscale')
  if (typeof gray === 'string') {
    used.add('ConvertToGrayscale')
    data.treatment = /^true$/i.test(gray.trim()) ? 'bw' : 'color'
  }

  // White balance: relative shifts carry over; an absolute Kelvin value becomes a shift from daylight.
  const it = get('IncrementalTemperature'), iti = get('IncrementalTint')
  const t = get('Temperature'), ti = get('Tint')
  if (it !== undefined || iti !== undefined) {
    if (it || iti) data.wbShift = { temp: Math.round(it ?? 0), tint: Math.round(iti ?? 0) }
  } else if (t !== undefined || ti !== undefined) {
    const temp = t ? Math.round(1e6 / 5500 - 1e6 / t) : 0
    if (temp || ti) data.wbShift = { temp: Math.max(-100, Math.min(100, temp)), tint: Math.round(ti ?? 0) }
    approximated.push(`White balance${t ? ` (${Math.round(t)} K)` : ''} as a shift from daylight`)
  }

  const curve: NonNullable<PresetData['curve']> = {}
  for (const [lr, ch] of CURVES) {
    if (!values.has(lr)) continue
    used.add(lr)
    const c = curveOf(values.get(lr))
    if (c) curve[ch] = c
  }
  const param = parametricCurve(get)
  if (param && !curve.rgb) {
    curve.rgb = param
    approximated.push('Parametric curve as a point curve')
  } else if (param) for (const k of ['ParametricShadows', 'ParametricDarks', 'ParametricLights', 'ParametricHighlights']) used.delete(k)
  if (Object.keys(curve).length) data.curve = curve

  // Color grading (Lightroom 10+), or the older split toning.
  const grading: NonNullable<PresetData['grading']> = {}
  const hasGrade = values.has('ColorGradeShadowLum') || values.has('ColorGradeMidtoneHue') || values.has('ColorGradeBlending')
  for (const [lr, w] of WHEELS) {
    const hue = get(`ColorGrade${lr}Hue`) ?? 0, sat = get(`ColorGrade${lr}Sat`) ?? 0, lum = get(`ColorGrade${lr}Lum`) ?? 0
    if (sat || lum) grading[w] = { hue, sat, lum }
  }
  const blend = get('ColorGradeBlending')
  if (blend !== undefined && blend !== 50) grading.blending = blend
  if (!hasGrade) {
    for (const [lr, w] of [['Shadow', 'shadows'], ['Highlight', 'highlights']] as const) {
      const hue = get(`SplitToning${lr}Hue`) ?? 0, sat = get(`SplitToning${lr}Saturation`) ?? 0
      if (sat) grading[w] = { hue, sat, lum: 0 }
    }
  } else for (const k of ['SplitToningShadowHue', 'SplitToningShadowSaturation', 'SplitToningHighlightHue', 'SplitToningHighlightSaturation', 'SplitToningBalance']) if (values.has(k)) used.add(k)
  const bal = get('ColorGradeBalance') ?? (hasGrade ? undefined : get('SplitToningBalance'))
  if (bal) grading.balance = bal
  if (Object.keys(grading).length) data.grading = grading

  if (look) {
    const profile = PROFILES[look.toLowerCase()]
    if (look.toLowerCase().includes('monochrome')) data.treatment = 'bw'
    else if (profile) data.profile = profile
    else blocks.set(`Profile “${look}”`, 1)
  }
  const cam = values.get('CameraProfile')
  if (typeof cam === 'string' && !look && PROFILES[cam.toLowerCase()] && PROFILES[cam.toLowerCase()] !== 'color') data.profile = PROFILES[cam.toLowerCase()]

  // Everything else that holds a non-default value goes in the report.
  const groups = new Map<string, number>(blocks)
  for (const [k, v] of values) {
    if (used.has(k) || META.has(k) || isDefault(k, v)) continue
    if (/^(HueAdjustment|SaturationAdjustment|LuminanceAdjustment|GrayMixer|ColorGrade|SplitToning|Parametric)/.test(k) && num(v) === 0) continue
    const g = groupOf(k)
    groups.set(g, (groups.get(g) ?? 0) + 1)
  }
  const unmapped = [...groups].map(([g, n]) => (n > 1 ? `${g} (${n})` : g))
  const lrName = values.get('Name')
  const name = (typeof lrName === 'string' && lrName.trim()) || fileName.replace(/\.xmp$/i, '')
  const mapped = [...used].filter((k) => !isDefault(k, values.get(k)!)).length + (data.profile ? 1 : 0)
  return { name, data, mapped, approximated, unmapped }
}

// ---------- Export ----------

const fmt = (v: number, signed = true) => (signed && v > 0 ? `+${v}` : String(v))

/** A Lumen preset as a Lightroom-compatible .xmp. */
export function toXmp(name: string, d: PresetData, uuid: string): string {
  const attrs: [string, string][] = [
    ['PresetType', 'Normal'], ['Cluster', ''], ['UUID', uuid.replace(/-/g, '').toUpperCase()], ['SupportsAmount2', 'True'], ['SupportsAmount', 'True'],
    ['SupportsColor', 'True'], ['SupportsMonochrome', 'True'], ['Version', '15.0'], ['ProcessVersion', '11.0'],
  ]
  for (const [lr, k] of BASIC) if (d.basic?.[k] !== undefined) attrs.push([lr, k === 'exposure' ? fmt(Number(d.basic[k]!.toFixed(2))) : fmt(d.basic[k]!)])
  if (d.wbShift) attrs.push(['IncrementalTemperature', fmt(d.wbShift.temp)], ['IncrementalTint', fmt(d.wbShift.tint)])
  for (const b of BANDS) {
    const lr = LR_BANDS[b]
    if (d.mixer?.hue?.[b]) attrs.push([`HueAdjustment${lr}`, fmt(d.mixer.hue[b]!)])
    if (d.mixer?.sat?.[b]) attrs.push([`SaturationAdjustment${lr}`, fmt(d.mixer.sat[b]!)])
    if (d.mixer?.lum?.[b]) attrs.push([`LuminanceAdjustment${lr}`, fmt(d.mixer.lum[b]!)])
    if (d.mixer?.bw?.[b]) attrs.push([`GrayMixer${lr}`, fmt(d.mixer.bw[b]!)])
  }
  for (const [lr, w] of WHEELS) {
    const wh = d.grading?.[w]
    if (wh) attrs.push([`ColorGrade${lr}Hue`, String(Math.round(wh.hue))], [`ColorGrade${lr}Sat`, String(Math.round(wh.sat))], [`ColorGrade${lr}Lum`, fmt(Math.round(wh.lum))])
  }
  if (d.grading?.blending !== undefined) attrs.push(['ColorGradeBlending', String(d.grading.blending)])
  if (d.grading?.balance !== undefined) attrs.push(['ColorGradeBalance', fmt(d.grading.balance)])
  for (const [lr, k] of DETAIL) if (d.detail?.[k] !== undefined) attrs.push([lr, String(d.detail[k])])
  for (const [lr, k] of EFFECTS) if (d.effects?.[k] !== undefined) attrs.push([lr, k === 'vignette' || k === 'vignetteRoundness' ? fmt(d.effects[k]!) : String(d.effects[k])])
  if (d.treatment) attrs.push(['ConvertToGrayscale', d.treatment === 'bw' ? 'True' : 'False'])
  attrs.push(['HasSettings', 'True'])

  const curves = CURVES.filter(([, ch]) => d.curve?.[ch]).map(([lr, ch]) => {
    const items = d.curve![ch]!.map((p) => `      <rdf:li>${Math.round(p.x * 255)}, ${Math.round(p.y * 255)}</rdf:li>`).join('\n')
    return `   <crs:${lr}>\n    <rdf:Seq>\n${items}\n    </rdf:Seq>\n   </crs:${lr}>`
  })
  return `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Lumen">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:crs="${CRS}"
${attrs.map(([k, v]) => `   crs:${k}="${esc(v)}"`).join('\n')}>
   <crs:Name>
    <rdf:Alt>
     <rdf:li xml:lang="x-default">${esc(name)}</rdf:li>
    </rdf:Alt>
   </crs:Name>
${curves.join('\n')}
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
`
}
