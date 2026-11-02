import { describe, expect, it } from 'vitest'
import { defaultRecipe } from '../../edit/defaults'
import type { EditRecipe, Perspective } from '../../edit/types'
import { makeClipboard, pasteOnto } from '../../library/edits'
import { PARTS } from '../panels/parts'
import { blankProfile, needsResolve, withoutProfile, withProfile, type ResolvedProfile } from './lensState'

const base = (): EditRecipe => defaultRecipe('display')

const RESOLVED: ResolvedProfile = {
  lens: { id: 'Canon/EF 24-105' },
  geometry: { model: 'ptlens', k: [0.01, -0.02, 0.005], amount: 100 },
  vignetting: { k: [-0.3, 0.1, -0.02], amount: 100 },
  tca: { r: [1.0002, 0, 0], b: [0.9998, 0, 0] },
}
const OTHER: ResolvedProfile = {
  lens: { id: 'Canon/EF 16-35' },
  geometry: { model: 'poly3', k: [-0.04], amount: 100 },
  vignetting: { k: [-0.5, 0.2, 0], amount: 100 },
  tca: { r: [1.0005, 0, 0], b: [0.9995, 0, 0] },
}
const PERSPECTIVE: Perspective = { vertical: 30, horizontal: 0, rotate: 1.2, aspect: 0, scale: 104, offsetX: 0, offsetY: 0, mode: 'manual', guides: [] }

describe('lens profile state', () => {
  it('needs a profile when corrections are on but nothing is resolved', () => {
    const r = base()
    expect(needsResolve(r)).toBe(false)
    expect(needsResolve({ ...r, lens: { ...r.lens, enabled: true } })).toBe(true)
    expect(needsResolve(withProfile(r, RESOLVED))).toBe(false)
  })

  it('turning a profile on stores its coefficients; CA correction defaults to on', () => {
    const r = withProfile(base(), RESOLVED)
    expect(r.lens).toMatchObject({ enabled: true, profileId: 'Canon/EF 24-105', vignetting: RESOLVED.vignetting, tca: RESOLVED.tca })
    expect(r.geometry.lens).toEqual({ manual: 0, profile: RESOLVED.geometry })
  })

  it('changing the lens keeps the amounts, manual distortion and the CA choice', () => {
    let r = withProfile(base(), RESOLVED)
    r = { ...r, lens: { ...r.lens, tca: null, vignetting: { ...r.lens.vignetting!, amount: 60 } }, geometry: { ...r.geometry, lens: { manual: -20, profile: { ...r.geometry.lens!.profile!, amount: 140 } } } }
    const next = withProfile(r, OTHER)
    expect(next.lens.profileId).toBe('Canon/EF 16-35')
    expect(next.lens.vignetting).toEqual({ k: OTHER.vignetting!.k, amount: 60 })
    expect(next.lens.tca).toBeNull()
    expect(next.geometry.lens).toEqual({ manual: -20, profile: { model: 'poly3', k: [-0.04], amount: 140 } })
    // Turning CA back on asks for it explicitly.
    expect(withProfile(next, OTHER, { tca: true }).lens.tca).toEqual(OTHER.tca)
  })

  it('no profile found: corrections stay on with nothing to apply', () => {
    const r = withProfile(base(), null)
    expect(r.lens).toMatchObject({ enabled: true, profileId: '', vignetting: null, tca: null })
    expect(r.geometry.lens).toEqual({ manual: 0, profile: null })
  })

  it('off drops the profile and keeps manual distortion', () => {
    const on = withProfile(base(), RESOLVED)
    expect(withoutProfile(on).geometry.lens).toBeUndefined()
    expect(withoutProfile(on).lens).toMatchObject({ enabled: false, profileId: '', vignetting: null, tca: null })
    const manual = { ...on, geometry: { ...on.geometry, lens: { ...on.geometry.lens!, manual: 35 } } }
    expect(withoutProfile(manual).geometry.lens).toEqual({ profile: null, manual: 35 })
  })

  it('blanking for another photo neutralizes the coefficients but keeps amounts and the CA choice', () => {
    let r = withProfile(base(), RESOLVED)
    r = { ...r, lens: { ...r.lens, vignetting: { ...r.lens.vignetting!, amount: 60 } }, geometry: { ...r.geometry, lens: { manual: 10, profile: { ...r.geometry.lens!.profile!, amount: 50 } } } }
    const b = blankProfile(r)
    expect(b.lens).toMatchObject({ enabled: true, profileId: '', vignetting: { k: [0, 0, 0], amount: 60 }, tca: { r: [1, 0, 0], b: [1, 0, 0] } })
    expect(b.geometry.lens).toEqual({ manual: 10, profile: { model: 'ptlens', k: [], amount: 50 } })
    expect(needsResolve(b)).toBe(true)
    const again = withProfile(b, OTHER)
    expect(again.lens.vignetting!.amount).toBe(60)
    expect(again.geometry.lens!.profile!.amount).toBe(50)
    expect(again.lens.tca).toEqual(OTHER.tca)
    // CA was off: it stays off on the other photo.
    const off = withProfile(blankProfile({ ...r, lens: { ...r.lens, tca: null } }), OTHER)
    expect(off.lens.tca).toBeNull()
  })
})

describe('pasting lens and transform settings', () => {
  const source = (): EditRecipe => {
    const r = withProfile(base(), RESOLVED)
    return { ...r, levels: { ...r.levels, rgb: { ...r.levels.rgb, inBlack: 12 } }, geometry: { ...r.geometry, angle: 3, crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, perspective: PERSPECTIVE } }
  }
  const paste = (parts: Parameters<typeof makeClipboard>[1]) => pasteOnto({ recipe: base(), kind: 'display' }, makeClipboard({ recipe: source(), kind: 'display' }, parts))

  it('lens: the settings travel, the profile is found again for the target', () => {
    const r = paste(['lens'])
    expect(r.lens.enabled && needsResolve(r)).toBe(true)
    expect(r.geometry.lens?.profile?.k).toEqual([])
    expect(r.geometry.perspective).toBeUndefined()
    expect(r.geometry.angle).toBe(0)
  })

  it('transform only carries the perspective; crop only carries the frame', () => {
    const t = paste(['transform'])
    expect(t.geometry.perspective).toEqual(PERSPECTIVE)
    expect(t.geometry.angle).toBe(0)
    expect(t.geometry.crop).toEqual(base().geometry.crop)
    const c = paste(['geometry'])
    expect(c.geometry.angle).toBe(3)
    expect(c.geometry.perspective).toBeUndefined()
    expect(c.geometry.lens).toBeUndefined()
  })

  it('levels and the color editor paste as they are', () => {
    const r = paste(['levels', 'colorEditor'])
    expect(r.levels.rgb.inBlack).toBe(12)
    expect(r.lens.enabled).toBe(false)
  })

  it('section reset: Lens and Transform go back to the defaults', () => {
    const r = source()
    const d = base()
    expect(PARTS.lens.changed(r, d) && PARTS.transform.changed(r, d)).toBe(true)
    const reset = PARTS.transform.reset(PARTS.lens.reset(r, d), d)
    expect(reset.lens).toEqual(d.lens)
    expect(reset.geometry.lens).toBeUndefined()
    expect(reset.geometry.perspective).toBeUndefined()
    expect(reset.geometry.angle).toBe(3)
    expect(PARTS.lens.changed(reset, d) || PARTS.transform.changed(reset, d)).toBe(false)
  })
})
