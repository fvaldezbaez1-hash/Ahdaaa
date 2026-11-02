// Named export settings ("Web JPEG", "Full TIFF"…): built-in ones plus the
// user's, stored in Settings.exportPresets. Pure list operations, unit-tested.
import type { ExportOptions } from '../io/types'
import { FORMATS } from './exportMath'
import { DEFAULT_TEMPLATE } from './fileNames'

export interface ExportPreset {
  id: string
  name: string
  options: ExportOptions
  /** Built in (can't be renamed or deleted). */
  builtin?: boolean
  /** Last change, ms (sync keeps the newest). */
  updatedAt?: number
}

const base: ExportOptions = { format: 'jpeg', quality: 92, colorSpace: 'srgb', keepMetadata: true, stripLocation: true, includeKeywords: true }

export const BUILTIN_PRESETS: ExportPreset[] = [
  { id: 'builtin:web', name: 'Web JPEG', builtin: true, options: { ...base, quality: 85, longEdge: 2048, fileName: '{name}-web' } },
  { id: 'builtin:social', name: 'Social 1080', builtin: true, options: { ...base, quality: 88, longEdge: 1080, keepMetadata: false, includeKeywords: false, fileName: '{name}-social' } },
  { id: 'builtin:full', name: 'Full-size JPEG', builtin: true, options: { ...base, quality: 95, fileName: DEFAULT_TEMPLATE } },
  { id: 'builtin:tiff', name: 'Full TIFF 16-bit', builtin: true, options: { ...base, format: 'tiff16', stripLocation: false, fileName: '{name}-full' } },
]

const fold = (s: string) => s.trim().toLocaleLowerCase()

export function allPresets(user: readonly ExportPreset[] | undefined): ExportPreset[] {
  return [...BUILTIN_PRESETS, ...(user ?? [])]
}

/** "Web JPEG" → "Web JPEG 2" (then 3…) while another preset has the name, ignoring case. */
export function uniquePresetName(name: string, taken: readonly { name: string; id?: string }[], exceptId?: string): string {
  const clean = name.trim().replace(/\s+/g, ' ').slice(0, 60) || 'Export preset'
  const used = new Set(taken.filter((p) => p.id !== exceptId).map((p) => fold(p.name)))
  if (!used.has(fold(clean))) return clean
  const stem = clean.replace(/\s+\d+$/, '')
  for (let n = 2; ; n++) if (!used.has(fold(`${stem} ${n}`))) return `${stem} ${n}`
}

/** The user preset with this name (ignoring case), if any — saving under it replaces it. */
export const presetNamed = (user: readonly ExportPreset[] | undefined, name: string) => (user ?? []).find((p) => fold(p.name) === fold(name))

/**
 * Save export settings under a name. Same name as one of the user's presets:
 * `replace` overwrites it, otherwise the new one gets a numbered name. A
 * built-in's name always gets a number (built-ins can't be replaced).
 */
export function savePreset(user: readonly ExportPreset[] | undefined, name: string, options: ExportOptions, id: string, opts: { replace?: boolean; now?: number } = {}): ExportPreset[] {
  const list = [...(user ?? [])]
  const now = opts.now ?? Date.now()
  const existing = presetNamed(list, name)
  if (existing && opts.replace) return list.map((p) => (p.id === existing.id ? { ...p, options: { ...options }, updatedAt: now } : p))
  const preset: ExportPreset = { id, name: uniquePresetName(name, allPresets(list)), options: { ...options }, updatedAt: now }
  return [...list, preset]
}

export function renamePreset(user: readonly ExportPreset[] | undefined, id: string, name: string, now = Date.now()): ExportPreset[] {
  const list = [...(user ?? [])]
  return list.map((p) => (p.id === id ? { ...p, name: uniquePresetName(name, allPresets(list), id), updatedAt: now } : p))
}

export const deletePreset = (user: readonly ExportPreset[] | undefined, id: string) => (user ?? []).filter((p) => p.id !== id)

/** Do these settings match the preset (so the picker can show its name)? */
export function sameOptions(a: ExportOptions, b: ExportOptions): boolean {
  const norm = (o: ExportOptions) =>
    JSON.stringify([o.format, o.format === 'jpeg' ? o.quality : 0, o.longEdge ?? 0, o.colorSpace, o.keepMetadata, o.keepMetadata && o.stripLocation, o.includeKeywords !== false, o.upscale ?? 1, o.fileName || DEFAULT_TEMPLATE])
  return norm(a) === norm(b)
}

/** "JPEG 85 · 2048 px · sRGB" */
export function presetSummary(o: ExportOptions): string {
  const f = FORMATS.find((x) => x.value === o.format)?.label ?? o.format
  return [o.format === 'jpeg' ? `${f} ${o.quality}` : f, o.longEdge ? `${o.longEdge} px` : 'full size', o.colorSpace === 'srgb' ? 'sRGB' : 'P3', o.upscale === 2 ? '2× upscaled' : ''].filter(Boolean).join(' · ')
}
