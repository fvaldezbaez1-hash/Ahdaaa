import { describe, expect, it } from 'vitest'
import { defaultRecipe } from '../edit/defaults'
import type { JsonSchema } from './types'
import {
  APPLY_LOOK, applyAdjustments, assistantTools, fitToRange, numericRanges, parseAdjustments, PRESET_TOOL, RESET_ADJUSTMENTS, runTool, SET_ADJUSTMENTS,
  strictSchema, toPresetData, ToolInputError,
} from './schema'

const raw = defaultRecipe('raw', { temp: 5200, tint: 4 })
const jpeg = defaultRecipe('display')

describe('slider ranges', () => {
  it('uses Kelvin for RAW and relative units for JPEG white balance', () => {
    expect(numericRanges('raw').get('wb.temp')).toMatchObject({ min: 2000, max: 50000, step: 50 })
    expect(numericRanges('display').get('wb.temp')).toMatchObject({ min: -100, max: 100 })
    expect(numericRanges('raw', true).get('wb.temp')).toMatchObject({ min: -100, max: 100 })
  })
  it('covers every slider group, with the same paths for both kinds', () => {
    const keys = [...numericRanges('raw').keys()]
    expect(keys).toContain('basic.exposure')
    expect(keys).toContain('mixer.bw.magenta')
    expect(keys).toContain('grading.global.lum')
    expect(keys).toContain('effects.fade')
    expect(keys).toContain('geometry.angle')
    expect([...numericRanges('display').keys()]).toEqual(keys)
    expect([...numericRanges('raw', true).keys()]).not.toContain('geometry.angle')
  })
  it('clamps, snaps to the step and wraps hue', () => {
    expect(fitToRange(7, { min: -5, max: 5, step: 0.01 })).toBe(5)
    expect(fitToRange(0.123456, { min: -5, max: 5, step: 0.01 })).toBe(0.12)
    expect(fitToRange(5234, { min: 2000, max: 50000, step: 50 })).toBe(5250)
    expect(fitToRange(370, { min: 0, max: 360, step: 1, wrap: true })).toBe(10)
    expect(fitToRange(-30, { min: 0, max: 360, step: 1, wrap: true })).toBe(330)
    expect(fitToRange(359.7, { min: 0, max: 360, step: 1, wrap: true })).toBe(0)
    expect(Object.is(fitToRange(-0.001, { min: -5, max: 5, step: 0.01 }), 0)).toBe(true)
  })
})

describe('parseAdjustments', () => {
  it('validates, clamps and reports corrections to the model', () => {
    const { value, notes } = parseAdjustments(
      {
        summary: 'Brighter',
        why: 'More light.',
        changes: [
          { path: 'basic.exposure', value: 9 },
          { path: 'basic.contrast', value: 12.4 },
          { path: 'basic.nope', value: 3 },
          { path: 'mixer.sat.blue', value: 'x' },
          { path: 'basic.contrast', value: 20 },
        ],
        profile: 'vivid',
        treatment: 'sepia',
      },
      'display',
    )
    expect(value.changes).toEqual([
      ['basic.exposure', 5],
      ['basic.contrast', 20],
    ])
    expect(value.profile).toBe('vivid')
    expect(value.treatment).toBeUndefined()
    expect(notes.join(' ')).toMatch(/basic\.exposure 9 is out of range; set to 5/)
    expect(notes.join(' ')).toMatch(/Unknown slider "basic\.nope"/)
    expect(notes.join(' ')).toMatch(/Unknown treatment/)
  })
  it('clamps RAW Kelvin and JPEG relative white balance differently', () => {
    const args = { summary: '', why: '', changes: [{ path: 'wb.temp', value: 80000 }, { path: 'wb.tint', value: -400 }] }
    expect(parseAdjustments(args, 'raw').value.changes).toEqual([
      ['wb.temp', 50000],
      ['wb.tint', -150],
    ])
    expect(parseAdjustments(args, 'display').value.changes).toEqual([
      ['wb.temp', 100],
      ['wb.tint', -100],
    ])
  })
  it('treats null like a missing field (OpenAI strict mode sends nulls)', () => {
    const { value, notes } = parseAdjustments({ summary: 'x', why: 'y', changes: null, profile: null, treatment: null, curves: null, crop: null }, 'raw')
    expect(value).toEqual({ summary: 'x', why: 'y', changes: [] })
    expect(notes).toEqual([])
  })
  it('normalizes curves and sanitizes the crop', () => {
    const { value } = parseAdjustments(
      { summary: '', why: '', curves: [{ channel: 'rgb', points: [{ x: 0.75, y: 0.8 }, { x: 0.25, y: 0.2 }] }], crop: { x: 0.9, y: -1, w: 0.5, h: 2 } },
      'raw',
    )
    expect(value.curves?.[0].points).toEqual([
      { x: 0, y: 0.2 },
      { x: 0.25, y: 0.2 },
      { x: 0.75, y: 0.8 },
      { x: 1, y: 0.8 },
    ])
    expect(value.crop).toEqual({ x: 0.5, y: 0, w: 0.5, h: 1 })
  })
  it('rejects input the model must fix', () => {
    expect(() => parseAdjustments('nope', 'raw')).toThrow(ToolInputError)
    expect(() => parseAdjustments({ changes: {} }, 'raw')).toThrow(/must be an array/)
    expect(() => parseAdjustments({ curves: [{ channel: 'rgb', points: [{ x: 0, y: 0 }] }] }, 'raw')).toThrow(/at least two points/)
    expect(() => parseAdjustments({ curves: [{ channel: 'cmyk', points: [] }] }, 'raw')).toThrow(/channel/)
    expect(() => parseAdjustments({ crop: { x: 0 } }, 'raw')).toThrow(/crop/)
  })
})

