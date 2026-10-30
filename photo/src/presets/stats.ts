// "Best for this photo": a local, explainable ranking. A small copy of the
// photo is measured (brightness, contrast, color, and how much of it looks like
// sky, foliage, water or skin); each trait favors looks by their tags and the
// strongest reason becomes the one-line explanation. Nothing leaves the device.

import { apply, mul, OKLAB_M1, OKLAB_M2, SRGB_TO_XYZ } from '../color/matrices'
import type { Preset } from '../edit/types'
import type { SourceColor, SourceImage } from '../engine/types'

export interface PhotoStats {
  /** Mean OKLab lightness, 0…1. */
  brightness: number
  /** Spread of lightness between the 5th and 95th percentile. */
  contrast: number
  /** Mean OKLab chroma. */
  chroma: number
  /** Mean OKLab b (+ = warm/yellow, − = cool/blue). */
  warmth: number
  /** Fractions of the frame. */
  sky: number
  foliage: number
  water: number
  skin: number
}

const SRGB_TO_LMS = mul(OKLAB_M1, SRGB_TO_XYZ)

/** Measure a (small) linear image. Samples at most ~40k pixels. */
export function photoStats(img: SourceImage, color: SourceColor): PhotoStats {
  const toSrgb = color.space === 'camera' && color.rgbCam ? color.rgbCam : null
  const step = Math.max(1, Math.round(Math.sqrt((img.width * img.height) / 40000)))
  const hist = new Uint32Array(64)
  let n = 0, sumL = 0, sumC = 0, sumB = 0, sky = 0, foliage = 0, water = 0, skin = 0
  for (let y = 0; y < img.height; y += step) {
    const upper = y < img.height * 0.6
    for (let x = 0; x < img.width; x += step) {
      const i = (y * img.width + x) * 3
      let rgb: [number, number, number] = [img.data[i] / 65535, img.data[i + 1] / 65535, img.data[i + 2] / 65535]
      if (toSrgb) rgb = apply(toSrgb, rgb)
      const lms = apply(SRGB_TO_LMS, rgb).map((v) => Math.cbrt(Math.max(0, v))) as [number, number, number]
      const [L, a, b] = apply(OKLAB_M2, lms)
      const C = Math.hypot(a, b)
      const h = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360
      n++
      sumL += L
      sumC += C
      sumB += b
      hist[Math.min(63, Math.max(0, Math.floor(L * 64)))]++
      if (C < 0.03) continue
      // OKLCh hues: sky ≈ 250, sea ≈ 215, grass ≈ 137 (olive ≈ 117), skin ≈ 45–55.
      if (h >= 228 && h <= 285 && L > 0.5 && upper) sky++
      else if (h >= 100 && h <= 165 && C > 0.04) foliage++
      else if (h >= 175 && h < 228) water++
      else if (h >= 35 && h <= 70 && L > 0.3 && L < 0.9 && C < 0.12) skin++
    }
  }
  const pct = (p: number) => {
    let acc = 0
    for (let i = 0; i < 64; i++) if ((acc += hist[i]) >= p * n) return (i + 0.5) / 64
    return 1
  }
  return { brightness: sumL / n, contrast: pct(0.95) - pct(0.05), chroma: sumC / n, warmth: sumB / n, sky: sky / n, foliage: foliage / n, water: water / n, skin: skin / n }
}

interface Trait {
  /** 0…1: how strongly the photo has this trait. */
  weight: (s: PhotoStats) => number
  reason: string
  /** Tag → points (negative = avoid). */
  tags: Record<string, number>
}

const ramp = (v: number, from: number, to: number) => Math.min(1, Math.max(0, (v - from) / (to - from)))

