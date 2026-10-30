// Library bookkeeping: import, recipe saves, thumbnails, deletion.
import { defaultRecipe, isUnedited } from '../edit/defaults'
import type { EditRecipe, Preset } from '../edit/types'
import { applyPreset, findBuiltin } from '../presets/catalog'
import { isAbort } from './abort'
import { db, uid } from './db'
import { dropUndefined } from './decode/exif'
import { isSupportedFile, mimeOf } from './formats'
import { seams } from './seams'
import type { PhotoRecord } from './types'
import { cachedWorking, decodeStored, forgetWorking } from './working'

/** Long edge of the preview decoded at import (thumbnail source; also what the editor could show first). */
const IMPORT_PREVIEW_EDGE = 2560
/** Enough source for a 512 px thumbnail, with headroom for crops. */
const THUMB_SOURCE_EDGE = 1024

export interface ImportProgress {
  done: number
  total: number
  current?: string
}

export interface ImportResult {
  added: string[]
  skipped: { name: string; reason: string }[]
  /** Imported, but with something to tell the user (e.g. RAW opened from its embedded preview). */
  notices: { name: string; message: string }[]
}

export interface ImportOptions {
  onProgress?: (p: ImportProgress) => void
  presetId?: string
  albumId?: string
  /** Stops after the current file; resolves with what was imported so far. */
  signal?: AbortSignal
}

const isQuotaError = (e: unknown) => {
  const x = e as { name?: string; inner?: { name?: string } } | null
  return x?.name === 'QuotaExceededError' || x?.inner?.name === 'QuotaExceededError'
}

let persistAsked = false
/** Ask once for durable storage so the browser doesn't evict the library under pressure. */
function requestPersistence() {
  if (persistAsked || typeof navigator === 'undefined' || !navigator.storage?.persist) return
  persistAsked = true
  navigator.storage.persisted().then((p) => p || navigator.storage.persist()).catch(() => undefined)
}

export async function importFiles(files: File[], opts: ImportOptions = {}): Promise<ImportResult> {
  const result: ImportResult = { added: [], skipped: [], notices: [] }
  const total = files.length
  requestPersistence()
  let preset: Preset | undefined
  if (opts.presetId) preset = findBuiltin(opts.presetId) ?? (await db.presets.get(opts.presetId))

  for (let i = 0; i < total; i++) {
    const file = files[i]
    if (opts.signal?.aborted) break
    opts.onProgress?.({ done: i, total, current: file.name })
    if (!isSupportedFile(file.name)) {
      result.skipped.push({ name: file.name, reason: "This file type isn't supported" })
      continue
    }
    try {
      // One file at a time; `d` (tens of MB) is dropped at the end of the iteration.
      const d = await seams.decode(file, { fileName: file.name, quality: 'preview', maxLongEdge: IMPORT_PREVIEW_EDGE, signal: opts.signal })
      const takenAt = d.meta.takenAt ?? file.lastModified
      const dup = await db.photos.where('fileName').equals(file.name).filter((p) => p.fileSize === file.size && p.takenAt === takenAt).first()
      if (dup) {
        result.skipped.push({ name: file.name, reason: 'Already in your library' })
        continue
      }
      const asShot = d.raw?.asShot
      let recipe = defaultRecipe(d.kind, asShot)
      if (preset) recipe = applyPreset(recipe, preset, 100, 'original', d.kind)
      const thumb = await seams.thumbnail(d, recipe)
      const now = Date.now()
      const rec: PhotoRecord = dropUndefined({
        id: uid(),
        fileName: file.name,
        kind: d.kind,
        mime: mimeOf(file),
        fileSize: file.size,
        addedAt: now,
        takenAt,
        width: d.fullWidth,
        height: d.fullHeight,
        meta: d.meta,
        raw: d.raw,
        rating: 0,
        flag: 0,
        albumIds: opts.albumId ? [opts.albumId] : [],
        recipe,
        edited: !isUnedited(recipe, d.kind, asShot),
        editedAt: undefined,
        thumbVersion: 1,
        previewOnly: d.previewOnly || undefined,
      })
      await db.transaction('rw', [db.photos, db.originals, db.thumbs, db.albums], async () => {
        await db.photos.add(rec)
        // A Blob, not the File: some browsers keep File handles tied to the picker.
        await db.originals.add({ id: rec.id, blob: new Blob([file], { type: rec.mime }) })
        await db.thumbs.add({ id: rec.id, ...thumb })
        if (opts.albumId) {
          const album = await db.albums.get(opts.albumId)
          if (album && !album.coverId) await db.albums.update(album.id, { coverId: rec.id })
        }
      })
      result.added.push(rec.id)
      if (d.notice) result.notices.push({ name: file.name, message: d.notice })
    } catch (e) {
      if (isAbort(e)) break
      if (isQuotaError(e)) {
        for (const f of files.slice(i)) result.skipped.push({ name: f.name, reason: 'Not enough storage space on this device' })
        break
      }
      result.skipped.push({ name: file.name, reason: (e as Error).message || "Couldn't import this file" })
    }
  }
  opts.onProgress?.({ done: total, total })
  return result
}

