// Favorites (in settings) and the user's own presets (db.presets): saved from
// an edit, made by the AI, or imported from Lightroom.
import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { isIdentity } from '../color/curve'
import { DEFAULT_EFFECTS, defaultGrading } from '../edit/defaults'
import { BANDS, type EditRecipe, type Preset, type PresetData, type SourceKind } from '../edit/types'
import { db, uid } from '../io/db'
import type { UserPresetRecord } from '../io/types'
import { updateSettings, useSettings } from '../state/settings'
import { toast } from '../ui/toast'
import { findBuiltin } from './catalog'
import { toXmp } from './xmp'

export function useFavorites(): ReadonlySet<string> {
  const ids = useSettings()?.favoritePresets
  return useMemo(() => new Set(ids ?? []), [ids])
}

export function toggleFavorite(id: string): Promise<unknown> {
  return updateSettings((s) => ({ favoritePresets: s.favoritePresets.includes(id) ? s.favoritePresets.filter((f) => f !== id) : [...s.favoritePresets, id] }))
}

/** The user's presets, newest first (undefined while loading). */
export function useUserPresets(): UserPresetRecord[] | undefined {
  return useLiveQuery(() => db.presets.orderBy('createdAt').reverse().toArray(), [])
}

/** A preset by id: built-in, or one of the user's. */
export function usePreset(id: string | undefined): Preset | undefined {
  const user = useLiveQuery(async () => (id && !findBuiltin(id) ? ((await db.presets.get(id)) ?? null) : null), [id])
  return id ? (findBuiltin(id) ?? user ?? undefined) : undefined
}

export async function addUserPreset(p: Omit<UserPresetRecord, 'id' | 'createdAt'>): Promise<string> {
  const id = uid()
  await db.presets.add({ ...p, id, createdAt: Date.now() })
  return id
}

export const renamePreset = (id: string, name: string) => db.presets.update(id, { name: name.trim() || 'Untitled preset' })

export async function deletePreset(id: string): Promise<void> {
  await db.presets.delete(id)
  await updateSettings((s) => ({ favoritePresets: s.favoritePresets.filter((f) => f !== id) }))
}

// ---------- Saving the current edit as a preset ----------

export type SaveGroup = 'profile' | 'wb' | 'light' | 'presence' | 'curve' | 'mixer' | 'grading' | 'detail' | 'effects'

export const SAVE_GROUPS: { id: SaveGroup; label: string }[] = [
  { id: 'profile', label: 'Profile & treatment' },
  { id: 'wb', label: 'White balance' },
  { id: 'light', label: 'Light' },
  { id: 'presence', label: 'Presence' },
  { id: 'curve', label: 'Tone curve' },
  { id: 'mixer', label: 'Color mixer' },
  { id: 'grading', label: 'Color grading' },
  { id: 'effects', label: 'Effects' },
  { id: 'detail', label: 'Sharpening & noise' },
]

/** Sharpening and noise reduction depend on each photo, so they're left out unless chosen. */
export const DEFAULT_SAVE_GROUPS: SaveGroup[] = SAVE_GROUPS.map((g) => g.id).filter((g) => g !== 'detail')

const LIGHT = ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks'] as const
const PRESENCE = ['texture', 'clarity', 'dehaze', 'vibrance', 'saturation'] as const

const nonZero = <T extends object>(o: T): Partial<T> | undefined => {
  const out = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== 0)) as Partial<T>
  return Object.keys(out).length ? out : undefined
}

/**
 * The parts of a recipe a preset can carry. White balance becomes a shift
 * from the photo's as-shot (in mireds for RAW), so it travels to other photos.
 */
export function presetFromRecipe(r: EditRecipe, kind: SourceKind, asShot: { temp: number; tint: number } | undefined, groups: readonly SaveGroup[]): PresetData {
  const on = (g: SaveGroup) => groups.includes(g)
  const d: PresetData = {}
  if (on('profile')) {
    d.profile = r.profile
    d.treatment = r.treatment
  }
  if (on('wb')) {
    const shot = kind === 'raw' ? (asShot ?? { temp: r.wb.temp, tint: r.wb.tint }) : { temp: 0, tint: 0 }
    const temp = kind === 'raw' ? Math.round(1e6 / shot.temp - 1e6 / r.wb.temp) : r.wb.temp
    const tint = Math.round(r.wb.tint - shot.tint)
    if (temp || tint) d.wbShift = { temp, tint }
  }
  const keys = [...(on('light') ? LIGHT : []), ...(on('presence') ? PRESENCE : [])]
  const basic = nonZero(Object.fromEntries(keys.map((k) => [k, r.basic[k]])))
  if (basic) d.basic = basic
  if (on('curve')) {
    const curve = Object.fromEntries(Object.entries(r.curve).filter(([, p]) => !isIdentity(p)))
    if (Object.keys(curve).length) d.curve = curve
  }
  if (on('mixer')) {
    const mixer = Object.fromEntries((['hue', 'sat', 'lum', 'bw'] as const).map((g) => [g, nonZero(Object.fromEntries(BANDS.map((b) => [b, r.mixer[g][b]])))]).filter(([, v]) => v))
    if (Object.keys(mixer).length) d.mixer = mixer
  }
  if (on('grading')) {
    const g = r.grading, def = defaultGrading()
    const grading: PresetData['grading'] = {}
    for (const w of ['shadows', 'midtones', 'highlights', 'global'] as const) if (g[w].sat || g[w].lum) grading[w] = { ...g[w] }
    if (g.blending !== def.blending) grading.blending = g.blending
    if (g.balance !== def.balance) grading.balance = g.balance
    if (Object.keys(grading).length) d.grading = grading
  }
  if (on('detail')) d.detail = { ...r.detail }
  if (on('effects')) {
    const effects = Object.fromEntries(Object.entries(r.effects).filter(([k, v]) => v !== DEFAULT_EFFECTS[k as keyof typeof DEFAULT_EFFECTS]))
    if (Object.keys(effects).length) d.effects = effects
  }
  return d
}

/** Download a preset as a Lightroom-compatible .xmp file. */
export function exportXmp(p: Preset) {
  const blob = new Blob([toXmp(p.name, p.data, uid())], { type: 'application/rdf+xml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${p.name.replace(/[\\/:*?"<>|]+/g, '-')}.xmp`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  toast(`Exported “${p.name}” for Lightroom`)
}
