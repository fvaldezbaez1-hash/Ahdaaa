import { describe, expect, it } from 'vitest'
import { defaultRecipe } from '../../edit/defaults'
import type { ColorRange, Levels } from '../../edit/types'
import { rangeMembership } from '../../engine/colorEditor'
import { dragSlice, hitSlice, hueInSlice, newRange, SAT_GAP, sectorPath, sliceHandles, wrapHue } from '../math/colorRange'
import { autoLevels, gammaFromMid, IDENTITY, isIdentity, midPosition, moveHandle, pickPoint, transfer } from '../math/levels'
import { pointToHueSat } from '../math/wheel'

const levels = (): Levels => structuredClone(defaultRecipe('display').levels)

describe('levels handles', () => {
  it('the midtone handle and gamma convert both ways', () => {
    for (const c of [IDENTITY, { ...IDENTITY, inBlack: 30, inWhite: 200 }]) {
      for (const g of [0.25, 0.5, 1, 1.46, 2.5, 6]) {
        const m = midPosition({ ...c, gamma: g })
        expect(gammaFromMid(c, m)).toBeCloseTo(g, 2)
      }
    }
    expect(midPosition(IDENTITY)).toBe(127.5)
  })

  it('midtones left of center brighten (gamma > 1), right darken', () => {
    expect(moveHandle(IDENTITY, 'mid', 90).gamma).toBeGreaterThan(1)
    expect(moveHandle(IDENTITY, 'mid', 170).gamma).toBeLessThan(1)
    expect(transfer(moveHandle(IDENTITY, 'mid', 90), 0.5)).toBeGreaterThan(0.5)
  })

  it('input black and white keep their order and gap; values stay 0…255 whole numbers', () => {
    const c = { ...IDENTITY, inWhite: 100 }
    expect(moveHandle(c, 'inBlack', 150).inBlack).toBe(98)
    expect(moveHandle({ ...IDENTITY, inBlack: 120 }, 'inWhite', 10).inWhite).toBe(122)
    expect(moveHandle(IDENTITY, 'inBlack', -40).inBlack).toBe(0)
    expect(moveHandle(IDENTITY, 'outWhite', 300.7).outWhite).toBe(255)
    expect(moveHandle(IDENTITY, 'outBlack', 12.6).outBlack).toBe(13)
  })

  it('the midtone keeps its gamma when black or white move', () => {
    const c = { ...IDENTITY, gamma: 1.8 }
    expect(moveHandle(c, 'inBlack', 40).gamma).toBe(1.8)
    expect(moveHandle(c, 'inWhite', 200).gamma).toBe(1.8)
  })

  it('transfer maps the input range onto the output range', () => {
    const c = { inBlack: 20, inWhite: 220, gamma: 1, outBlack: 10, outWhite: 240 }
    expect(transfer(c, 20 / 255)).toBeCloseTo(10 / 255, 6)
    expect(transfer(c, 220 / 255)).toBeCloseTo(240 / 255, 6)
    expect(transfer(c, 0)).toBeCloseTo(10 / 255, 6)
    expect(transfer(c, 1)).toBeCloseTo(240 / 255, 6)
    expect(isIdentity(IDENTITY) && !isIdentity(c)).toBe(true)
  })

  it('Auto finds the darkest and brightest tones, ignoring a few outliers', () => {
    const bins = new Array(256).fill(0)
    for (let i = 20; i <= 230; i++) bins[i] = 100
    bins[0] = 1 // one stray black pixel
    expect(autoLevels(bins)).toEqual({ inBlack: 20, inWhite: 230 })
    expect(autoLevels(new Array(256).fill(0))).toEqual({ inBlack: 0, inWhite: 255 })
  })

  it('pickers: white and black set each channel; gray makes the sample neutral', () => {
    const w = pickPoint(levels(), 'white', [0.9, 0.8, 0.7])
    expect([w.r.inWhite, w.g.inWhite, w.b.inWhite]).toEqual([230, 204, 179])
    expect(w.rgb).toEqual(IDENTITY)
    const b = pickPoint(levels(), 'black', [0.1, 0.05, 0.08])
    expect([b.r.inBlack, b.g.inBlack, b.b.inBlack]).toEqual([26, 13, 20])
    const sample: [number, number, number] = [0.6, 0.5, 0.4]
    const g = pickPoint(levels(), 'gray', sample)
    const out = [transfer(g.r, sample[0]), transfer(g.g, sample[1]), transfer(g.b, sample[2])]
    expect(Math.max(...out) - Math.min(...out)).toBeLessThan(0.01)
  })
})

const range = (patch: Partial<ColorRange> = {}): ColorRange => ({ ...newRange('r1', 'Color 1', 200, 60), ...patch })
const R = 100

