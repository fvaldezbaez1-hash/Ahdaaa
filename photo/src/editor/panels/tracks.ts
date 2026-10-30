import type { Band } from '../../edit/types'

// Slider track paints: they show which way a slider pushes the photo.

export const TRACK = {
  temp: 'linear-gradient(90deg, #3d7bf2, #c9c9c9 50%, #f2b33d)',
  tint: 'linear-gradient(90deg, #3fbf5a, #c9c9c9 50%, #d94fc0)',
  exposure: 'linear-gradient(90deg, #1b1b1b, #e9e9e9)',
  vibrance: 'linear-gradient(90deg, #8a8a8a, #c9c9c9 50%, #e0663a)',
  saturation: 'linear-gradient(90deg, #8a8a8a, #c9c9c9 50%, #e04a8c)',
  darkLight: 'linear-gradient(90deg, #2a2a2a, #d8d8d8)',
}

export const BAND_COLORS: Record<Band, string> = {
  red: '#e5484d', orange: '#f18a3a', yellow: '#f5d33d', green: '#46b15a', aqua: '#3cc4c4', blue: '#3e7bfa', purple: '#8d5cf6', magenta: '#e04aa8',
}

const ORDER: Band[] = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta']

export function bandTrack(band: Band, mode: 'hue' | 'sat' | 'lum' | 'bw'): string {
  const c = BAND_COLORS[band]
  const i = ORDER.indexOf(band)
  if (mode === 'hue') return `linear-gradient(90deg, ${BAND_COLORS[ORDER[(i + 7) % 8]]}, ${c}, ${BAND_COLORS[ORDER[(i + 1) % 8]]})`
  if (mode === 'sat') return `linear-gradient(90deg, #8a8a8a, ${c})`
  if (mode === 'lum') return `linear-gradient(90deg, #1b1b1b, ${c}, #f2f2f2)`
  return 'linear-gradient(90deg, #1b1b1b, #f2f2f2)'
}
