// The sync catalog: everything a device made (recipes, ratings, flags,
// keywords, albums, presets, export presets, what it deleted, and which AI
// results the recipes use), and how two or more catalogs merge. Pure, so the
// conflict rules are unit-tested:
//
//   • A photo is the same photo on every device when its file name, size and
//     capture time (from its metadata, when it has one) match.
//   • Per photo, the newest edit wins (recipe, by PhotoRecord.editedAt); its
//     info — rating, flag, keywords, albums — travels separately, newest
//     change wins. A tie keeps this device's version.
//   • Albums: newest rename wins; albums with the same name made on different
//     devices become one (the one with the smaller id, so every device agrees).
//   • Deleting wins over everything older: a photo or album deleted on one
//     device goes on the others unless it was changed (or added) after.
//   • Presets: kept from every device; export presets by newest change.
//   • Merging is idempotent and order doesn't matter: syncing again changes nothing.
import type { EditRecipe, SourceKind } from '../edit/types'
import type { Tombstone } from '../io/db'
import type { RasterRecord } from '../io/rasters'
import { recipeRasterIds } from '../io/rasters'
import type { PhotoMeta, PhotoRecord, RawColorInfo, UserPresetRecord } from '../io/types'
import type { ExportPreset } from '../library/exportPresets'

export const CATALOG_VERSION = 1
/** Tombstones older than this are forgotten (every device has long caught up). */
export const TOMBSTONE_DAYS = 180

export interface SyncPhoto {
  /** Identity across devices: see photoKey. */
  key: string
  /** Id on the device that wrote this entry (kept when the photo is created elsewhere from a synced original). */
  id: string
  fileName: string
  fileSize: number
  takenAt: number
  addedAt: number
  kind: SourceKind
  mime: string
  width: number
  height: number
  meta: PhotoMeta
  raw?: RawColorInfo
  previewOnly?: boolean
  merged?: PhotoRecord['merged']
  /** The edit: newest `editedAt` wins (0 = never edited). */
  recipe: EditRecipe
  edited: boolean
  editedAt: number
  /** The info: newest `infoAt` wins (0 = never changed). */
  rating: number
  flag: -1 | 0 | 1
  keywords: string[]
  albumIds: string[]
  infoAt: number
  /** Path of the original in the sync folder, when originals are synced. */
  original?: string
}

export interface SyncAlbum {
  id: string
  name: string
  createdAt: number
  /** Cover photo, by identity key. */
  coverKey?: string
  /** Last rename (or creation). */
  at: number
}

export type SyncTombstone = Omit<Tombstone, 'id'>

/** An AI result a recipe uses; its pixels live next to the catalog (folder) or inline (sync file). */
export type SyncRaster = Omit<RasterRecord, 'data' | 'photoId'> & { photoKey: string; bytes: number; data?: string }

export interface Catalog {
  app: 'lumen'
  type: 'sync'
  version: typeof CATALOG_VERSION
  device: string
  deviceName: string
  writtenAt: number
  photos: SyncPhoto[]
  albums: SyncAlbum[]
  presets: UserPresetRecord[]
  exportPresets: ExportPreset[]
  tombstones: SyncTombstone[]
  rasters: SyncRaster[]
}

export function emptyCatalog(device: string, deviceName = '', writtenAt = 0): Catalog {
  return { app: 'lumen', type: 'sync', version: CATALOG_VERSION, device, deviceName, writtenAt, photos: [], albums: [], presets: [], exportPresets: [], tombstones: [], rasters: [] }
}

/** A catalog read from a file or another device, checked loosely (missing lists become empty). */
export function parseCatalog(json: unknown): Catalog {
  const c = json as Partial<Catalog> | null
  if (!c || c.app !== 'lumen' || c.type !== 'sync' || !Array.isArray(c.photos)) throw new Error("This file isn't a Lumen sync file.")
  if ((c.version ?? 0) > CATALOG_VERSION) throw new Error('This sync file was made by a newer version of Lumen. Update Lumen on this device first.')
  const list = <T,>(v: T[] | undefined) => (Array.isArray(v) ? v : [])
  return {
    ...emptyCatalog(String(c.device ?? 'unknown'), String(c.deviceName ?? ''), Number(c.writtenAt) || 0),
    photos: c.photos.filter((p) => p && typeof p.key === 'string' && p.recipe),
    albums: list(c.albums).filter((a) => a && typeof a.id === 'string'),
    presets: list(c.presets).filter((p) => p && typeof p.id === 'string'),
    exportPresets: list(c.exportPresets).filter((p) => p && typeof p.id === 'string'),
    tombstones: list(c.tombstones).filter((t) => t && typeof t.key === 'string'),
    rasters: list(c.rasters).filter((r) => r && typeof r.id === 'string'),
  }
}

