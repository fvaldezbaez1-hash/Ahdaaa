import { describe, expect, it } from 'vitest'
import { indexDb } from './db'
import { cameraFor, lensCandidates, resolveWith } from './index'
import { distortRadius, hermite, interpolateDistortion, interpolateTca, interpolateVignetting, radiusScale, rescaleDistortion, rescaleTca, rescaleVignetting, vignettingFactor } from './interpolate'
import { LENSFUN_RESULTS, MINI_DB } from './lensfun.fixture'
import { findCameras, findLenses, fuzzyScore, splitWords } from './match'

const db = indexDb(MINI_DB)
/** lensfun computes in float32: compare to ~6 significant digits. */
const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(2e-6 + 2e-5 * Math.abs(b))

describe('lensfun string matching', () => {
  it('splits names into words like lensfun', () => {
    expect(splitWords('E 18-135mm F3.5-5.6 OSS')).toEqual(['135', '18', '3.5', '5.6', 'e', 'mm', 'oss'])
    expect(splitWords('Nikon AF-S DX 18.0-55mm f/3.5-5.6G')).toEqual(['18', '3.5', '5.6', '55', 'af', 'dx', 'g', 'mm', 'nikon', 's'])
    expect(splitWords('Canon EF 100mm f/2.8L Macro IS USM +1.4x')).toContain('+')
  })

  it('scores like lfFuzzyStrCmp', () => {
    expect(fuzzyScore(splitWords('E 18-135mm F3.5-5.6 OSS'), 'E 18-135mm f/3.5-5.6 OSS')).toBe(100)
    expect(fuzzyScore(splitWords('Canon EOS 5D'), 'Canon EOS 5D Mark II')).toBe(80)
    expect(fuzzyScore(splitWords('Nikon D3S'), 'Nikon D3')).toBe(0) // strict: every word must occur
    expect(fuzzyScore(splitWords('Nikon D3S'), 'Nikon D3', false)).toBeGreaterThan(0)
  })
})

describe('against lensfun (built from the pinned commit)', () => {
  for (const t of LENSFUN_RESULTS) {
    const [mk, md, lensName, focal, aperture, distance] = t.query
    it(`${md} + ${lensName} @ ${focal} mm f/${aperture} ${distance} m`, () => {
      const cam = findCameras(db, mk, md)[0]
      expect(cam.model[0]).toBe(t.camera!.model)
      expect(cam.crop).toBeCloseTo(t.camera!.crop, 5)
      expect(cam.mount).toBe(t.camera!.mount)

      const found = findLenses(db, cam, undefined, lensName)
      const ours = found.slice(0, t.lenses.length).map((l) => [l.model[0], l.score])
      // Same lenses with the same scores (order within equal scores may differ: lensfun's sort isn't stable).
      expect([...ours].sort()).toEqual([...t.lenses].sort())
      expect(ours[0][1]).toBe(t.lenses[0][1])

      const lens = found.find((l) => l.model[0] === t.lenses[0][0] && l.score === t.lenses[0][1])!
      if (t.lensMinMax) expect([lens.minFocal, lens.maxFocal, lens.minAperture, lens.maxAperture]).toEqual(t.lensMinMax)

      const d = interpolateDistortion(lens, cam.crop, focal)
      if (!t.dist) expect(d).toBeNull()
      else {
        expect(d!.model).toBe(t.dist.model)
        d!.terms.forEach((v, i) => close(v, t.dist!.terms[i]))
      }
      const tca = interpolateTca(lens, cam.crop, focal)
      if (!t.tca) expect(tca).toBeNull()
      else {
        expect(tca!.model).toBe(t.tca.model)
        tca!.terms.forEach((v, i) => close(v, t.tca!.terms[i]))
      }
      const v = interpolateVignetting(lens, cam.crop, focal, aperture, distance)
      if (!t.vig) expect(v).toBeNull()
      else v!.k.forEach((x, i) => close(x, t.vig![i]))
    })
  }
})

