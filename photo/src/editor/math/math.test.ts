import { describe, expect, it } from 'vitest'
import { cameraMultipliers } from '../../color/wb'
import { mat3, type Vec3 } from '../../color/matrices'
import { defaultRecipe } from '../../edit/defaults'
import type { EditRecipe } from '../../edit/types'
import { makeClipboard } from '../../library/edits'
import { evalCurve, insertPoint, movePoint, nearestPoint, removePoint, MIN_GAP } from './curve'
import { groupsFromParts, partsFromGroups, pasteGroups } from './paste'
import { formatKelvin, kelvinToPos, neutralWb, parseKelvin, posToKelvin, presetValues, TEMP_POS_MAX, TEMP_POS_MIN, withTempTint } from './wb'
import { hueSatToPoint, pointToHueSat } from './wheel'

describe('tone curve points', () => {
  const identity = [{ x: 0, y: 0 }, { x: 1, y: 1 }]

  it('adds a point on the curve without bending it', () => {
    const { points, index } = insertPoint(identity, 0.5)
    expect(index).toBe(1)
    expect(points[1].x).toBe(0.5)
    expect(points[1].y).toBeCloseTo(0.5, 2)
    const s = [{ x: 0, y: 0 }, { x: 0.25, y: 0.15 }, { x: 0.75, y: 0.85 }, { x: 1, y: 1 }]
    const added = insertPoint(s, 0.4)
    expect(added.points[added.index].y).toBeCloseTo(evalCurve(s, 0.4), 6)
  })

  it('refuses a point on top of another', () => {
    expect(insertPoint(identity, 0.005).index).toBe(-1)
  })

  it('keeps points between their neighbors and end points at the edges', () => {
    const p = [{ x: 0, y: 0 }, { x: 0.3, y: 0.3 }, { x: 0.6, y: 0.6 }, { x: 1, y: 1 }]
    expect(movePoint(p, 1, 0.9, 1.4)[1]).toEqual({ x: 0.6 - MIN_GAP, y: 1 })
    expect(movePoint(p, 2, 0.1, -1)[2]).toEqual({ x: 0.3 + MIN_GAP, y: 0 })
    expect(movePoint(p, 0, 0.2, 0.1)[0]).toEqual({ x: 0, y: 0.1 })
    expect(movePoint(p, 3, 0.5, 0.9)[3]).toEqual({ x: 1, y: 0.9 })
  })

  it('removes inner points only', () => {
    const p = [{ x: 0, y: 0 }, { x: 0.5, y: 0.6 }, { x: 1, y: 1 }]
    expect(removePoint(p, 1)).toEqual(identity)
    expect(removePoint(p, 0)).toBe(p)
    expect(removePoint(p, 2)).toBe(p)
  })

  it('finds the nearest point within reach', () => {
    const p = [{ x: 0, y: 0 }, { x: 0.5, y: 0.6 }, { x: 1, y: 1 }]
    expect(nearestPoint(p, 0.52, 0.58, 0.05)).toBe(1)
    expect(nearestPoint(p, 0.3, 0.6, 0.05)).toBe(-1)
  })
})

describe('grading wheels', () => {
  it('puts red at 3 o’clock and turns counter-clockwise', () => {
    expect(pointToHueSat(50, 0, 50)).toEqual({ hue: 0, sat: 100 })
    expect(pointToHueSat(0, -25, 50)).toEqual({ hue: 90, sat: 50 })
    expect(pointToHueSat(-10, 0, 50)).toEqual({ hue: 180, sat: 20 })
    expect(pointToHueSat(0, 40, 50)).toEqual({ hue: 270, sat: 80 })
  })

  it('caps saturation at the rim and round-trips', () => {
    expect(pointToHueSat(300, 0, 50).sat).toBe(100)
    for (const [hue, sat] of [[30, 40], [210, 75], [345, 10]]) {
      const p = hueSatToPoint(hue, sat, 60)
      expect(pointToHueSat(p.x, p.y, 60)).toEqual({ hue, sat })
    }
  })

  it('has no hue at the center', () => {
    expect(pointToHueSat(0, 0, 50)).toEqual({ hue: 0, sat: 0 })
  })
})

