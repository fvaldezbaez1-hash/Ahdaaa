import type { Mat3, Vec3 } from '../../color/matrices'
import { rawWbForNeutral, relativeWbForNeutral, TEMP_MAX, TEMP_MIN, TINT_MAX, TINT_MIN, WB_PRESETS } from '../../color/wb'
import { kelvinToSlider, sliderToKelvin } from '../../edit/defaults'
import type { SourceKind, WbPreset, WhiteBalance } from '../../edit/types'

// The RAW temperature slider moves evenly in mireds (so 3,000 K → 3,500 K
// takes as much travel as 10,000 K → 15,000 K). Its position is −mired so the
// slider still reads blue (low Kelvin) on the left and amber on the right.

export const TEMP_POS_MIN = -kelvinToSlider(TEMP_MIN)
export const TEMP_POS_MAX = -kelvinToSlider(TEMP_MAX)

export const kelvinToPos = (k: number) => -kelvinToSlider(k)
export const posToKelvin = (pos: number) => Math.min(TEMP_MAX, Math.max(TEMP_MIN, sliderToKelvin(-pos)))

export const formatKelvin = (k: number) => `${Math.round(k).toLocaleString('en-US')} K`

/** "5,450 K", "5450", "5.4k" → Kelvin. */
export function parseKelvin(text: string): number | undefined {
  const m = /^(\d+(?:\.\d+)?)(k)?$/.exec(text.trim().toLowerCase().replace(/kelvin|[\s,]/g, ''))
  if (!m) return undefined
  // "k" after a small number means thousands ("5.4k"); after a large one it's the unit.
  const v = Number(m[1]) * (m[2] && Number(m[1]) < 100 ? 1000 : 1)
  return Math.min(TEMP_MAX, Math.max(TEMP_MIN, v))
}

export const RAW_WB_PRESETS: { id: WbPreset; label: string }[] = [
  { id: 'asShot', label: 'As shot' },
  { id: 'auto', label: 'Auto' },
  { id: 'daylight', label: 'Daylight' },
  { id: 'cloudy', label: 'Cloudy' },
  { id: 'shade', label: 'Shade' },
  { id: 'tungsten', label: 'Tungsten' },
  { id: 'fluorescent', label: 'Fluorescent' },
  { id: 'flash', label: 'Flash' },
  { id: 'custom', label: 'Custom' },
]
export const DISPLAY_WB_PRESETS = RAW_WB_PRESETS.filter((p) => p.id === 'asShot' || p.id === 'auto' || p.id === 'custom')

/** Temperature/tint of a fixed preset ('auto' and 'custom' depend on the photo, so null). */
export function presetValues(kind: SourceKind, preset: WbPreset, asShot: { temp: number; tint: number } | undefined): { temp: number; tint: number } | null {
  if (preset === 'asShot') return kind === 'raw' ? { temp: Math.round(asShot?.temp ?? 5500), tint: Math.round(asShot?.tint ?? 0) } : { temp: 0, tint: 0 }
  if (kind === 'raw' && preset in WB_PRESETS) return { ...WB_PRESETS[preset as keyof typeof WB_PRESETS] }
  return null
}

/** White balance after a slider move: back to "As shot" when it lands on the camera's values. */
export function withTempTint(kind: SourceKind, temp: number, tint: number, asShot: { temp: number; tint: number } | undefined): WhiteBalance {
  const shot = presetValues(kind, 'asShot', asShot)!
  return { preset: temp === shot.temp && tint === shot.tint ? 'asShot' : 'custom', temp, tint }
}

/** Eyedropper: the white balance that makes a sampled source pixel neutral. */
export function neutralWb(kind: SourceKind, sample: Vec3, raw?: { camXyz: Mat3; shotMul: Vec3 }): { temp: number; tint: number } | null {
  if (!(sample[0] > 0 && sample[1] > 0 && sample[2] > 0)) return null
  if (kind === 'raw') {
    if (!raw) return null
    const { temp, tint } = rawWbForNeutral(raw.camXyz, raw.shotMul, sample)
    return { temp: Math.round(Math.min(TEMP_MAX, Math.max(TEMP_MIN, temp))), tint: Math.round(Math.min(TINT_MAX, Math.max(TINT_MIN, tint))) }
  }
  const { temp, tint } = relativeWbForNeutral(sample)
  return { temp: temp || 0, tint: tint || 0 }
}