const fold = (s: string) => s.trim().toLocaleLowerCase()
const tombKey = (t: Pick<SyncTombstone, 'kind' | 'key'>) => `${t.kind}:${t.key}`

/** Newest by `at`; on a tie the earlier one (this device's) stays. */
function newest<T>(items: readonly T[], at: (x: T) => number): T {
  let best = items[0]
  for (const x of items) if (at(x) > at(best)) best = x
  return best
}

/** Merge other devices' catalogs into this device's (`base`). */
export function mergeCatalogs(base: Catalog, others: readonly Catalog[], now = Date.now()): Catalog {
  const all = [base, ...others]

  // Tombstones: the newest per thing, recent ones only.
  const tombs = new Map<string, SyncTombstone>()
  const horizon = now - TOMBSTONE_DAYS * 86_400_000
  for (const t of all.flatMap((c) => c.tombstones)) {
    if (t.at < horizon) continue
    const k = tombKey(t)
    const cur = tombs.get(k)
    if (!cur || t.at > cur.at) tombs.set(k, { kind: t.kind, key: t.key, at: t.at })
  }
  const deletedAt = (kind: SyncTombstone['kind'], key: string) => tombs.get(`${kind}:${key}`)?.at ?? -Infinity

  // Albums: newest version per id, then one album per name.
  const byId = new Map<string, SyncAlbum[]>()
  for (const a of all.flatMap((c) => c.albums)) byId.set(a.id, [...(byId.get(a.id) ?? []), a])
  const albumsById = [...byId.values()].map((vs) => newest(vs, (a) => a.at)).filter((a) => deletedAt('album', a.id) < a.at)
  const albumMap = new Map<string, string>()
  const byName = new Map<string, SyncAlbum[]>()
  for (const a of albumsById) byName.set(fold(a.name), [...(byName.get(fold(a.name)) ?? []), a])
  const albums: SyncAlbum[] = []
  for (const group of byName.values()) {
    const keep = [...group].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0]
    const latest = newest(group, (a) => a.at)
    for (const a of group) albumMap.set(a.id, keep.id)
    albums.push({ ...keep, name: latest.name, coverKey: keep.coverKey ?? group.find((a) => a.coverKey)?.coverKey, at: Math.max(...group.map((a) => a.at)) })
  }
  const albumIdsOf = (ids: readonly string[]) => [...new Set(ids.map((id) => albumMap.get(id)).filter((id): id is string => !!id))]

  // Photos: per key, the newest edit and the newest info.
  const byKey = new Map<string, SyncPhoto[]>()
  for (const p of all.flatMap((c) => c.photos)) byKey.set(p.key, [...(byKey.get(p.key) ?? []), p])
  const photos: SyncPhoto[] = []
  for (const [key, versions] of byKey) {
    const edit = newest(versions, (p) => p.editedAt)
    const info = newest(versions, (p) => p.infoAt)
    const latest = Math.max(edit.editedAt, info.infoAt, ...versions.map((p) => p.addedAt))
    if (deletedAt('photo', key) >= latest) continue
    const own = versions[0]
    photos.push({
      ...own,
      recipe: edit.recipe,
      edited: edit.edited,
      editedAt: edit.editedAt,
      rating: info.rating,
      flag: info.flag,
      keywords: [...info.keywords],
      albumIds: albumIdsOf(info.albumIds),
      infoAt: info.infoAt,
      original: own.original ?? versions.find((p) => p.original)?.original,
    })
  }
  const keys = new Set(photos.map((p) => p.key))
  for (const a of albums) if (a.coverKey && !keys.has(a.coverKey)) delete a.coverKey

  // AI results the merged recipes use.
  const used = new Set(photos.flatMap((p) => [...recipeRasterIds(p.recipe)]))
  const rasters = new Map<string, SyncRaster>()
  for (const r of all.flatMap((c) => c.rasters)) if (used.has(r.id) && !rasters.has(r.id)) rasters.set(r.id, r)

  // Presets: from every device; export presets by newest change, unless deleted after.
  const presets = new Map<string, UserPresetRecord>()
  for (const p of all.flatMap((c) => c.presets)) if (!presets.has(p.id)) presets.set(p.id, p)
  const exportById = new Map<string, ExportPreset[]>()
  for (const p of all.flatMap((c) => c.exportPresets)) exportById.set(p.id, [...(exportById.get(p.id) ?? []), p])
  const exportPresets = [...exportById.values()].map((vs) => newest(vs, (p) => p.updatedAt ?? 0)).filter((p) => deletedAt('exportPreset', p.id) < (p.updatedAt ?? 0))

  return {
    ...base,
    writtenAt: now,
    photos: photos.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
    albums: albums.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1)),
    presets: [...presets.values()],
    exportPresets,
    tombstones: [...tombs.values()],
    rasters: [...rasters.values()],
  }
}

