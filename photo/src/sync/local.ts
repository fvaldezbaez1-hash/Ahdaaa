// This device's side of sync: its catalog from the database, and applying a
// merge plan back to it (recipes, info, albums, presets, deletions, AI results
// and — with a synced original — whole photos).
import { defaultRecipe, isUnedited, normalizeRecipe } from '../edit/defaults'
import { db, kvGet, kvSet, uid } from '../io/db'
import { deletePhotos } from '../io/library'
import { recipeRasterIds, type RasterRecord } from '../io/rasters'
import type { PhotoRecord } from '../io/types'
import { cleanKeywords } from '../library/keywords'
import { loadSettings, updateSettings } from '../state/settings'
import { emptyCatalog, type ApplyPlan, type Catalog, type SyncPhoto, type SyncRaster } from './catalog'
import { albumStampId, photoKey, photoStampId } from './stamps'

export interface Device {
  id: string
  name: string
}

/** This device's sync id (made once) and a name other devices can show. */
export async function thisDevice(): Promise<Device> {
  const saved = await kvGet<Device>('sync.device')
  if (saved?.id) return saved
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
  const name = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows PC' : /Linux/.test(ua) ? 'Linux PC' : 'This device'
  const d = { id: uid(), name }
  await kvSet('sync.device', d)
  return d
}

export function toSyncPhoto(p: PhotoRecord, infoAt: number, original?: string): SyncPhoto {
  return {
    key: photoKey(p),
    id: p.id,
    fileName: p.fileName,
    fileSize: p.fileSize,
    takenAt: p.takenAt,
    addedAt: p.addedAt,
    kind: p.kind,
    mime: p.mime,
    width: p.width,
    height: p.height,
    meta: p.meta,
    ...(p.raw && { raw: p.raw }),
    ...(p.previewOnly && { previewOnly: true }),
    ...(p.merged && { merged: p.merged }),
    recipe: p.recipe,
    edited: p.edited,
    editedAt: p.editedAt ?? 0,
    rating: p.rating,
    flag: p.flag,
    keywords: p.keywords ?? [],
    albumIds: p.albumIds,
    infoAt,
    ...(original && { original }),
  }
}

/** Everything this device has, as a catalog. `original` names a photo's original in the sync folder, if there. */
export async function localCatalog(device: Device, original?: (p: PhotoRecord) => string | undefined): Promise<Catalog> {
  const [photos, albums, presets, settings, stamps, tombstones, rasters] = await Promise.all([
    db.photos.toArray(),
    db.albums.toArray(),
    db.presets.toArray(),
    loadSettings(),
    db.syncStamps.toArray(),
    db.tombstones.toArray(),
    db.rasters.toArray(),
  ])
  const at = new Map(stamps.map((s) => [s.id, s.at]))
  const keyOf = new Map(photos.map((p) => [p.id, photoKey(p)]))
  const c = emptyCatalog(device.id, device.name, Date.now())
  c.photos = photos.map((p) => toSyncPhoto(p, at.get(photoStampId(p.id)) ?? 0, original?.(p)))
  c.albums = albums.map((a) => ({ id: a.id, name: a.name, createdAt: a.createdAt, ...(a.coverId && keyOf.has(a.coverId) && { coverKey: keyOf.get(a.coverId) }), at: at.get(albumStampId(a.id)) ?? a.createdAt }))
  c.presets = presets
  c.exportPresets = settings.exportPresets ?? []
  c.tombstones = tombstones.map(({ kind, key, at: t }) => ({ kind, key, at: t }))
  const used = new Set(photos.flatMap((p) => [...recipeRasterIds(p.recipe)]))
  c.rasters = rasters.filter((r) => used.has(r.id) && keyOf.has(r.photoId)).map((r) => syncRaster(r, keyOf.get(r.photoId)!))
  return c
}

const syncRaster = ({ data, photoId: _photoId, ...r }: RasterRecord, photoKey: string): SyncRaster => ({ ...r, photoKey, bytes: data.byteLength })

/** Where a merge's missing pieces come from: the sync folder, or a sync file's inline data. */
export interface SyncSource {
  raster(r: SyncRaster): Promise<Uint8Array | null>
  original?(p: SyncPhoto): Promise<Blob | null>
}

export interface ApplyResult {
  updated: number
  created: number
  deleted: number
  /** Photos another device has that this one can't show (no original synced). */
  elsewhere: number
  /** Ids whose thumbnails need re-rendering. */
  thumbs: string[]
}

