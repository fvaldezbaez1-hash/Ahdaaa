import { describe, expect, it } from 'vitest'
import { defaultRecipe } from '../edit/defaults'
import { setPath } from '../edit/path'
import type { EditRecipe } from '../edit/types'
import { describeRecipe, diffRecipes, diffSummary, mergeDiffs, revertDiff, sliderLabel } from './recipeText'

const asShot = { temp: 5200, tint: 4 }
const raw = defaultRecipe('raw', asShot)
const edit = (r: EditRecipe, changes: [string, unknown][]) => changes.reduce((acc, [p, v]) => setPath(acc, p, v), r)

describe('describeRecipe', () => {
  it('always states white balance and leaves defaults out', () => {
    expect(describeRecipe(raw, 'raw', asShot)).toBe('profile=color, treatment=color, wb.temp=5200, wb.tint=4')
  })
  it('lists changed sliders, curves, crop and look with tool paths', () => {
    const r = edit(raw, [
      ['basic.exposure', 0.35],
      ['mixer.sat.blue', -20],
      ['curve.rgb', [{ x: 0, y: 0.05 }, { x: 1, y: 1 }]],
      ['geometry.crop', { x: 0.1, y: 0, w: 0.8, h: 1 }],
      ['look', { presetId: 'film-warm-400', name: 'Warm 400', amount: 80, variation: 'warmer' }],
    ])
    const text = describeRecipe(r, 'raw', asShot)
    expect(text).toContain('basic.exposure=0.35')
    expect(text).toContain('mixer.sat.blue=-20')
    expect(text).toContain('curve.rgb=(0,0.05) (1,1)')
    expect(text).toContain('crop: x=0.1 y=0 w=0.8 h=1')
    expect(text).toContain('look=film-warm-400 80% warmer')
    expect(text).not.toContain('detail.sharpen')
  })
})

describe('diffRecipes', () => {
  it('formats old → new like the sliders do', () => {
    const r = edit(raw, [
      ['basic.exposure', 0.3],
      ['wb.temp', 5600],
      ['wb.preset', 'custom'],
      ['grading.shadows.hue', 210],
      ['treatment', 'bw'],
      ['geometry.angle', -1.5],
    ])
    const d = diffRecipes(raw, r, 'raw')
    const byPath = Object.fromEntries(d.map((i) => [i.path, i]))
    expect(byPath['basic.exposure']).toMatchObject({ label: 'Exposure', fromText: '0.00', toText: '+0.30', group: 'photo' })
    expect(byPath['wb.temp']).toMatchObject({ label: 'Temperature', fromText: '5200 K', toText: '5600 K' })
    expect(byPath['wb.preset'].hidden).toBe(true)
    expect(byPath['grading.shadows.hue']).toMatchObject({ label: 'Shadows hue', toText: '210°' })
    expect(byPath.treatment).toMatchObject({ label: 'Black & white', fromText: 'Off', toText: 'On' })
    expect(byPath['geometry.angle']).toMatchObject({ label: 'Straighten', toText: '−1.5°', group: 'geometry' })
    // Panel order: treatment before white balance before tone before grading.
    expect(d.map((i) => i.path).indexOf('treatment')).toBeLessThan(d.map((i) => i.path).indexOf('basic.exposure'))
  })
  it('uses signed relative units for JPEG white balance', () => {
    const j = defaultRecipe('display')
    expect(diffRecipes(j, edit(j, [['wb.temp', 15]]), 'display')[0]).toMatchObject({ fromText: '0', toText: '+15' })
  })
  it('names curves and labels mixer bands', () => {
    const r = edit(raw, [['curve.r', [{ x: 0, y: 0.1 }, { x: 1, y: 1 }]]])
    expect(diffRecipes(raw, r, 'raw')[0]).toMatchObject({ label: 'Curve · Red', fromText: 'Linear', toText: 'Custom' })
    const r2 = edit(r, [['curve.r', [{ x: 0, y: 0.2 }, { x: 1, y: 1 }]]])
    expect(diffRecipes(r, r2, 'raw')[0].toText).toBe('Adjusted')
    expect(sliderLabel('mixer.lum.orange')).toBe('Orange luminance')
    expect(sliderLabel('mixer.bw.blue')).toBe('B&W blue')
    expect(sliderLabel('grading.balance')).toBe('Grading balance')
  })
})

describe('merging and reverting', () => {
  it('keeps the first "from" and the last "to", dropping round trips', () => {
    const a = edit(raw, [['basic.exposure', 0.5], ['basic.contrast', 10]])
    const b = edit(a, [['basic.exposure', 0.3], ['basic.contrast', 0]])
    const merged = mergeDiffs(diffRecipes(raw, a, 'raw'), diffRecipes(a, b, 'raw'))
    expect(merged.map((i) => [i.path, i.fromText, i.toText])).toEqual([['basic.exposure', '0.00', '+0.30']])
    expect(diffSummary(merged)).toBe('Exposure 0.00 → +0.30')
  })
  it('reverts only what is still as the AI left it', () => {
    const ai = edit(raw, [['basic.exposure', 0.5], ['basic.contrast', 20]])
    const diff = diffRecipes(raw, ai, 'raw')
    const userTouched = edit(ai, [['basic.contrast', 35], ['basic.clarity', 10]])
    const back = revertDiff(userTouched, diff)
    expect(back.basic.exposure).toBe(0)
    expect(back.basic.contrast).toBe(35)
    expect(back.basic.clarity).toBe(10)
  })
})
