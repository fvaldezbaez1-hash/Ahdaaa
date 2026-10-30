// A rough CSS-filter stand-in for a look, shown on the photo's thumbnail while
// the real preview renders (or where WebGL2 is missing). Only the broad
// strokes: brightness, contrast, saturation, warmth and black & white.
import type { PresetData } from '../edit/types'

export function approxFilter(d: PresetData): string {
  const b = d.basic ?? {}
  const n = (v: number | undefined) => v ?? 0
  const lift = d.curve?.rgb?.[0]?.y ?? 0
  const bright = 2 ** (n(b.exposure) * 0.5) * (1 + n(b.shadows) * 0.0012 + n(b.whites) * 0.001 + n(b.highlights) * 0.0005)
  const contrast = 1 + n(b.contrast) * 0.004 + n(b.clarity) * 0.0015 + n(b.dehaze) * 0.002 - n(d.effects?.fade) * 0.0025 - lift * 1.2
  const sat = 1 + n(b.saturation) * 0.01 + n(b.vibrance) * 0.006
  const temp = n(d.wbShift?.temp)
  const parts = [`brightness(${bright.toFixed(3)})`, `contrast(${Math.max(0.3, contrast).toFixed(3)})`, `saturate(${Math.max(0, sat).toFixed(3)})`]
  if (d.treatment === 'bw') parts.push('grayscale(1)')
  if (temp > 0) parts.push(`sepia(${Math.min(0.5, temp * 0.012).toFixed(3)})`)
  if (temp < 0) parts.push(`hue-rotate(${Math.max(-12, temp * 0.4).toFixed(1)}deg)`)
  return parts.join(' ')
}

/** A color swatch for a look when there's no photo to preview it on: its shadow and highlight tones. */
export function swatch(d: PresetData): string {
  const g = d.grading ?? {}
  const temp = d.wbShift?.temp ?? 0
  const bw = d.treatment === 'bw'
  const tone = (w: { hue: number; sat: number } | undefined, light: number) => {
    const hue = w?.sat ? w.hue : temp >= 0 ? 35 : 215
    const sat = bw && !w?.sat ? 0 : Math.min(70, (w?.sat ?? 0) * 1.6 + Math.abs(temp) * 1.2 + (bw ? 0 : 12))
    return `hsl(${Math.round(hue)} ${Math.round(sat)}% ${light}%)`
  }
  return `linear-gradient(135deg, ${tone(g.shadows ?? g.midtones, 24)}, ${tone(g.highlights ?? g.midtones, 74)})`
}