describe('Kelvin slider', () => {
  it('runs from 2,000 K on the left to 50,000 K on the right, evenly in mireds', () => {
    expect(TEMP_POS_MIN).toBe(-500)
    expect(TEMP_POS_MAX).toBe(-20)
    expect(posToKelvin(TEMP_POS_MIN)).toBe(2000)
    expect(posToKelvin(TEMP_POS_MAX)).toBe(50000)
    // Equal travel: 2,500 → 3,333 K and 5,000 → 10,000 K are both 100 mireds.
    expect(kelvinToPos(3333.33) - kelvinToPos(2500)).toBeCloseTo(100, 1)
    expect(kelvinToPos(10000) - kelvinToPos(5000)).toBeCloseTo(100, 6)
  })

  it('round-trips common temperatures to the 50 K grid', () => {
    for (const k of [2850, 3200, 5450, 5500, 6500, 7500, 12000]) expect(posToKelvin(kelvinToPos(k))).toBe(k)
  })

  it('reads and writes Kelvin like a person would', () => {
    expect(formatKelvin(5450)).toBe('5,450 K')
    expect(parseKelvin('5,450 K')).toBe(5450)
    expect(parseKelvin('6500')).toBe(6500)
    expect(parseKelvin('5.4k')).toBe(5400)
    expect(parseKelvin('900')).toBe(2000)
    expect(parseKelvin('warm')).toBeUndefined()
  })

  it('goes back to "As shot" when the sliders land on the camera values', () => {
    const asShot = { temp: 5123, tint: 7 }
    expect(withTempTint('raw', 6000, 7, asShot).preset).toBe('custom')
    expect(withTempTint('raw', 5123, 7, asShot).preset).toBe('asShot')
    expect(withTempTint('display', 0, 0, undefined).preset).toBe('asShot')
  })

  it('knows the light-source presets', () => {
    expect(presetValues('raw', 'tungsten', undefined)).toEqual({ temp: 2850, tint: 0 })
    expect(presetValues('raw', 'asShot', { temp: 4999.6, tint: -3.2 })).toEqual({ temp: 5000, tint: -3 })
    expect(presetValues('display', 'daylight', undefined)).toBeNull()
    expect(presetValues('raw', 'auto', undefined)).toBeNull()
  })
})

describe('eyedropper', () => {
  const camXyz = mat3([[0.6972, -0.2408, -0.06], [-0.433, 1.2101, 0.2515], [-0.0388, 0.1277, 0.5847]])

  it('finds the light that makes a RAW sample neutral', () => {
    const shotMul = cameraMultipliers(camXyz, 5500, 0)
    // A gray card lit by 3,200 K light, as the camera recorded it with daylight WB.
    const tungsten = cameraMultipliers(camXyz, 3200, 0)
    const sample: Vec3 = [shotMul[0] / tungsten[0], 1, shotMul[2] / tungsten[2]]
    const wb = neutralWb('raw', sample, { camXyz, shotMul })!
    expect(Math.abs(wb.temp - 3200)).toBeLessThan(30)
    expect(Math.abs(wb.tint)).toBeLessThanOrEqual(1)
  })

  it('ignores black samples', () => {
    expect(neutralWb('display', [0, 0, 0])).toBeNull()
  })

  it('neutralizes a gray JPEG pixel to zero shift', () => {
    expect(neutralWb('display', [0.5, 0.5, 0.5])).toEqual({ temp: 0, tint: 0 })
  })
})

describe('paste groups', () => {
  const src: EditRecipe = {
    ...defaultRecipe('raw', { temp: 5000, tint: 0 }),
    wb: { preset: 'custom', temp: 7000, tint: 12 },
    basic: { ...defaultRecipe('raw').basic, exposure: 1, contrast: 20, clarity: 30, vibrance: 15 },
    effects: { ...defaultRecipe('raw').effects, vignette: -30 },
    geometry: { ...defaultRecipe('raw').geometry, angle: 3 },
    profile: 'vivid',
  }
  const clip = makeClipboard({ recipe: src, kind: 'raw' })
  const target = { recipe: defaultRecipe('raw', { temp: 4000, tint: 2 }), kind: 'raw' as const, raw: undefined }

  it('maps groups to the library’s clipboard parts', () => {
    expect(partsFromGroups(['light'])).toEqual(['basic'])
    expect(partsFromGroups(['look', 'crop'])).toEqual(['profile', 'treatment', 'geometry'])
    expect(groupsFromParts(clip.parts)).not.toContain('crop')
    expect(groupsFromParts(clip.parts)).toContain('presence')
  })

  it('pastes only the chosen groups', () => {
    const r = pasteGroups(target, clip, ['wb', 'effects'])
    expect(r.wb).toEqual(src.wb)
    expect(r.effects.vignette).toBe(-30)
    expect(r.basic.exposure).toBe(0)
    expect(r.geometry.angle).toBe(0)
    expect(r.profile).toBe('color')
  })

  it('splits Light from Presence', () => {
    const light = pasteGroups(target, clip, ['light'])
    expect(light.basic).toMatchObject({ exposure: 1, contrast: 20, clarity: 0, vibrance: 0 })
    const presence = pasteGroups(target, clip, ['presence'])
    expect(presence.basic).toMatchObject({ exposure: 0, contrast: 0, clarity: 30, vibrance: 15 })
    expect(pasteGroups(target, clip, ['light', 'presence']).basic).toEqual(src.basic)
  })

  it('pastes the crop only when asked', () => {
    expect(pasteGroups(target, clip, ['crop']).geometry.angle).toBe(3)
  })

  it('keeps the photo’s own white balance across RAW and JPEG', () => {
    const jpeg = { recipe: defaultRecipe('display'), kind: 'display' as const, raw: undefined }
    expect(pasteGroups(jpeg, clip, ['wb']).wb).toEqual(defaultRecipe('display').wb)
  })
})