describe('profile for a photo', () => {
  it('hermite spline passes through its knots and is linear for linear data', () => {
    expect(hermite(null, 1, 2, null, 0)).toBe(1)
    expect(hermite(null, 1, 2, null, 1)).toBe(2)
    expect(hermite(0, 1, 2, 3, 0.25)).toBeCloseTo(1.25, 12)
  })

  it('rescales distortion to the photo’s own radius without changing the shape (only a uniform scale)', () => {
    for (const d of [
      { model: 'poly3' as const, terms: [-0.02] },
      { model: 'poly5' as const, terms: [-0.03, 0.01] },
      { model: 'ptlens' as const, terms: [0.017, -0.049, 0.004] },
    ]) {
      const q = 0.93
      const r = rescaleDistortion(d, q)
      // r_d(photo) = r_d(db)(q·r) / q up to one constant factor for every radius.
      const ratios = [0.2, 0.5, 0.9, 1.3].map((x) => distortRadius(r.model, r.terms, x) / (distortRadius(d.model, d.terms, q * x) / q))
      for (const k of ratios) expect(k).toBeCloseTo(ratios[0], 10)
      if (d.model !== 'poly5') expect(distortRadius(r.model, r.terms, 1)).toBeCloseTo(1, 12)
      expect(rescaleDistortion(d, 1).terms.map((x) => +x.toFixed(12))).toEqual(d.terms)
    }
    const tca = rescaleTca({ model: 'poly3', terms: [1.001, 0.999, 0.01, -0.02, 0.003, 0.004] }, 0.5)
    expect(tca).toEqual({ r: [1.001, 0.005, 0.00075], b: [0.999, -0.01, 0.001] })
    expect(rescaleVignetting([-0.5, 0.2, -0.1], 2)).toEqual([-2, 3.2, -6.4])
    expect(vignettingFactor([-0.5, 0, 0], 1)).toBe(0.5)
  })

  it('uses the photo’s crop factor and aspect ratio', () => {
    const cal = { crop: 1.534, aspect: 1.5 }
    // Same sensor: no change.
    expect(radiusScale(cal, 1.534, 1.5, 'shortSide')).toBeCloseTo(1, 12)
    // The FX30 crops a little more (1.546): the photo's half short side is a smaller circle of the lens.
    expect(radiusScale(cal, 1.546, 1.5, 'shortSide')).toBeCloseTo(1.534 / 1.546, 12)
    // 16:9 video frame on the same sensor diagonal: shorter side relatively smaller.
    expect(radiusScale(cal, 1.534, 16 / 9, 'shortSide')).toBeCloseTo(Math.hypot(1.5, 1) / Math.hypot(16 / 9, 1), 12)
    // Vignetting uses the diagonal: aspect doesn't matter.
    expect(radiusScale(cal, 1.534, 16 / 9, 'diagonal')).toBeCloseTo(1, 12)
  })

  it('resolves the Sony sample (FX30 + E 18-135mm at 29 mm f/5) into recipe values', () => {
    const cam = cameraFor(db, { make: 'SONY', model: 'ILME-FX30' })!
    expect(cam).toMatchObject({ model: 'ILME-FX30', mount: 'Sony E', cropFactor: 1.546 })
    const [best] = lensCandidates(db, { make: 'SONY', model: 'ILME-FX30', lens: 'E 18-135mm F3.5-5.6 OSS', focalLength: 29, aperture: 5 }, cam)
    expect(best).toMatchObject({ model: 'E 18-135mm f/3.5-5.6 OSS', guessed: false, has: { distortion: true, tca: true, vignetting: true } })
    const r = resolveWith(db, best.id, 29, 5, undefined, { cropFactor: cam.cropFactor, width: 6240, height: 4168 })!
    expect(r.geometry!.model).toBe('ptlens')
    expect(r.geometry!.amount).toBe(100)
    // Close to the database's own terms (the sensors are nearly the same size).
    const truth = LENSFUN_RESULTS[0].dist!.terms
    r.geometry!.k.forEach((k, i) => expect(Math.abs(k - truth[i])).toBeLessThan(0.002))
    // At the photo's half short side the profile still maps r = 1 to r = 1 (lensfun's d-normalisation).
    expect(distortRadius('ptlens', r.geometry!.k, 1)).toBeCloseTo(1, 12)
    expect(r.tca!.r[0]).toBeCloseTo(LENSFUN_RESULTS[0].tca!.terms[0], 6)
    expect(r.vignetting!.amount).toBe(100)
    // The corner of the frame is darkened (k sums negative) and correction stays modest.
    const corner = vignettingFactor(r.vignetting!.k, 1)
    expect(corner).toBeGreaterThan(0.3)
    expect(corner).toBeLessThan(1)
  })

  it('guesses candidates when the file names no lens (the Nikon D3S sample at 28 mm f/1.4)', () => {
    const cam = cameraFor(db, { make: 'NIKON CORPORATION', model: 'NIKON D3S' })!
    const c = lensCandidates(db, { make: 'NIKON CORPORATION', model: 'NIKON D3S', focalLength: 28, aperture: 1.4 }, cam)
    expect(c[0]).toMatchObject({ model: 'Nikon AF Nikkor 28mm f/1.4D', guessed: true })
    // Lenses that can't open to f/1.4 or don't reach 28 mm aren't offered.
    for (const l of c) {
      expect(l.focal[0]).toBeLessThanOrEqual(28.3)
      expect(l.focal[1]).toBeGreaterThanOrEqual(27.7)
    }
    expect(resolveWith(db, 'nope', 28, 1.4)).toBeNull()
  })
})
