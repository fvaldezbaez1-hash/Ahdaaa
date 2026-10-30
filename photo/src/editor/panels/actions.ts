import type { Engine } from '../../engine/types'
import type { ProfileId, Treatment, WbPreset } from '../../edit/types'
import { editor } from '../../state/editor'
import { toast } from '../../ui/toast'
import { formatKelvin, neutralWb, presetValues } from '../math/wb'
import type { Session } from '../session'
import { view } from '../view'

// One-step edits triggered by buttons and menus (each is a single undo step).

/** Auto tone: the engine's suggestion for light and presence (white balance stays as is). */
export function applyAuto(engine: Engine): boolean {
  const r = editor.getState().recipe
  if (!r) return false
  const { basic } = engine.auto(r)
  if (!Object.keys(basic).length) return false
  editor.apply((x) => ({ ...x, basic: { ...x.basic, ...basic } }), 'Auto')
  return true
}

const wbLabel = (kind: string, temp: number, tint: number) =>
  kind === 'raw' ? `${formatKelvin(temp)}, tint ${tint > 0 ? '+' : ''}${tint}` : `${temp > 0 ? '+' : ''}${temp} / ${tint > 0 ? '+' : ''}${tint}`

export function setWbPreset(engine: Engine, preset: WbPreset) {
  const { recipe, kind, asShot } = editor.getState()
  if (!recipe) return
  if (preset === 'custom') {
    editor.apply((r) => ({ ...r, wb: { ...r.wb, preset } }), 'White balance: Custom')
    return
  }
  const values = preset === 'auto' ? engine.auto(recipe).wb : presetValues(kind, preset, asShot)
  if (!values) {
    toast('Auto white balance isn’t available for this photo')
    return
  }
  const name = preset === 'asShot' ? 'As shot' : preset[0].toUpperCase() + preset.slice(1)
  editor.apply((r) => ({ ...r, wb: { preset, temp: Math.round(values.temp), tint: Math.round(values.tint) } }), `White balance: ${name}`)
}

/** Eyedropper click at a normalized position on the shown photo. */
export function pickWhiteBalance(session: Session, nx: number, ny: number) {
  view.set({ eyedropper: false })
  const sample = session.engine.samplePixel(nx, ny, 4)
  const { kind } = editor.getState()
  const c = session.photo.color
  const raw = c.camXyz && c.shotMul ? { camXyz: c.camXyz, shotMul: c.shotMul } : undefined
  const wb = sample && neutralWb(kind, sample, raw)
  if (!wb) {
    toast('That spot is too dark to judge. Pick a light gray or white area.')
    return
  }
  editor.apply((r) => ({ ...r, wb: { preset: 'custom', ...wb } }), `White balance ${wbLabel(kind, wb.temp, wb.tint)}`)
}

export const PROFILES: { id: ProfileId; label: string }[] = [
  { id: 'color', label: 'Lumen Color' },
  { id: 'neutral', label: 'Lumen Neutral' },
  { id: 'vivid', label: 'Lumen Vivid' },
  { id: 'portrait', label: 'Lumen Portrait' },
  { id: 'landscape', label: 'Lumen Landscape' },
  { id: 'flat', label: 'Lumen Flat' },
  { id: 'mono', label: 'Monochrome' },
]

/** The Monochrome profile and the B&W treatment go together, like in Lightroom. */
export function setProfile(id: ProfileId) {
  const label = PROFILES.find((p) => p.id === id)?.label ?? id
  editor.apply((r) => ({ ...r, profile: id, treatment: id === 'mono' ? 'bw' : r.profile === 'mono' ? 'color' : r.treatment }), `Profile: ${label}`)
}

export function setTreatment(t: Treatment) {
  editor.apply((r) => ({ ...r, treatment: t, profile: t === 'color' && r.profile === 'mono' ? 'color' : r.profile }), t === 'bw' ? 'Black & white' : 'Color')
}