/** Make this device match the merge. One transaction for the records; originals are read first. */
export async function applyPlan(plan: ApplyPlan, source: SyncSource): Promise<ApplyResult> {
  // Slow reads (files) before the transaction, which must not wait on anything but the database.
  const rasterData = new Map<string, Uint8Array>()
  for (const r of plan.rasters) {
    const d = await source.raster(r).catch(() => null)
    if (d) rasterData.set(r.id, d)
  }
  const originals = new Map<string, Blob>()
  for (const p of plan.creates) {
    const b = await source.original?.(p).catch(() => null)
    if (b) originals.set(p.key, b)
  }

  const thumbs: string[] = []
  let updated = 0, created = 0
  const deleteIds: string[] = []
  await db.transaction('rw', [db.photos, db.originals, db.albums, db.presets, db.syncStamps, db.tombstones, db.rasters, db.kv], async () => {
    const all = await db.photos.toArray()
    const byKey = new Map(all.map((p) => [photoKey(p), p]))

    for (const a of plan.albumsPut) {
      const cover = a.coverKey ? byKey.get(a.coverKey)?.id : undefined
      const cur = await db.albums.get(a.id)
      await db.albums.put({ id: a.id, name: a.name, createdAt: cur?.createdAt ?? a.createdAt, ...((cover ?? cur?.coverId) && { coverId: cover ?? cur?.coverId }) })
      await db.syncStamps.put({ id: albumStampId(a.id), at: a.at })
    }
    if (plan.albumsDelete.length) {
      await db.albums.bulkDelete(plan.albumsDelete)
      await db.syncStamps.bulkDelete(plan.albumsDelete.map(albumStampId))
    }

    const touched = new Map<string, PhotoRecord>()
    const get = (key: string) => {
      const p = byKey.get(key)
      return p && (touched.get(p.id) ?? { ...p })
    }
    for (const m of plan.edits) {
      const p = get(m.key)
      if (!p) continue
      const asShot = p.raw?.asShot
      const recipe = normalizeRecipe(m.recipe, p.kind, asShot)
      // A recipe from a RAW-developed copy doesn't fit an embedded-preview copy (or vice versa): white balance units differ.
      if (m.kind !== p.kind) recipe.wb = defaultRecipe(p.kind, asShot).wb
      Object.assign(p, { recipe, edited: !isUnedited(recipe, p.kind, asShot), editedAt: m.editedAt || undefined })
      if (!p.editedAt) delete p.editedAt
      touched.set(p.id, p)
      thumbs.push(p.id)
    }
    for (const m of plan.infos) {
      const p = get(m.key)
      if (!p) continue
      const keywords = cleanKeywords(m.keywords)
      Object.assign(p, { rating: m.rating, flag: m.flag, albumIds: [...m.albumIds] })
      if (keywords.length) p.keywords = keywords
      else delete p.keywords
      touched.set(p.id, p)
      if (m.infoAt) await db.syncStamps.put({ id: photoStampId(p.id), at: m.infoAt })
      else await db.syncStamps.delete(photoStampId(p.id))
    }
    await db.photos.bulkPut([...touched.values()])
    updated = touched.size

    for (const m of plan.creates) {
      const blob = originals.get(m.key)
      if (!blob) continue
      const id = (await db.photos.get(m.id)) ? uid() : m.id
      const keywords = cleanKeywords(m.keywords)
      const rec: PhotoRecord = {
        id,
        fileName: m.fileName,
        kind: m.kind,
        mime: m.mime,
        fileSize: m.fileSize,
        addedAt: m.addedAt,
        takenAt: m.takenAt,
        width: m.width,
        height: m.height,
        meta: m.meta,
        ...(m.raw && { raw: m.raw }),
        rating: m.rating,
        flag: m.flag,
        albumIds: [...m.albumIds],
        recipe: m.recipe,
        edited: m.edited,
        ...(m.editedAt && { editedAt: m.editedAt }),
        thumbVersion: 0,
        ...(m.previewOnly && { previewOnly: true }),
        ...(keywords.length && { keywords }),
        ...(m.merged && { merged: m.merged }),
      }
      await db.photos.add(rec)
      await db.originals.put({ id, blob: new Blob([blob], { type: m.mime }) })
      if (m.infoAt) await db.syncStamps.put({ id: photoStampId(id), at: m.infoAt })
      byKey.set(m.key, rec)
      thumbs.push(id)
      created++
    }

    // AI results: stored under this device's id for the photo.
    for (const r of plan.rasters) {
      const data = rasterData.get(r.id)
      const owner = byKey.get(r.photoKey)
      if (!data || !owner) continue
      const { photoKey: _k, bytes: _b, data: _d, ...rest } = r
      await db.rasters.put({ ...rest, photoId: owner.id, data })
    }

    for (const p of plan.presetsAdd) await db.presets.put(p)
    for (const t of plan.tombstones) await db.tombstones.put({ id: `${t.kind}:${t.key}`, ...t })
    for (const key of plan.deletes) {
      const p = byKey.get(key)
      if (p) deleteIds.push(p.id)
    }
  })
  if (plan.exportPresets) {
    const list = plan.exportPresets
    await updateSettings({ exportPresets: list })
  }
  if (deleteIds.length) {
    await deletePhotos(deleteIds)
    await db.syncStamps.bulkDelete(deleteIds.map(photoStampId))
  }
  return { updated, created, deleted: deleteIds.length, elsewhere: plan.elsewhere, thumbs: [...new Set(thumbs)].filter((id) => !deleteIds.includes(id)) }
}
