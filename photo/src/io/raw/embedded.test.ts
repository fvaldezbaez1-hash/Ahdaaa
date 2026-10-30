import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { findEmbeddedJpeg, stripApp1 } from './embedded'

/** Folder with real RAW samples (example-sony.ARW, iss030e122639.NEF); those tests skip without it. */
const SAMPLES = process.env.LUMEN_SAMPLES ?? ''

/** A structurally valid JPEG header (SOI, APP1, SOF0, SOS, data, EOI) with the given size. */
function jpeg(w: number, h: number, sof = 0xc0): number[] {
  return [0xff, 0xd8, 0xff, 0xe1, 0, 6, 1, 2, 3, 4, 0xff, sof, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1,
    0xff, 0xda, 0, 8, 1, 1, 0, 0, 0x3f, 0, 0x12, 0xff, 0, 0x34, 0xff, 0xd3, 0x56, 0xff, 0xd9]
}

describe('embedded preview finder', () => {
  it('picks the largest decodable JPEG and skips lossless payloads', () => {
    const file = Uint8Array.from([1, 2, 0xff, 0xd8, 0xff, 9, ...jpeg(640, 480), 7, 7, ...jpeg(8000, 6000, 0xc3), ...jpeg(1616, 1080), 0])
    const j = findEmbeddedJpeg(file)!
    expect([j.width, j.height]).toEqual([1616, 1080])
    expect(file.subarray(j.offset, j.offset + j.length)).toEqual(Uint8Array.from(jpeg(1616, 1080)))
  })

  it('strips APP1 only', () => {
    const out = stripApp1(Uint8Array.from(jpeg(10, 10)))
    expect([...out.subarray(0, 4)]).toEqual([0xff, 0xd8, 0xff, 0xc0])
    expect(out.length).toBe(jpeg(10, 10).length - 8)
  })

  for (const [file, size] of [['example-sony.ARW', [6192, 4128]], ['iss030e122639.NEF', [4256, 2832]]] as const)
    it.skipIf(!SAMPLES || !existsSync(`${SAMPLES}/${file}`))(`finds the full preview in ${file}`, { timeout: 30_000 }, () => {
      const j = findEmbeddedJpeg(new Uint8Array(readFileSync(`${SAMPLES}/${file}`)))!
      expect([j.width, j.height]).toEqual(size)
    })
})
