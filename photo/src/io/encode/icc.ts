// A compact ICC v4 display profile for Display P3 exports: matrix/TRC with the
// P3 primaries adapted to the D50 PCS (Bradford, recorded in 'chad') and the
// sRGB transfer curve as a parametric curve. ~500 bytes, generated once.
import { adaptation, D65_XY, mul, P3_TO_XYZ, type Mat3 } from '../../color/matrices'

/** The PCS illuminant every ICC profile uses (ICC.1:2010, 7.2.16). */
const PCS_D50 = [0.9642, 1, 0.8249]

const s15 = (x: number) => Math.round(x * 65536)

class Writer {
  bytes: number[] = []
  u8(...v: number[]) {
    this.bytes.push(...v)
  }
  u16(v: number) {
    this.bytes.push((v >>> 8) & 255, v & 255)
  }
  u32(v: number) {
    this.bytes.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255)
  }
  sig(s: string) {
    for (let i = 0; i < 4; i++) this.bytes.push(s.charCodeAt(i))
  }
  fixed(...v: number[]) {
    for (const x of v) this.u32(s15(x) >>> 0)
  }
}

const tagXYZ = (xyz: number[]) => {
  const w = new Writer()
  w.sig('XYZ ')
  w.u32(0)
  w.fixed(...xyz)
  return w.bytes
}

const tagMluc = (text: string) => {
  const w = new Writer()
  w.sig('mluc')
  w.u32(0)
  w.u32(1)
  w.u32(12)
  w.sig('enUS')
  w.u32(text.length * 2)
  w.u32(28)
  for (let i = 0; i < text.length; i++) w.u16(text.charCodeAt(i))
  return w.bytes
}

/** sRGB curve: Y = ((X + 0.055) / 1.055)^2.4 for X ≥ 0.04045, else X / 12.92. */
const tagSrgbTrc = () => {
  const w = new Writer()
  w.sig('para')
  w.u32(0)
  w.u16(3)
  w.u16(0)
  w.fixed(2.4, 1 / 1.055, 0.055 / 1.055, 1 / 12.92, 0.04045)
  return w.bytes
}

const tagSf32 = (m: Mat3) => {
  const w = new Writer()
  w.sig('sf32')
  w.u32(0)
  w.fixed(...m)
  return w.bytes
}

function buildProfile(description: string, toXyzD65: Mat3): Uint8Array {
  const s = PCS_D50[0] + PCS_D50[1] + PCS_D50[2]
  const chad = adaptation(D65_XY, [PCS_D50[0] / s, PCS_D50[1] / s])
  const m = mul(chad, toXyzD65)
  const trc = tagSrgbTrc()
  const tags: [string, number[]][] = [
    ['desc', tagMluc(description)],
    ['cprt', tagMluc('No copyright, use freely')],
    ['wtpt', tagXYZ(PCS_D50)],
    ['rXYZ', tagXYZ([m[0], m[3], m[6]])],
    ['gXYZ', tagXYZ([m[1], m[4], m[7]])],
    ['bXYZ', tagXYZ([m[2], m[5], m[8]])],
    ['rTRC', trc],
    ['gTRC', trc],
    ['bTRC', trc],
    ['chad', tagSf32(chad)],
  ]
  // Lay out tag data (4-byte aligned); identical curves share one copy.
  const tableEnd = 128 + 4 + tags.length * 12
  const data: number[] = []
  const placed = new Map<number[], number>()
  const entries = tags.map(([sig, bytes]) => {
    let at = placed.get(bytes)
    if (at === undefined) {
      at = tableEnd + data.length
      placed.set(bytes, at)
      data.push(...bytes)
      while (data.length % 4) data.push(0)
    }
    return { sig, at, size: bytes.length }
  })
  const size = tableEnd + data.length

  const w = new Writer()
  w.u32(size)
  w.u32(0) // preferred CMM: none
  w.u32(0x04300000) // version 4.3
  w.sig('mntr')
  w.sig('RGB ')
  w.sig('XYZ ')
  for (const v of [2024, 1, 1, 0, 0, 0]) w.u16(v)
  w.sig('acsp')
  for (let i = 0; i < 6; i++) w.u32(0) // platform, flags, manufacturer, model, attributes ×2
  w.u32(0) // perceptual intent
  w.fixed(...PCS_D50)
  w.sig('lumn') // creator
  while (w.bytes.length < 128) w.u8(0) // profile ID (optional, zero) + reserved
  w.u32(tags.length)
  for (const e of entries) {
    w.sig(e.sig)
    w.u32(e.at)
    w.u32(e.size)
  }
  return Uint8Array.from([...w.bytes, ...data])
}

let p3: Uint8Array | undefined
export function displayP3Profile(): Uint8Array {
  return (p3 ??= buildProfile('Display P3', P3_TO_XYZ))
}
