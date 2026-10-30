import { apply, type Vec3 } from '../../color/matrices'
import { hueSat } from '../../engine/masks'
import type { SourceColor } from '../../engine/types'

const encode = (c: number) => {
  const v = Math.min(1, Math.max(0, c))
  return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
}

const decode = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))

/**
 * Brightness (0…100) and hue / saturation of a pixel of the developed photo
 * (display-encoded RGB from samplePixel `developed`), measured the way range
 * masks measure it.
 */
export function describeDeveloped([r, g, b]: Vec3): { lum: number; hue: number; sat: number } {
  const lum = Math.round(100 * encode(0.2126 * decode(r) + 0.7152 * decode(g) + 0.0722 * decode(b)))
  const { h, s } = hueSat(r, g, b)
  return { lum, hue: Math.round(h) % 360, sat: Math.round(s * 100) }
}

/**
 * Brightness (0…100, display-encoded) and hue / saturation of a sampled source
 * pixel: the photo's own color (as shot, before edits). Fallback for engines
 * that can't sample the developed photo.
 */
export function describeSample(sample: Vec3, color: SourceColor): { lum: number; hue: number; sat: number } {
  const lin = color.space === 'camera' && color.rgbCam ? apply(color.rgbCam, sample) : sample
  const lum = Math.round(100 * encode(0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]))
  const [r, g, b] = lin.map(encode)
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  let hue = 0
  if (d > 0) hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return { lum, hue: Math.round((hue * 60 + 360) % 360), sat: Math.round(max > 0 ? (d / max) * 100 : 0) }
}
