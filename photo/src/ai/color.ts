// Source pixels ↔ what the models were trained on.
//
// Lumen's sources are linear 16-bit RGB: camera RGB for RAW (white balance
// applied, clipped at 1), linear sRGB otherwise. Models expect sRGB-encoded
// images that look "normally exposed". Model space here is: camera → linear
// sRGB (rgbCam), times an exposure gain (RAW is darker than a camera JPEG),
// clipped to 0…1, sRGB-encoded. The inverse undoes each step; values that were
// clipped can't come back, which is why denoise applies the model's change
// (not its output) to the original pixels.
import { inv, type Mat3 } from '../color/matrices'
import type { SourceColor } from '../engine/types'

export interface ModelSpace {
  /** Source → linear sRGB (null = already linear sRGB). */
  toSrgb: Mat3 | null
  /** Linear sRGB → source. */
  fromSrgb: Mat3 | null
  /** Exposure gain applied in linear light before encoding. */
  gain: number
}

export function srgbEncode(v: number): number {
  return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055
}

export function srgbDecode(v: number): number {
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

const LUT_SIZE = 65536
let encLut: Float32Array | undefined
let decLut: Float32Array | undefined
/** Linear 0…1 (65536 steps) → sRGB-encoded 0…1. */
function encodeLut(): Float32Array {
  if (!encLut) {
    encLut = new Float32Array(LUT_SIZE)
    for (let i = 0; i < LUT_SIZE; i++) encLut[i] = srgbEncode(i / (LUT_SIZE - 1))
  }
  return encLut
}
/** sRGB-encoded 0…1 (65536 steps) → linear 0…1. */
function decodeLut(): Float32Array {
  if (!decLut) {
    decLut = new Float32Array(LUT_SIZE)
    for (let i = 0; i < LUT_SIZE; i++) decLut[i] = srgbDecode(i / (LUT_SIZE - 1))
  }
  return decLut
}

export function modelSpace(color: SourceColor, gain = 1): ModelSpace {
  const m = color.space === 'camera' && color.rgbCam ? color.rgbCam : null
  return { toSrgb: m, fromSrgb: m ? inv(m) : null, gain }
}

/**
 * Exposure gain so the image's bright end (99.5th percentile of the brightest
 * channel) sits near 0.9: RAW files come out of Lumen's decoder unbrightened.
 * Display images (JPEG…) are already exposed for viewing and keep gain 1.
 */
export function autoGain(data: Uint16Array, color: SourceColor): number {
  if (color.kind !== 'raw') return 1
  const m = color.space === 'camera' ? color.rgbCam : undefined
  const n = data.length / 3
  const step = Math.max(1, Math.floor(n / 50000))
  const hist = new Uint32Array(1024)
  let count = 0
  for (let p = 0; p < n; p += step) {
    const i = p * 3
    let r = data[i] / 65535, g = data[i + 1] / 65535, b = data[i + 2] / 65535
    if (m) [r, g, b] = [m[0] * r + m[1] * g + m[2] * b, m[3] * r + m[4] * g + m[5] * b, m[6] * r + m[7] * g + m[8] * b]
    const v = Math.min(1, Math.max(r, g, b, 0))
    hist[Math.min(1023, Math.floor(v * 1023))]++
    count++
  }
  let acc = 0
  let p995 = 1
  for (let i = 0; i < 1024; i++) {
    acc += hist[i]
    if (acc >= count * 0.995) {
      p995 = (i + 0.5) / 1023
      break
    }
  }
  return Math.min(8, Math.max(1, 0.9 / Math.max(p995, 1e-4)))
}

/** Source RGB (interleaved, 0…65535) → model RGB (interleaved, sRGB-encoded 0…1). */
export function toModel(src: Uint16Array, space: ModelSpace, out = new Float32Array(src.length)): Float32Array {
  const lut = encodeLut()
  const m = space.toSrgb
  const k = space.gain / 65535
  const top = LUT_SIZE - 1
  for (let i = 0; i < src.length; i += 3) {
    let r = src[i] * k, g = src[i + 1] * k, b = src[i + 2] * k
    if (m) [r, g, b] = [m[0] * r + m[1] * g + m[2] * b, m[3] * r + m[4] * g + m[5] * b, m[6] * r + m[7] * g + m[8] * b]
    out[i] = lut[Math.round(Math.min(1, Math.max(0, r)) * top)]
    out[i + 1] = lut[Math.round(Math.min(1, Math.max(0, g)) * top)]
    out[i + 2] = lut[Math.round(Math.min(1, Math.max(0, b)) * top)]
  }
  return out
}

/** Model RGB (interleaved, sRGB-encoded 0…1) → linear source values (float, 0…65535 scale, unclamped). */
export function fromModelFloat(rgb: Float32Array, space: ModelSpace, out = new Float32Array(rgb.length)): Float32Array {
  const lut = decodeLut()
  const m = space.fromSrgb
  const k = 65535 / space.gain
  const top = LUT_SIZE - 1
  for (let i = 0; i < rgb.length; i += 3) {
    let r = lut[Math.round(Math.min(1, Math.max(0, rgb[i])) * top)]
    let g = lut[Math.round(Math.min(1, Math.max(0, rgb[i + 1])) * top)]
    let b = lut[Math.round(Math.min(1, Math.max(0, rgb[i + 2])) * top)]
    if (m) [r, g, b] = [m[0] * r + m[1] * g + m[2] * b, m[3] * r + m[4] * g + m[5] * b, m[6] * r + m[7] * g + m[8] * b]
    out[i] = r * k
    out[i + 1] = g * k
    out[i + 2] = b * k
  }
  return out
}

/** Model RGB → source RGB, rounded and clamped to 0…65535. */
export function fromModel(rgb: Float32Array, space: ModelSpace, out = new Uint16Array(rgb.length)): Uint16Array {
  const f = fromModelFloat(rgb, space)
  for (let i = 0; i < f.length; i++) out[i] = Math.min(65535, Math.max(0, Math.round(f[i])))
  return out
}

/** 8-bit model RGB (e.g. an inpainting result) → source RGB, with ±½ step dither so pushed shadows don't band. */
export function fromModel8(rgb: Uint8Array | Uint8ClampedArray, space: ModelSpace, seed = 1): Uint16Array {
  const f = new Float32Array(rgb.length)
  let s = seed >>> 0 || 1
  for (let i = 0; i < rgb.length; i++) {
    // xorshift: cheap, deterministic triangular-ish dither.
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    const d = ((s >>> 0) / 4294967296 - 0.5) * 0.999
    f[i] = Math.min(255, Math.max(0, rgb[i] + (rgb[i] > 0 && rgb[i] < 255 ? d : 0))) / 255
  }
  return fromModel(f, space)
}

/** Interleaved model RGB 0…1 → RGBA 8-bit (for MediaPipe's ImageData). */
export function toRgba8(rgb: Float32Array, n = rgb.length / 3): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(n * 4)
  for (let p = 0, i = 0, o = 0; p < n; p++, i += 3, o += 4) {
    out[o] = rgb[i] * 255 + 0.5
    out[o + 1] = rgb[i + 1] * 255 + 0.5
    out[o + 2] = rgb[i + 2] * 255 + 0.5
    out[o + 3] = 255
  }
  return out
}

/** Interleaved RGB → planar NCHW float, optionally normalized per channel ((v − mean) / std). */
export function toPlanar(rgb: Float32Array, n: number, mean: readonly number[] = [0, 0, 0], std: readonly number[] = [1, 1, 1]): Float32Array {
  const out = new Float32Array(n * 3)
  for (let c = 0; c < 3; c++) {
    const o = c * n, mu = mean[c], s = 1 / std[c]
    for (let p = 0; p < n; p++) out[o + p] = (rgb[p * 3 + c] - mu) * s
  }
  return out
}

/** Planar NCHW → interleaved RGB. */
export function fromPlanar(planar: Float32Array | Uint8Array, n: number): Float32Array {
  const out = new Float32Array(n * 3)
  for (let c = 0; c < 3; c++) for (let p = 0; p < n; p++) out[p * 3 + c] = planar[c * n + p]
  return out
}