export async function saveRecipe(id: string, recipe: EditRecipe): Promise<void> {
  await db.transaction('rw', db.photos, async () => {
    const p = await db.photos.get(id)
    if (!p) return
    await db.photos.update(id, { recipe, edited: !isUnedited(recipe, p.kind, p.raw?.asShot), editedAt: Date.now() })
  })
}

async function renderThumb(id: string): Promise<void> {
  const p = await db.photos.get(id)
  if (!p) return
  const d = cachedWorking(id) ?? (await decodeStored(p, 'preview', THUMB_SOURCE_EDGE))
  const thumb = await seams.thumbnail(d, p.recipe)
  await db.transaction('rw', db.photos, db.thumbs, async () => {
    const cur = await db.photos.get(id)
    if (!cur) return // deleted meanwhile
    await db.thumbs.put({ id, ...thumb })
    await db.photos.update(id, { thumbVersion: cur.thumbVersion + 1 })
  })
}

const refreshing = new Map<string, { again: boolean; done: Promise<void> }>()

/** Re-render a thumbnail from the current recipe. Calls during a render coalesce into one more pass. */
export function refreshThumbnail(id: string): Promise<void> {
  const running = refreshing.get(id)
  if (running) {
    running.again = true
    return running.done
  }
  const entry = { again: false, done: Promise.resolve() }
  entry.done = (async () => {
    try {
      do {
        entry.again = false
        await renderThumb(id)
      } while (entry.again)
    } finally {
      refreshing.delete(id)
    }
  })()
  refreshing.set(id, entry)
  return entry.done
}

/** Refresh many thumbnails one by one (e.g. after restoring edits). Failures are skipped. */
export async function refreshThumbnails(ids: string[], onProgress?: (done: number, total: number) => void, signal?: AbortSignal): Promise<void> {
  for (let i = 0; i < ids.length && !signal?.aborted; i++) {
    onProgress?.(i, ids.length)
    await refreshThumbnail(ids[i]).catch(() => undefined)
  }
  onProgress?.(ids.length, ids.length)
}

export async function deletePhotos(ids: string[]): Promise<void> {
  if (!ids.length) return
  const gone = new Set(ids)
  await db.transaction('rw', [db.photos, db.originals, db.thumbs, db.albums], async () => {
    await db.photos.bulkDelete(ids)
    await db.originals.bulkDelete(ids)
    await db.thumbs.bulkDelete(ids)
    for (const a of await db.albums.filter((a) => !!a.coverId && gone.has(a.coverId)).toArray()) {
      const next = await db.photos.where('albumIds').equals(a.id).first()
      await db.albums.update(a.id, { coverId: next?.id })
    }
  })
  forgetWorking(ids)
}
