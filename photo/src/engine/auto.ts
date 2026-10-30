// "Auto": a tasteful starting point from the low-res copy — white balance by a
// robust gray world on near-neutral midtones, then exposure and the tone
// sliders from luminance percentiles. Deliberately conservative.

import type { Vec3 } from '../color/matrices'
import { rawWbForNeutral, relativeWbForNeutral, tempTintFromMultipliers } from '../color/wb'
import type { Basic, EditRecipe } from '../edit/types'
import type { FloatImage } from './image'
import { inputTransform, toWorkingSpace } from './params'
import type { SourceColor } from './types'

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))

function median(a: number[]): number {
  if (!a.length) return 0
  const s = a.slice().sort((x, y) => x - y)
  return s[s.length >> 1]
}

/** Mean color of near-neutral midtone pixels (source space), or null if there are too few. */
export function neutralEstimate(img: FloatImage): Vec3 | null {
  const d = img.data, n = img.width * img.height
  const lr: number[] = [], lb: number[] = []
  const idx: number[] = []
  for (let i = 0; i < n; i++) {
    const r = d[i * 3], g = d[i * 3 + 1], b = d[i * 3 + 2]
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
    if (mx > 0.92 || mn < 0.01) continue // clipped or too dark to trust
    lr.push(Math.log(r / g))
    lb.push(Math.log(b / g))
    idx.push(i)
  }
  if (idx.length < 50) return null
  const cr = median(lr), cb = median(lb)
  const sum: Vec3 = [0, 0, 0]
  let count = 0
  // Refine with the pixels whose color is close to the median: gray-ish surfaces, not the dominant hue.
  for (let k = 0; k < idx.length; k++) {
    if (Math.hypot(lr[k] - cr, lb[k] - cb) > 0.2) continue
    const i = idx[k]
    sum[0] += d[i * 3]
    sum[1] += d[i * 3 + 1]
    sum[2] += d[i * 3 + 2]
    count++
  }
  return count >= 20 ? [sum[0] / count, sum[1] / count, sum[2] / count] : [Math.exp(cr), 1, Math.exp(cb)]
}

function autoWb(img: FloatImage, color: SourceColor, current: { temp: number; tint: number }): { temp: number; tint: number } {
  const est = neutralEstimate(img)
  if (!est) return current
  if (color.space === 'camera' && color.camXyz && color.shotMul) {
    const shot = tempTintFromMultipliers(color.camXyz, color.shotMul)
    const wb = rawWbForNeutral(color.camXyz, color.shotMul, est)
    // Move at most ~45 mired / 25 tint away from the camera's own reading: scenes are rarely truly gray-world.
    const m0 = 1e6 / shot.temp
    const m = m0 + clamp((1e6 / wb.temp - m0) * 0.85, -45, 45)
    return { temp: Math.round(clamp(1e6 / m, 2000, 50000) / 50) * 50, tint: Math.round(shot.tint + clamp((wb.tint - shot.tint) * 0.85, -25, 25)) }
  }
  const wb = relativeWbForNeutral(est)
  return { temp: Math.round(clamp(wb.temp * 0.8, -40, 40)), tint: Math.round(clamp(wb.tint * 0.8, -25, 25)) }
}

export function autoSettings(img: FloatImage, color: SourceColor, recipe: EditRecipe): { basic: Partial<Basic>; wb: { temp: number; tint: number } } {
  const wb = autoWb(img, color, recipe.wb)
  const t = inputTransform(color, wb)
  const n = img.width * img.height
  const lum: number[] = []
  let satSum = 0
  for (let i = 0; i < n; i++) {
    const v = toWorkingSpace(t, [img.data[i * 3], img.data[i * 3 + 1], img.data[i * 3 + 2]])
    lum.push(Math.max(1e-6, 0.2627 * v[0] + 0.678 * v[1] + 0.0593 * v[2]))
    const mx = Math.max(...v), mn = Math.min(...v)
    satSum += mx > 1e-4 ? clamp((mx - mn) / mx, 0, 1) : 0
  }
  lum.sort((a, b) => a - b)
  const pct = (p: number) => lum[Math.min(n - 1, Math.floor(p * n))]
  const raw = color.space === 'camera'

  const p50 = pct(0.5)
  let e = Math.log2(0.16 / p50)
  // Don't brighten so far that the top 1 % blows out — shadows do the rest.
  if (e > 0) e = Math.min(e, Math.max(0, Math.log2(1.6 / pct(0.99))))
  e = clamp(raw ? e : e * 0.6, raw ? -2.5 : -1.5, raw ? 2.5 : 1.5)
  const k = 2 ** e
  const q99 = pct(0.99) * k, q995 = pct(0.995) * k, q5 = pct(0.05) * k, q1 = pct(0.01) * k
  const highlights = q99 > 0.7 ? -clamp((Math.log2(q99) + 0.5) * 40, 0, 70) : 0
  const shadows = q5 < 0.02 ? clamp(Math.log2(0.02 / q5) * 15, 0, 55) : 0
  const whites = q995 < 0.6 ? clamp(Math.log2(0.9 / q995) * 25, 0, 40) : 0
  const blacks = q1 > 0.008 ? -clamp(Math.log2(q1 / 0.008) * 10, 0, 30) : 0
  const spread = Math.log2(pct(0.95) / pct(0.05))
  const contrast = spread < 4 ? clamp((4 - spread) * 8, 0, 25) : spread > 9 ? -clamp((spread - 9) * 5, 0, 20) : 0
  const meanSat = satSum / n
  const vibrance = clamp(30 - meanSat * 60, 5, 30)

  return {
    basic: {
      exposure: Math.round(e * 20) / 20,
      contrast: Math.round(contrast),
      highlights: Math.round(highlights),
      shadows: Math.round(shadows),
      whites: Math.round(whites),
      blacks: Math.round(blacks),
      vibrance: Math.round(vibrance),
    },
    wb,
  }
}
