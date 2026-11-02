import { describe, expect, it } from 'vitest'
import { librawCurve, librawInverse, librawLinearTable, linearizeLibraw } from './curve'

describe('LibRaw curve inverse', () => {
  const c = librawCurve(), t = librawLinearTable()
  it('round-trips every one of the 65536 linear codes', () => {
    for (let i = 0; i < 0x10000; i++) {
      // The inverse lands on a linear code the curve maps back to the same output.
      expect(c[t[c[i]]]).toBe(c[i])
    }
  })
  it('is exact in the linear toe and monotonic everywhere', () => {
    // The toe (slope 4.5 > 1) is one-to-one: every linear code comes back exactly.
    for (let i = 0; c[i + 1] - c[i] >= 1 && i < 0x10000; i++) expect(t[c[i]]).toBe(i)
    expect(c[300]).toBeCloseTo(300 * 4.5, -1)
    for (let v = 1; v < 0x10000; v++) expect(t[v]).toBeGreaterThanOrEqual(t[v - 1])
    expect(librawInverse()[0xffff]).toBeGreaterThan(65530)
  })
  it('linearizes decoded data in place', () => {
    const d = Uint16Array.from([c[0], c[1000], c[30000], 0xffff])
    expect(Array.from(linearizeLibraw(d))).toEqual([0, 1000, t[c[30000]], t[0xffff]])
    expect(Math.abs(d[2] - 30000)).toBeLessThanOrEqual(3)
  })
})