describe('color editor slice on the wheel', () => {
  it('a new range is a moderate slice around the pick; skin tone has uniformity', () => {
    const r = newRange('a', 'Color 1', 365, 60)
    expect(r).toMatchObject({ hue: 5, sat: 60, hueWidth: 15, satLow: 25, satHigh: 95, smooth: 50, hueShift: 0 })
    expect(r.uniformity).toBeUndefined()
    const s = newRange('b', 'Skin tone 1', 25, 40, true)
    expect(s).toMatchObject({ hueWidth: 25, satLow: 16, satHigh: 70, uniformity: { hue: 0, sat: 0, light: 0 } })
  })

  it('a muted pick leans the slice away from near-gray colors', () => {
    const r = newRange('a', 'Color 1', 220, 14)
    expect(r.satLow).toBe(6)
    expect(rangeMembership(r, 220, 0)).toBeLessThan(0.7)
    expect(rangeMembership(r, 220, 0.14)).toBe(1)
  })

  it('handles sit where the range says and map back to it', () => {
    for (const hue of [0, 5, 90, 200, 359]) {
      const r = range({ hue, sat: 60 })
      const h = sliceHandles(r, R)
      expect(pointToHueSat(h.center.x, h.center.y, R)).toEqual({ hue, sat: 60 })
      expect(pointToHueSat(h.hueA.x, h.hueA.y, R).hue).toBe(wrapHue(hue - r.hueWidth))
      expect(pointToHueSat(h.hueB.x, h.hueB.y, R).hue).toBe(wrapHue(hue + r.hueWidth))
      expect(hitSlice(r, R, h.center.x + 2, h.center.y, 9)).toBe('center')
      expect(hitSlice(r, R, h.satHigh.x, h.satHigh.y, 9)).toBe('satHigh')
      expect(hitSlice(r, R, 0, 0, 9)).toBeNull()
    }
  })

  it('dragging a hue edge sets the width, across 0°', () => {
    const r = range({ hue: 5, hueWidth: 15 })
    const at = (hue: number, sat = 60) => ({ x: Math.cos((hue * Math.PI) / 180) * sat, y: -Math.sin((hue * Math.PI) / 180) * sat })
    let p = at(340)
    expect(dragSlice(r, 'hueA', p.x, p.y, R).hueWidth).toBe(25)
    p = at(15)
    expect(dragSlice(range({ hue: 350 }), 'hueB', p.x, p.y, R).hueWidth).toBe(25)
    p = at(355)
    expect(dragSlice(r, 'hueB', p.x, p.y, R).hueWidth).toBe(10)
    // Never wider than 90° nor narrower than 1°.
    p = at(185)
    expect(dragSlice(r, 'hueA', p.x, p.y, R).hueWidth).toBe(90)
    p = at(5)
    expect(dragSlice(r, 'hueB', p.x, p.y, R).hueWidth).toBe(1)
  })

  it('dragging the middle moves the color across 0° and carries the saturation bounds', () => {
    const r = range({ hue: 10, sat: 60, satLow: 30, satHigh: 90 })
    const t = (350 * Math.PI) / 180
    const m = dragSlice(r, 'center', Math.cos(t) * 70, -Math.sin(t) * 70, R)
    expect(m).toMatchObject({ hue: 350, sat: 70, satLow: 40, satHigh: 100 })
    const edge = dragSlice(r, 'center', 98, 0, R)
    expect(edge.satHigh).toBe(100)
    expect(edge.satHigh - edge.satLow).toBeGreaterThanOrEqual(SAT_GAP)
  })

  it('saturation bounds keep their gap', () => {
    const r = range({ satLow: 30, satHigh: 60 })
    expect(dragSlice(r, 'satLow', 80, 0, R).satLow).toBe(60 - SAT_GAP)
    expect(dragSlice(r, 'satHigh', 10, 0, R).satHigh).toBe(30 + SAT_GAP)
    expect(dragSlice(r, 'satHigh', 300, 0, R).satHigh).toBe(100)
  })

  it('hue membership wraps at 0°', () => {
    const r = range({ hue: 5, hueWidth: 15 })
    expect(hueInSlice(r, 355)).toBe(true)
    expect(hueInSlice(r, 350)).toBe(true)
    expect(hueInSlice(r, 345)).toBe(false)
    expect(hueInSlice(r, 21)).toBe(false)
  })

  it('the sector path takes the short way round 0°', () => {
    const across = sectorPath(0, 0, 350, 20, 10, 100)
    const long = sectorPath(0, 0, 20, 350, 10, 100)
    expect(across.split('L').length).toBeLessThan(long.split('L').length / 5)
    // Starts on the outer edge at 350° (y down on screen).
    const [x, y] = across.slice(1).split('L')[0].split(' ').map(Number)
    expect(x).toBeCloseTo(98.48, 1)
    expect(y).toBeCloseTo(17.36, 1)
  })
})
