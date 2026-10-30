import { describe, expect, it } from 'vitest'
import { defaultRecipe, SPECS } from '../edit/defaults'
import { BANDS, type EditRecipe, type SourceKind } from '../edit/types'
import { applyPreset, builtinPresets, collections, findBuiltin, VARIATIONS } from './catalog'

// Names of real film stocks, film simulations and brands that looks must not use.
const BANNED = /\b(portra|ektar|ektachrome|kodachrome|kodak|velvia|provia|astia|acros|eterna|superia|fuji\w*|tri-?x|t-?max|hp5|delta \d+|ilford|cinestill|polaroid|agfa|lomo\w*|vsco|classic chrome|gold 200|ultramax|colorplus|vision3|instax)\b/i

function inRange(r: EditRecipe, kind: SourceKind): string[] {
  const bad: string[] = []
  const check = (path: string, v: number, min: number, max: number) => {
    if (!(v >= min && v <= max)) bad.push(`${path}=${v}`)
  }
  for (const [path, s] of Object.entries(SPECS)) {
    if (path.startsWith('wb.') || path.startsWith('geometry.')) continue
    const [group, key] = path.split('.')
    check(path, (r as unknown as Record<string, Record<string, number>>)[group][key], s.min, s.max)
  }
  const wb = kind === 'raw' ? [SPECS['wb.temp.raw'], SPECS['wb.tint.raw']] : [SPECS['wb.temp.display'], SPECS['wb.tint.display']]
  check('wb.temp', r.wb.temp, wb[0].min, wb[0].max)
  check('wb.tint', r.wb.tint, wb[1].min, wb[1].max)
  for (const g of ['hue', 'sat', 'lum', 'bw'] as const) for (const b of BANDS) check(`mixer.${g}.${b}`, r.mixer[g][b], -100, 100)
  for (const w of ['shadows', 'midtones', 'highlights', 'global'] as const) {
    check(`grading.${w}.hue`, r.grading[w].hue, 0, 360)
    check(`grading.${w}.sat`, r.grading[w].sat, 0, 100)
    check(`grading.${w}.lum`, r.grading[w].lum, -100, 100)
  }
  for (const ch of ['rgb', 'r', 'g', 'b'] as const) r.curve[ch].forEach((p, i) => check(`curve.${ch}[${i}]`, p.y, 0, 1))
  return bad
}

describe('catalog', () => {
  const all = builtinPresets()

  it('has 20 collections of 10 looks (200 looks, 1,000 presets with variations)', () => {
    expect(collections()).toHaveLength(20)
    for (const c of collections()) expect(c.presetIds, c.id).toHaveLength(10)
    expect(all).toHaveLength(200)
    expect(all.length * VARIATIONS.length).toBe(1000)
  })

  it('has unique ids and names, descriptions and tags', () => {
    expect(new Set(all.map((p) => p.id)).size).toBe(200)
    expect(new Set(all.map((p) => p.name.toLowerCase())).size).toBe(200)
    for (const p of all) {
      expect(p.id).toMatch(/^[a-z]+-[a-z0-9-]+$/)
      expect(p.id.startsWith(`${p.collection}-`)).toBe(true)
      expect(p.description?.length, p.id).toBeGreaterThan(15)
      expect(p.tags?.length, p.id).toBeGreaterThanOrEqual(3)
      expect(findBuiltin(p.id)).toBe(p)
    }
  })

  it('uses no film-stock or brand names', () => {
    for (const p of all) expect(`${p.name} ${p.description} ${p.tags?.join(' ')}`, p.id).not.toMatch(BANNED)
  })

  it('keeps exposure and white-balance moves small so looks travel across photos', () => {
    for (const p of all) {
      expect(Math.abs(p.data.basic?.exposure ?? 0), p.id).toBeLessThanOrEqual(0.3)
      expect(Math.abs(p.data.wbShift?.temp ?? 0), p.id).toBeLessThanOrEqual(25)
    }
  })

  it('stays within every slider range at 200 % on RAW and JPEG, in every variation', () => {
    const bases: [SourceKind, EditRecipe][] = [['display', defaultRecipe('display')], ['raw', defaultRecipe('raw', { temp: 5200, tint: 8 })]]
    for (const p of all)
      for (const v of VARIATIONS)
        for (const [kind, base] of bases) expect(inRange(applyPreset(base, p, 200, v.id, kind), kind), `${p.id} ${v.id} ${kind}`).toEqual([])
  })
})
