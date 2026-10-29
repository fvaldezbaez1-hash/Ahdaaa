// sRGB transfer function (IEC 61966-2-1) and lookup tables for converting
// display-encoded pixels to the linear 16-bit data the engine expects.

export function srgbToLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

export function linearToSrgb(v: number): number {
  return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055
}

let lut8: Float32Array | undefined
/** 8-bit sRGB code → linear 0…65535, kept as float so resampling doesn't lose shadow precision. */
export function srgb8ToLinearLut(): Float32Array {
  if (!lut8) {
    lut8 = new Float32Array(256)
    for (let i = 0; i < 256; i++) lut8[i] = srgbToLinear(i / 255) * 65535
  }
  return lut8
}

let lut16: Float32Array | undefined
/** 16-bit sRGB code → linear 0…65535 (16-bit TIFFs). */
export function srgb16ToLinearLut(): Float32Array {
  if (!lut16) {
    lut16 = new Float32Array(65536)
    for (let i = 0; i < 65536; i++) lut16[i] = srgbToLinear(i / 65535) * 65535
  }
  return lut16
}

let enc8: Uint8Array | undefined
/** Linear 0…65535 → 8-bit sRGB code. */
export function linear16ToSrgb8Lut(): Uint8Array {
  if (!enc8) {
    enc8 = new Uint8Array(65536)
    for (let i = 0; i < 65536; i++) enc8[i] = Math.round(linearToSrgb(i / 65535) * 255)
  }
  return enc8
}
