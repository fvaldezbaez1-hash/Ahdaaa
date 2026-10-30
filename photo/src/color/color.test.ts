import { describe, expect, it } from 'vitest'
import { curveLut } from './curve'
import { apply, inv, mat3, mul, REC2020_TO_SRGB, SRGB_TO_REC2020, type Mat3, type Vec3 } from './matrices'
import {
  cameraMultipliers, rawWbForNeutral, rawWbRatio, relativeWbForNeutral, relativeWbMatrix, rgbCamFromCamXyz, shiftWb,
  tempTintFromMultipliers, tempTintFromXy, xyFromTempTint,
} from './wb'

// LibRaw's cam_xyz (first three rows) for the Sony ILME-FX30 sample.
const SONY_CAM_XYZ = mat3([
  [0.6972, -0.2408, -0.06],
  [-0.433, 1.2101, 0.2515],
  [-0.0388, 0.1277, 0.5847],
])
const close = (a: number[], b: number[], eps: number) => a.forEach((v, i) => expect(Math.abs(v - b[i])).toBeLessThan(eps))

describe('matrices', () => {
  it('inverts and round-trips', () => {
    const m: Mat3 = [2, 1, 0, 0, 1, 3, 1, 0, 1]
    close(mul(m, inv(m)), [1, 0, 0, 0, 1, 0, 0, 0, 1], 1e-12)
    close(mul(SRGB_TO_REC2020, REC2020_TO_SRGB), [1, 0, 0, 0, 1, 0, 0, 0, 1], 1e-6)
  })
  it('keeps white white between sRGB and Rec.2020', () => {
    close(apply(SRGB_TO_REC2020, [1, 1, 1]), [1, 1, 1], 1e-4)
  })
})

describe('temperature and tint', () => {
  it('round-trips through chromaticity', () => {
    for (const temp of [2500, 3200, 4000, 5000, 5500, 6504, 8000, 12000, 25000])
      for (const tint of [-60, 0, 25, 100]) {
        const [x, y] = xyFromTempTint(temp, tint)
        const back = tempTintFromXy(x, y)
        expect(Math.abs(back.temp - temp) / temp).toBeLessThan(0.005)
        expect(Math.abs(back.tint - tint)).toBeLessThan(0.5)
      }
  })
  it('puts D65 near 6500 K with a small green-magenta offset', () => {
    const { temp, tint } = tempTintFromXy(0.31271, 0.32902)
    expect(temp).toBeGreaterThan(6400)
    expect(temp).toBeLessThan(6600)
    expect(Math.abs(tint)).toBeLessThan(15)
  })
  it('moves along the Planckian locus: warmer light has higher x', () => {
    expect(xyFromTempTint(3000, 0)[0]).toBeGreaterThan(xyFromTempTint(6500, 0)[0])
  })
})

describe('RAW white balance', () => {
  it('reproduces LibRaw daylight multipliers from the camera matrix', () => {
    // LibRaw pre_mul for this camera is [2.8048, 0.9325, 1.3746] → green-normalized [3.008, 1, 1.474].
    const m = cameraMultipliers(SONY_CAM_XYZ, 6504, tempTintFromXy(0.31271, 0.32902).tint)
    close(m, [3.008, 1, 1.474], 0.03)
  })
  it('finds a plausible as-shot temperature and round-trips multipliers', () => {
    const shot: Vec3 = [2643 / 1024, 1, 1590 / 1024]
    const { temp, tint } = tempTintFromMultipliers(SONY_CAM_XYZ, shot)
    expect(temp).toBeGreaterThan(3500)
    expect(temp).toBeLessThan(7500)
    close(cameraMultipliers(SONY_CAM_XYZ, temp, tint), shot, 1e-3)
    close(rawWbRatio(SONY_CAM_XYZ, shot, temp, tint), [1, 1, 1], 1e-3)
  })
  it('the eyedropper neutralizes the sampled pixel', () => {
    const shot: Vec3 = [2.58, 1, 1.55]
    const sample: Vec3 = [0.42, 0.35, 0.3] // a warm-looking gray in as-shot balanced data
    const wb = rawWbForNeutral(SONY_CAM_XYZ, shot, sample)
    const r = rawWbRatio(SONY_CAM_XYZ, shot, wb.temp, wb.tint)
    const out = [sample[0] * r[0], sample[1] * r[1], sample[2] * r[2]]
    close([out[0] / out[1], out[2] / out[1]], [1, 1], 1e-3)
  })
  it('derives the camera→sRGB matrix like LibRaw', () => {
    // LibRaw's rgb_cam for the same Sony sample.
    close(rgbCamFromCamXyz(SONY_CAM_XYZ), [1.5708, -0.3946, -0.1762, -0.1713, 1.6316, -0.4602, -0.0181, -0.4145, 1.4325], 0.003)
  })
  it('shifts by mireds and clamps', () => {
    expect(shiftWb('raw', { temp: 5000, tint: 0 }, 20, 5).temp).toBeGreaterThan(5000)
    expect(shiftWb('display', { temp: 90, tint: 0 }, 30, 0).temp).toBe(100)
  })
})

describe('relative white balance (JPEG)', () => {
  it('is the identity at zero', () => {
    expect(relativeWbMatrix(0, 0)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1])
  })
  it('warms with positive temperature and keeps gray near gray at 0/0', () => {
    const warm = apply(relativeWbMatrix(40, 0), [0.5, 0.5, 0.5])
    expect(warm[0]).toBeGreaterThan(warm[2])
    const cool = apply(relativeWbMatrix(-40, 0), [0.5, 0.5, 0.5])
    expect(cool[2]).toBeGreaterThan(cool[0])
  })
  it('the eyedropper neutralizes a tinted gray', () => {
    const gray: Vec3 = [0.5, 0.46, 0.38]
    const wb = relativeWbForNeutral(gray)
    const out = apply(relativeWbMatrix(wb.temp, wb.tint), gray)
    expect(Math.abs(out[0] / out[1] - 1)).toBeLessThan(0.04)
    expect(Math.abs(out[2] / out[1] - 1)).toBeLessThan(0.04)
  })
})

describe('tone curve', () => {
  it('is linear for the identity and monotone for an S-curve', () => {
    const id = curveLut([{ x: 0, y: 0 }, { x: 1, y: 1 }], 5)
    close(Array.from(id), [0, 0.25, 0.5, 0.75, 1], 1e-6)
    const s = curveLut([{ x: 0, y: 0 }, { x: 0.25, y: 0.18 }, { x: 0.75, y: 0.84 }, { x: 1, y: 1 }], 256)
    for (let i = 1; i < s.length; i++) expect(s[i]).toBeGreaterThanOrEqual(s[i - 1] - 1e-6)
    expect(s[64]).toBeLessThan(64 / 255)
    expect(s[192]).toBeGreaterThan(192 / 255)
  })
})