describe('applying to the recipe', () => {
  it('maps paths onto the recipe and marks white balance as custom', () => {
    const { value } = parseAdjustments(
      { summary: 's', why: 'w', changes: [{ path: 'wb.temp', value: 6100 }, { path: 'grading.shadows.hue', value: 200 }, { path: 'geometry.angle', value: -1.26 }], treatment: 'bw' },
      'raw',
    )
    const r = applyAdjustments(raw, value)
    expect(r.wb).toEqual({ preset: 'custom', temp: 6100, tint: 4 })
    expect(r.grading.shadows).toEqual({ hue: 200, sat: 0, lum: 0 })
    expect(r.geometry.angle).toBe(-1.3)
    expect(r.treatment).toBe('bw')
    expect(raw.wb.preset).toBe('asShot')
  })
  it('sets a free aspect for a real crop and keeps "original" for the full frame', () => {
    const crop = (c: object) => applyAdjustments(raw, parseAdjustments({ summary: '', why: '', crop: c }, 'raw').value).geometry
    expect(crop({ x: 0.1, y: 0, w: 0.8, h: 1 })).toMatchObject({ crop: { x: 0.1, y: 0, w: 0.8, h: 1 }, aspect: 'free' })
    expect(crop({ x: 0, y: 0, w: 1, h: 1 }).aspect).toBe('original')
  })
  it('runs tools and reports unknown ones', () => {
    const set = runTool(SET_ADJUSTMENTS, { summary: 'Pop', why: 'Because.', changes: [{ path: 'basic.vibrance', value: 30 }] }, jpeg, { kind: 'display' })
    expect(set.recipe.basic.vibrance).toBe(30)
    expect(set.summary).toBe('Pop')
    const edited = { ...raw, basic: { ...raw.basic, exposure: 1 }, geometry: { ...raw.geometry, angle: 2 } }
    const reset = runTool(RESET_ADJUSTMENTS, { keep_crop: true, why: '' }, edited, { kind: 'raw', asShot: { temp: 5200, tint: 4 } })
    expect(reset.recipe.basic.exposure).toBe(0)
    expect(reset.recipe.geometry.angle).toBe(2)
    expect(runTool(RESET_ADJUSTMENTS, { keep_crop: false, why: '' }, edited, { kind: 'raw', asShot: { temp: 5200, tint: 4 } }).recipe.geometry.angle).toBe(0)
    expect(() => runTool(APPLY_LOOK, { look_id: 'no-such-look', amount: 100, variation: 'original', why: '' }, raw, { kind: 'raw' })).toThrow(/Unknown look id/)
    expect(() => runTool('delete_photo', {}, raw, { kind: 'raw' })).toThrow(ToolInputError)
  })
})

describe('presets', () => {
  it('stores wheels whole and white balance as a relative shift', () => {
    const { value } = parseAdjustments(
      { name: 'Teal Night', why: 'w', changes: [{ path: 'grading.highlights.sat', value: 15 }, { path: 'wb.temp', value: -300 }, { path: 'basic.contrast', value: 10 }, { path: 'mixer.sat.blue', value: -20 }] },
      'raw',
      true,
    )
    expect(value.summary).toBe('Teal Night')
    expect(toPresetData(value)).toEqual({
      grading: { highlights: { hue: 0, sat: 15, lum: 0 } },
      wbShift: { temp: -100, tint: 0 },
      basic: { contrast: 10 },
      mixer: { sat: { blue: -20 } },
    })
  })
})

describe('tool schemas', () => {
  const walk = (s: JsonSchema, visit: (s: JsonSchema) => void) => {
    visit(s)
    if (s.items) walk(s.items as JsonSchema, visit)
    for (const p of Object.values((s.properties as Record<string, JsonSchema> | undefined) ?? {})) walk(p, visit)
  }
  it('closes every object and keeps optional fields within Anthropic strict-mode limits', () => {
    for (const tool of [...assistantTools(true), PRESET_TOOL]) {
      let optional = 0
      walk(tool.parameters, (s) => {
        if (s.type !== 'object') return
        expect(s.additionalProperties).toBe(false)
        optional += Object.keys(s.properties as object).length - (s.required as string[]).length
        // No numeric constraints: not every vendor's strict mode accepts them.
        expect(JSON.stringify(s)).not.toMatch(/"(minimum|maximum)"/)
      })
      expect(optional).toBeLessThanOrEqual(24)
    }
  })
  it('makes every property required and optional ones nullable for OpenAI', () => {
    const strict = strictSchema(assistantTools(false)[0].parameters)
    expect(strict.required).toEqual(['summary', 'why', 'changes', 'profile', 'treatment', 'curves', 'crop'])
    const props = strict.properties as Record<string, JsonSchema>
    expect(props.summary.type).toBe('string')
    expect(props.profile.type).toEqual(['string', 'null'])
    expect((props.profile.enum as unknown[]).at(-1)).toBeNull()
    expect(props.crop.type).toEqual(['object', 'null'])
    expect((props.crop.required as string[]).length).toBe(4)
    const item = (props.changes.items as JsonSchema).properties as Record<string, JsonSchema>
    expect(item.value.type).toBe('number')
  })
  it('only offers apply_look when there are looks', () => {
    expect(assistantTools(false).map((t) => t.name)).toEqual([SET_ADJUSTMENTS, RESET_ADJUSTMENTS])
    expect(assistantTools(true).map((t) => t.name)).toEqual([SET_ADJUSTMENTS, APPLY_LOOK, RESET_ADJUSTMENTS])
  })
})
