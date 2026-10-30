import { describe, expect, it } from 'vitest'
import { IDENTITY_CURVE } from '../color/curve'
import { shiftWb } from '../color/wb'
import { defaultRecipe, SPECS } from '../edit/defaults'
import { getPath, setPath } from '../edit/path'
import type { EditRecipe, Preset } from '../edit/types'
import { applyPreset, scaleCurve, stripLook } from './apply'

const look: Preset = {
  id: 'test-look',
  name: 'Test Look',
  collection: 'test',
  data: {
    treatment: 'color',
    wbShift: { temp: 10, tint: 4 },
    basic: { contrast: 20, exposure: 0.1, saturation: -10 },
    curve: { rgb: [{ x: 0, y: 0.1 }, { x: 0.5, y: 0.5 }, { x: 1, y: 0.9 }] },
    mixer: { sat: { green: -20 }, bw: { blue: -30 } },
    grading: { shadows: { hue: 200, sat: 20, lum: 0 }, blending: 70 },
    effects: { grain: 20, grainSize: 40, vignette: -20 },
    detail: { sharpen: 60 },
  },
}
const mono: Preset = { id: 'mono', name: 'Mono', collection: 'test', data: { treatment: 'bw', basic: { contrast: 30 } } }

const jpeg = () => defaultRecipe('display')
const raw = () => defaultRecipe('raw', { temp: 5000, tint: 5 })
const without = (r: EditRecipe) => JSON.stringify({ ...r, look: undefined })

describe('applyPreset', () => {
  it('adds the look at 100 %', () => {
    const r = applyPreset(jpeg(), look, 100, 'original', 'display')
    expect(r.basic.contrast).toBe(20)
    expect(r.basic.exposure).toBe(0.1)
    expect(r.wb).toEqual({ preset: 'custom', temp: 10, tint: 4 })
    expect(r.curve.rgb).toEqual([{ x: 0, y: 0.1 }, { x: 0.5, y: 0.5 }, { x: 1, y: 0.9 }])
    expect(r.mixer.sat.green).toBe(-20)
    expect(r.grading.shadows).toEqual({ hue: 200, sat: 20, lum: 0 })
    expect(r.grading.blending).toBe(70)
    expect(r.effects).toMatchObject({ grain: 20, grainSize: 40, vignette: -20 })
    expect(r.detail.sharpen).toBe(60)
    expect(r.look).toMatchObject({ presetId: 'test-look', name: 'Test Look', amount: 100, variation: 'original' })
  })

  it('scales amounts at 50 % and 200 %, while settings snap to the look', () => {
    const half = applyPreset(jpeg(), look, 50, 'original', 'display')
    expect(half.basic.contrast).toBe(10)
    expect(half.basic.exposure).toBe(0.05)
    expect(half.wb.temp).toBe(5)
    expect(half.curve.rgb[0].y).toBeCloseTo(0.05)
    expect(half.grading.shadows.sat).toBe(10)
    expect(half.effects.grain).toBe(10)
    expect(half.effects.grainSize).toBe(40)
    const double = applyPreset(jpeg(), look, 200, 'original', 'display')
    expect(double.basic.contrast).toBe(40)
    expect(double.mixer.sat.green).toBe(-40)
    expect(double.curve.rgb[0].y).toBeCloseTo(0.2)
    expect(double.curve.rgb[2].y).toBeCloseTo(0.8)
  })

  it('at 0 % leaves the photo as it was but remembers the look', () => {
    const before = jpeg()
    const r = applyPreset(before, look, 0, 'original', 'display')
    expect(without(r)).toBe(without(before))
    expect(r.look?.amount).toBe(0)
  })

  it('clamps to the slider ranges', () => {
    const base = setPath(jpeg(), 'basic.contrast', 90)
    const r = applyPreset(base, look, 200, 'original', 'display')
    expect(r.basic.contrast).toBe(SPECS['basic.contrast'].max)
    for (const v of r.curve.rgb) expect(v.y).toBeGreaterThanOrEqual(0)
  })

  it('re-applying never stacks', () => {
    let r = applyPreset(jpeg(), look, 100, 'original', 'display')
    r = applyPreset(r, look, 100, 'original', 'display')
    expect(r.basic.contrast).toBe(20)
    r = applyPreset(r, look, 40, 'original', 'display')
    r = applyPreset(r, look, 100, 'original', 'display')
    expect(without(r)).toBe(without(applyPreset(jpeg(), look, 100, 'original', 'display')))
  })

  it('switching looks takes the old one off first', () => {
    const r = applyPreset(applyPreset(jpeg(), look, 100, 'original', 'display'), mono, 100, 'original', 'display')
    expect(r.treatment).toBe('bw')
    expect(r.basic.contrast).toBe(30)
    expect(r.wb).toEqual(jpeg().wb)
    expect(r.curve.rgb).toEqual(IDENTITY_CURVE)
    expect(r.effects.grain).toBe(0)
    expect(r.look?.presetId).toBe('mono')
  })

  it('keeps edits the user made after the look', () => {
    let r = applyPreset(jpeg(), look, 100, 'original', 'display')
    r = setPath(r, 'basic.contrast', 35) // user nudged +15 on top of the look's +20
    r = setPath(r, 'basic.shadows', 25) // untouched by the look
    r = applyPreset(r, look, 50, 'original', 'display')
    expect(r.basic.contrast).toBe(25)
    expect(r.basic.shadows).toBe(25)
  })

  it('keeps geometry and fields the look does not set', () => {
    const base = setPath(setPath(jpeg(), 'geometry.angle', 3.5), 'basic.highlights', -40)
    const r = applyPreset(base, look, 100, 'original', 'display')
    expect(r.geometry).toEqual(base.geometry)
    expect(r.basic.highlights).toBe(-40)
  })

  it('shifts RAW white balance in mireds from the photo’s own', () => {
    const r = applyPreset(raw(), look, 100, 'original', 'raw')
    expect(r.wb).toMatchObject(shiftWb('raw', { temp: 5000, tint: 5 }, 10, 4))
    expect(r.wb.temp).toBeGreaterThan(5000)
    expect(stripLook(r).wb).toEqual(raw().wb)
  })

  it('composes a look curve with the photo’s own curve', () => {
    const base = setPath(jpeg(), 'curve.rgb', [{ x: 0, y: 0 }, { x: 0.5, y: 0.6 }, { x: 1, y: 1 }])
    const r = applyPreset(base, look, 100, 'original', 'display')
    expect(r.curve.rgb[0].y).toBeCloseTo(0.1, 2)
    expect(stripLook(r).curve.rgb).toEqual(base.curve.rgb)
  })

  it('records only what changed and restores it exactly', () => {
    const base = raw()
    const r = applyPreset(base, look, 137, 'original', 'raw')
    expect(Object.keys(r.look?.base ?? {})).toContain('basic.contrast')
    for (const [path, v] of Object.entries(r.look?.set ?? {})) expect(getPath(r, path)).toEqual(v)
    expect(stripLook(r)).toEqual(base)
  })
})

describe('scaleCurve', () => {
  it('stays inside 0…1 and never decreases', () => {
    const c = scaleCurve([{ x: 0, y: 0.1 }, { x: 0.75, y: 0.8 }, { x: 1, y: 0.82 }], 2.7)
    for (let i = 0; i < c.length; i++) {
      expect(c[i].y).toBeGreaterThanOrEqual(0)
      expect(c[i].y).toBeLessThanOrEqual(1)
      if (i) expect(c[i].y).toBeGreaterThanOrEqual(c[i - 1].y)
    }
  })
})
