import { apply, type Vec3 } from '../../color/matrices'
import type { SourceColor } from '../../engine/types'

const encode = (c: number) => {
  const v = Math.min(1, Math.max(0, c))
  return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
}

/**
 * Brightness (0…100, display-encoded) and hue / saturation of a sampled source
 * pixel, for range masks. It's the photo's own color (as shot, before edits):
 * close enough to pick "this blue" or "these highlights".
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
