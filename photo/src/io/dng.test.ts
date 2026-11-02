import { describe, expect, it } from 'vitest'
import { DngWriter, readLumenDng, writeDng, type DngInfo } from './dng'

const info = (w: number, h: number, extra: Partial<DngInfo> = {}): DngInfo => ({
  width: w,
  height: h,
  colorMatrix: [0.6972, -0.2408, -0.06, -0.433, 1.2101, 0.2515, -0.0388, 0.1277, 0.5847],
  asShotNeutral: [1 / 2.58, 1, 1 / 1.55],
  baselineExposure: 2.25,
  meta: { make: 'Sony', model: 'ILME-FX30', lens: 'E 18-135mm F3.5-5.6 OSS', iso: 800, shutter: 1 / 125, aperture: 5, focalLength: 29, takenAt: Date.UTC(2023, 3, 29, 12, 0, 0) },
  uniqueCameraModel: 'Lumen HDR (Sony ILME-FX30)',
  ...extra,
})

const pixels = (w: number, h: number) => Uint16Array.from({ length: w * h * 3 }, (_, i) => (i * 7919 + (i >> 5)) & 0xffff)

describe('Lumen DNG', () => {
  it('round-trips pixels and colour metadata (raw image in IFD0)', async () => {
    const data = pixels(37, 23)
    const blob = writeDng(data, info(37, 23))
    const back = readLumenDng(await blob.arrayBuffer())!
    expect(back.width).toBe(37)
    expect(back.height).toBe(23)
    expect(back.data).toEqual(data)
    back.colorMatrix.forEach((v, i) => expect(v).toBeCloseTo(info(1, 1).colorMatrix[i], 4))
    back.asShotNeutral.forEach((v, i) => expect(v).toBeCloseTo(info(1, 1).asShotNeutral![i], 4))
    expect(back.baselineExposure).toBeCloseTo(2.25, 4)
    expect(back.software).toBe('Lumen')
    expect([back.make, back.model, back.uniqueCameraModel]).toEqual(['Sony', 'ILME-FX30', 'Lumen HDR (Sony ILME-FX30)'])
  })

  it('round-trips with a JPEG preview in IFD0 and the raw image in a SubIFD, written row by row', async () => {
    const W = 300, H = 410 // several strips
    const data = pixels(W, H)
    const w = new DngWriter(info(W, H))
    for (let y = 0; y < H; y += 7) w.addRows(data.subarray(y * W * 3, Math.min(H, y + 7) * W * 3))
    const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9)
    const blob = w.finish({ jpeg, width: 4, height: 3 })
    const buf = await blob.arrayBuffer()
    const back = readLumenDng(buf)!
    expect(back.data).toEqual(data)
    // The preview is where IFD0 says, and the file is a DNG 1.4 (TIFF, little endian).
    const v = new DataView(buf)
    expect(v.getUint16(0)).toBe(0x4949)
    expect(new Uint8Array(buf, 8, jpeg.length)).toEqual(jpeg)
  })

  it('refuses rows that don’t add up and files that aren’t its own', async () => {
    const w = new DngWriter(info(4, 4))
    expect(() => w.addRows(new Uint16Array(5))).toThrow()
    w.addRows(new Uint16Array(4 * 3 * 3))
    expect(() => w.finish()).toThrow()
    expect(readLumenDng(new Uint8Array([0x4d, 0x4d, 0, 42, 0, 0, 0, 8]).buffer)).toBeNull()
  })
})
