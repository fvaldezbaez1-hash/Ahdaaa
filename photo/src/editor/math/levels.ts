import type { Levels, LevelsChannel } from '../../edit/types'

// Levels handles on a 0…255 axis, like Photoshop: input black, midtone and
// white; output black and white. The midtone handle sits where the output is
// half way, so moving it sets gamma (out = t^(1/gamma); > 1 brightens).

export type LevelsChannelId = keyof Levels
export const CHANNELS: { id: LevelsChannelId; label: string }[] = [
  { id: 'rgb', label: 'RGB' },
  { id: 'r', label: 'Red' },
  { id: 'g', label: 'Green' },
  { id: 'b', label: 'Blue' },
]

/** Input black and white never come closer than this. */
export const MIN_GAP = 2
const GAMMA_MIN = 0.1, GAMMA_MAX = 10

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export const IDENTITY: LevelsChannel = { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 }

export const isIdentity = (c: LevelsChannel) =>
  c.inBlack === 0 && c.inWhite === 255 && c.gamma === 1 && c.outBlack === 0 && c.outWhite === 255

/** Where the midtone handle sits (0…255). */
export const midPosition = (c: LevelsChannel) => c.inBlack + (c.inWhite - c.inBlack) * Math.pow(0.5, c.gamma)

/** Gamma for a midtone handle at m (0…255), two decimals. */
export function gammaFromMid(c: LevelsChannel, m: number): number {
  const t = clamp((m - c.inBlack) / (c.inWhite - c.inBlack), 0.001, 0.999)
  return Math.round(clamp(Math.log(t) / Math.log(0.5), GAMMA_MIN, GAMMA_MAX) * 100) / 100
}

export type LevelsHandle = 'inBlack' | 'mid' | 'inWhite' | 'outBlack' | 'outWhite'

/** Move a handle to v (0…255), keeping the handles in order. The midtone keeps its gamma when black or white move. */
export function moveHandle(c: LevelsChannel, h: LevelsHandle, v: number): LevelsChannel {
  const x = Math.round(clamp(v, 0, 255))
  switch (h) {
    case 'inBlack':
      return { ...c, inBlack: Math.min(x, c.inWhite - MIN_GAP) }
    case 'inWhite':
      return { ...c, inWhite: Math.max(x, c.inBlack + MIN_GAP) }
    case 'mid':
      return { ...c, gamma: gammaFromMid(c, v) }
    case 'outBlack':
      return { ...c, outBlack: x }
    case 'outWhite':
      return { ...c, outWhite: x }
  }
}

/** The channel's transfer at input x (0…1) → output 0…1, for drawing it. */
export function transfer(c: LevelsChannel, x: number): number {
  const t = clamp((x * 255 - c.inBlack) / (c.inWhite - c.inBlack), 0, 1)
  return (c.outBlack + (c.outWhite - c.outBlack) * Math.pow(t, 1 / c.gamma)) / 255
}

/**
 * Auto: input black and white at the darkest and brightest `clip` fraction
 * of the histogram, so the tones span the full range.
 */
export function autoLevels(bins: ArrayLike<number>, clip = 0.001): Pick<LevelsChannel, 'inBlack' | 'inWhite'> {
  let total = 0
  for (let i = 0; i < 256; i++) total += bins[i]
  if (!total) return { inBlack: 0, inWhite: 255 }
  const limit = total * clip
  let lo = 0, hi = 255, acc = 0
  for (; lo < 254; lo++) if ((acc += bins[lo]) > limit) break
  acc = 0
  for (; hi > lo + MIN_GAP; hi--) if ((acc += bins[hi]) > limit) break
  return { inBlack: lo, inWhite: Math.max(hi, lo + MIN_GAP) }
}

export type PointKind = 'black' | 'gray' | 'white'

/**
 * Eyedroppers on a sampled color (display-encoded 0…1): black and white set
 * each channel's input end to the sample; gray sets each channel's gamma so
 * the sample comes out neutral (at its average). Taken as the color before Levels.
 */
export function pickPoint(levels: Levels, kind: PointKind, rgb: [number, number, number]): Levels {
  const v = rgb.map((x) => clamp(Math.round(x * 255), 0, 255))
  const next = { ...levels }
  const ids = ['r', 'g', 'b'] as const
  if (kind === 'black') ids.forEach((id, i) => (next[id] = moveHandle(levels[id], 'inBlack', v[i])))
  else if (kind === 'white') ids.forEach((id, i) => (next[id] = moveHandle(levels[id], 'inWhite', v[i])))
  else {
    const target = (v[0] + v[1] + v[2]) / 3
    ids.forEach((id, i) => {
      const c = levels[id]
      const x = clamp((v[i] - c.inBlack) / (c.inWhite - c.inBlack), 0.001, 0.999)
      const t = clamp((target - c.inBlack) / (c.inWhite - c.inBlack), 0.001, 0.999)
      next[id] = { ...c, gamma: Math.round(clamp(Math.log(x) / Math.log(t), GAMMA_MIN, GAMMA_MAX) * 100) / 100 }
    })
  }
  return next
}