// ---------- What applying a merge changes on this device ----------

export interface ApplyPlan {
  /** Local photos (by key) whose recipe changes. */
  edits: SyncPhoto[]
  /** Local photos (by key) whose rating / flag / keywords / albums change. */
  infos: SyncPhoto[]
  /** Photos this device doesn't have, with an original in the sync folder to create them from. */
  creates: SyncPhoto[]
  /** Photos only another device has and no original was synced for (they stay in the catalog). */
  elsewhere: number
  /** Local photos deleted on another device. */
  deletes: string[]
  albumsPut: SyncAlbum[]
  albumsDelete: string[]
  presetsAdd: UserPresetRecord[]
  exportPresets: ExportPreset[] | null
  tombstones: SyncTombstone[]
  /** AI results the updated recipes need that this device doesn't have. */
  rasters: SyncRaster[]
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Compare this device's catalog with the merge: the changes to make here. Nothing to do → every list empty. */
export function planApply(local: Catalog, merged: Catalog, haveRasters: ReadonlySet<string> = new Set(local.rasters.map((r) => r.id))): ApplyPlan {
  const localByKey = new Map(local.photos.map((p) => [p.key, p]))
  const mergedKeys = new Set(merged.photos.map((p) => p.key))
  const plan: ApplyPlan = { edits: [], infos: [], creates: [], elsewhere: 0, deletes: [], albumsPut: [], albumsDelete: [], presetsAdd: [], exportPresets: null, tombstones: [], rasters: [] }
  const needRasters = new Set<string>()

  for (const m of merged.photos) {
    const l = localByKey.get(m.key)
    if (!l) {
      if (m.original) {
        plan.creates.push(m)
        recipeRasterIds(m.recipe).forEach((id) => needRasters.add(id))
      } else plan.elsewhere++
      continue
    }
    if (l.editedAt !== m.editedAt || !sameJson(l.recipe, m.recipe)) {
      plan.edits.push(m)
      recipeRasterIds(m.recipe).forEach((id) => needRasters.add(id))
    }
    if (l.infoAt !== m.infoAt || l.rating !== m.rating || l.flag !== m.flag || !sameJson(l.keywords, m.keywords) || !sameJson([...l.albumIds].sort(), [...m.albumIds].sort())) plan.infos.push(m)
  }
  for (const l of local.photos) if (!mergedKeys.has(l.key)) plan.deletes.push(l.key)

  const localAlbums = new Map(local.albums.map((a) => [a.id, a]))
  const mergedAlbums = new Set(merged.albums.map((a) => a.id))
  for (const a of merged.albums) {
    const l = localAlbums.get(a.id)
    if (!l || l.name !== a.name || l.coverKey !== a.coverKey || l.at !== a.at) plan.albumsPut.push(a)
  }
  for (const a of local.albums) if (!mergedAlbums.has(a.id)) plan.albumsDelete.push(a.id)

  const localPresets = new Set(local.presets.map((p) => p.id))
  plan.presetsAdd = merged.presets.filter((p) => !localPresets.has(p.id))
  if (!sameJson(local.exportPresets, merged.exportPresets)) plan.exportPresets = merged.exportPresets

  const localTombs = new Map(local.tombstones.map((t) => [tombKey(t), t.at]))
  plan.tombstones = merged.tombstones.filter((t) => localTombs.get(tombKey(t)) !== t.at)
  plan.rasters = merged.rasters.filter((r) => needRasters.has(r.id) && !haveRasters.has(r.id))
  return plan
}

export const planIsEmpty = (p: ApplyPlan) =>
  !p.edits.length && !p.infos.length && !p.creates.length && !p.deletes.length && !p.albumsPut.length && !p.albumsDelete.length && !p.presetsAdd.length && !p.exportPresets && !p.tombstones.length && !p.rasters.length
