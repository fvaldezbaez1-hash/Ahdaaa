// Getting linear light out of Lumen's decoded sources.
//
// libraw-wasm 1.6.0 ignores the `gamm` setting, so LibRaw's default BT.709
// curve (gamma_curve(0.45, 4.5)) is applied to every RAW Lumen decodes,
// although src/io/raw/libraw.ts asks for linear output. Merging needs real
// linear values (exposures must add up), so RAW sources are un-curved here
// with the exact inverse of LibRaw's curve (checked against native LibRaw:
// identical to its linear output). JPEG/PNG sources are already linear.
//
// When libraw.ts is fixed to return linear data, set LIBRAW_OUTPUT_IS_CURVED
// to false (or call this from libraw.ts and drop it here).
import type { SourceColor } from '../engine/types'

export const LIBRAW_OUTPUT_IS_CURVED = true

/** LibRaw's gamma_curve(pwr, ts, mode 2, imax) forward table (curve[i] for i = 0…65535). */
export function librawCurve(pwr = 0.45, ts = 4.5, imax = 0x10000): Float64Array {
  const g = [pwr, ts, 0, 0, 0, 0]
  const bnd = [0, 0]
  bnd[g[1] >= 1 ? 1 : 0] = 1
  if (g[1] && (g[1] - 1) * (g[0] - 1) <= 0) {
    for (let i = 0; i < 48; i++) {
      g[2] = (bnd[0] + bnd[1]) / 2
      if (g[0]) bnd[((g[2] / g[1]) ** -g[0] - 1) / g[0] - 1 / g[2] > -1 ? 1 : 0] = g[2]
      else bnd[g[2] / Math.exp(1 - 1 / g[2]) < g[1] ? 1 : 0] = g[2]
    }
    g[3] = g[2] / g[1]
    if (g[0]) g[4] = g[2] * (1 / g[0] - 1)
  }
  const curve = new Float64Array(0x10000)
  for (let i = 0; i < 0x10000; i++) {
    const r = i / imax
    curve[i] = r < 1 ? Math.trunc(0x10000 * (r < g[3] ? r * g[1] : g[0] ? r ** g[0] * (1 + g[4]) - g[4] : Math.log(r) * g[2] + 1)) : 0xffff
  }
  return curve
}

let inverse: Float32Array | undefined
/** Output code → linear value (0…65535 scale), interpolated between the curve's steps. */
export function librawInverse(): Float32Array {
  if (inverse) return inverse
  const c = librawCurve()
  const inv = new Float32Array(0x10000)
  // c is non-decreasing: walk it once, interpolating linearly between distinct codes.
  let i = 0
  for (let v = 0; v < 0x10000; v++) {
    while (i < 0xffff && c[i + 1] <= v) i++
    const c0 = c[i], c1 = i < 0xffff ? c[i + 1] : c[i] + 1
    inv[v] = c1 > c0 ? i + Math.min(1, Math.max(0, (v - c0) / (c1 - c0))) : i
  }
  return (inverse = inv)
}

/** Code → linear light (0…1) for a decoded source: apply per sample without a full float copy. */
export function linearLut(color: SourceColor): Float32Array {
  const lut = new Float32Array(0x10000)
  if (color.kind === 'raw' && LIBRAW_OUTPUT_IS_CURVED) {
    const inv = librawInverse()
    for (let i = 0; i < 0x10000; i++) lut[i] = inv[i] / 65535
  } else for (let i = 0; i < 0x10000; i++) lut[i] = i / 65535
  return lut
}

/** Linear light (0…1 scale, unclipped float) of a decoded source, as interleaved RGB (small images). */
export function linearOf(data: Uint16Array, color: SourceColor): Float32Array {
  const out = new Float32Array(data.length)
  if (color.kind === 'raw' && LIBRAW_OUTPUT_IS_CURVED) {
    const inv = librawInverse()
    for (let i = 0; i < data.length; i++) out[i] = inv[data[i]] / 65535
  } else for (let i = 0; i < data.length; i++) out[i] = data[i] / 65535
  return out
}