const TRAITS: Trait[] = [
  { weight: (s) => ramp(s.skin, 0.04, 0.2), reason: 'Flatters skin and keeps it natural.', tags: { portrait: 3, skin: 3, wedding: 1.5, family: 1.5, soft: 1, surreal: -4, infrared: -4, neon: -3, 'cross process': -3, 'hue shift': -4 } },
  { weight: (s) => ramp(s.sky, 0.06, 0.3), reason: 'Holds the bright sky and deepens its blue.', tags: { sky: 3, landscape: 2, dramatic: 1.5, travel: 1, blue: 1 } },
  { weight: (s) => ramp(s.foliage, 0.08, 0.4), reason: 'Lots of foliage: makes the greens richer without going neon.', tags: { green: 3, foliage: 3, forest: 2, nature: 2, landscape: 1 } },
  { weight: (s) => ramp(s.water, 0.05, 0.25), reason: 'Brings out clean aquas and blues in the water.', tags: { aqua: 3, sea: 3, water: 3, coast: 2, beach: 2 } },
  { weight: (s) => ramp(0.32 - s.brightness, 0, 0.12), reason: 'Made for low light: clean blacks and glowing lights.', tags: { night: 3, neon: 1.5, lights: 2, 'low key': 1, bright: -2, airy: -3, 'high key': -3 } },
  { weight: (s) => ramp(s.brightness, 0.68, 0.8), reason: 'Keeps the bright, airy feel and protects the whites.', tags: { airy: 2.5, bright: 2, 'high key': 2, pastel: 1, dark: -3, 'low key': -3, night: -2 } },
  { weight: (s) => ramp(0.62 - s.contrast, 0, 0.2), reason: 'Flat light here: adds depth and shape.', tags: { contrast: 2.5, punchy: 2, dramatic: 1.5, bold: 1.5, vivid: 1, faded: -2, matte: -2, 'low contrast': -3 } },
  { weight: (s) => ramp(s.contrast, 0.8, 0.92), reason: 'Tames hard contrast for a softer finish.', tags: { soft: 2.5, matte: 2, faded: 1.5, 'low contrast': 2.5, contrast: -2, graphic: -1 } },
  { weight: (s) => ramp(s.chroma, 0.07, 0.11), reason: 'Plenty of color already: adds bite and keeps it natural.', tags: { vivid: 2, color: 2, punchy: 1, flowers: 1, muted: -1 } },
  { weight: (s) => ramp(0.045 - s.chroma, 0, 0.025), reason: 'Quiet color: strong shapes and tones suit black & white.', tags: { bw: 3, monochrome: 2, muted: 1.5, documentary: 1, vivid: -2 } },
  { weight: (s) => ramp(s.warmth, 0.015, 0.045), reason: 'Warm light is already in the scene; this deepens it.', tags: { warm: 2, golden: 2.5, sunset: 2, autumn: 1, cool: -2, icy: -2 } },
  { weight: (s) => ramp(-s.warmth, 0.005, 0.03), reason: 'Cool light: leans into the blue, calm mood.', tags: { cool: 2.5, blue: 1.5, winter: 1, warm: -1.5, golden: -2 } },
]

export interface Suggestion {
  preset: Preset
  reason: string
}

/** Score lost for each earlier pick with the same reason, so the list covers more than one idea. */
const REPEAT = 1.2

/** The looks that suit the photo best, at most `perCollection` from one collection. */
export function suggestLooks(stats: PhotoStats, presets: readonly Preset[], count = 12, perCollection = 2): Suggestion[] {
  const weights = TRAITS.map((t) => t.weight(stats))
  const scored = presets.map((p, order) => {
    const tags = new Set(p.tags ?? [])
    let score = 0, best = -Infinity, reason = 'A good all-round starting point.'
    TRAITS.forEach((t, i) => {
      if (!weights[i]) return
      const pts = Object.entries(t.tags).reduce((sum, [tag, v]) => sum + (tags.has(tag) ? v : 0), 0) * weights[i]
      score += pts
      if (pts > best && pts > 0) {
        best = pts
        reason = t.reason
      }
    })
    // Gentle everyday looks are safe picks when nothing stands out.
    if (p.collection === 'essentials') score += 0.5
    return { p, score, reason, order }
  })
  const per = new Map<string, number>()
  const reasons = new Map<string, number>()
  const out: Suggestion[] = []
  while (out.length < count) {
    let best: (typeof scored)[number] | undefined, bestValue = -Infinity
    for (const s of scored) {
      if ((per.get(s.p.collection) ?? 0) >= perCollection) continue
      const v = s.score - REPEAT * (reasons.get(s.reason) ?? 0)
      if (v > bestValue || (v === bestValue && best && s.order < best.order)) {
        best = s
        bestValue = v
      }
    }
    if (!best) break
    scored.splice(scored.indexOf(best), 1)
    per.set(best.p.collection, (per.get(best.p.collection) ?? 0) + 1)
    reasons.set(best.reason, (reasons.get(best.reason) ?? 0) + 1)
    out.push({ preset: best.p, reason: best.reason })
  }
  return out
}
