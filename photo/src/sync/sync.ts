// Running a sync: with the sync folder (desktop browsers that can use a
// folder), or by moving a sync file by hand (phones, Safari, Firefox: share it
// to the cloud drive / AirDrop, then import it on the other device). Both
// merge the same way (catalog.ts). Nothing is sent anywhere else.
import { useSyncExternalStore } from 'react'
import type { EditsBackup } from '../io/backup'
import { db, kvGet, kvSet } from '../io/db'
import { queueThumbnails } from '../library/actions'
import { cleanKeywords } from '../library/keywords'
import { emptyCatalog, mergeCatalogs, parseCatalog, planApply, planIsEmpty, type Catalog, type SyncPhoto } from './catalog'
import { devicePath, folderPermission, handleFolder, originalPath, rasterFromFolder, rasterPath, readCatalogs, type SyncFolder } from './folder'
import { applyPlan, localCatalog, thisDevice, type ApplyResult } from './local'
import { photoKey } from './stamps'

// ---------- Settings and status ----------

export interface SyncConfig {
  /** Also copy the originals into the folder, so other devices get the photos themselves. */
  includeOriginals: boolean
  lastSync?: number
  lastResult?: string
}

const CONFIG = 'sync.config'
const FOLDER = 'sync.folder'

export const loadConfig = async (): Promise<SyncConfig> => ({ includeOriginals: false, ...(await kvGet<SyncConfig>(CONFIG)) })
export const saveConfig = async (patch: Partial<SyncConfig>) => kvSet(CONFIG, { ...(await loadConfig()), ...patch })
export const savedFolder = () => kvGet<FileSystemDirectoryHandle>(FOLDER).catch(() => undefined)
export const saveFolder = (h: FileSystemDirectoryHandle | null) => (h ? kvSet(FOLDER, h) : db.kv.delete(FOLDER))

export interface SyncStatus {
  state: 'idle' | 'running' | 'done' | 'error' | 'needsPermission'
  step?: string
  message?: string
  at?: number
}

let status: SyncStatus = { state: 'idle' }
const listeners = new Set<() => void>()
const setStatus = (s: SyncStatus) => {
  status = s
  listeners.forEach((l) => l())
}
export const useSyncStatus = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => status,
  )

export function describe(r: ApplyResult & { unreadable?: number }, devices: number): string {
  const parts: string[] = []
  if (r.updated) parts.push(`${r.updated} updated`)
  if (r.created) parts.push(`${r.created} added`)
  if (r.deleted) parts.push(`${r.deleted} deleted`)
  if (r.elsewhere) parts.push(`${r.elsewhere} only on other devices`)
  if (r.unreadable) parts.push(`${r.unreadable} unreadable file${r.unreadable === 1 ? '' : 's'} skipped`)
  const what = parts.length ? parts.join(' · ') : 'everything was already in step'
  return devices ? `${devices} other device${devices === 1 ? '' : 's'}: ${what}` : `No other devices yet · ${what}`
}

// ---------- Folder sync ----------

let running: Promise<void> | null = null

/** Merge the other devices' catalogs from the folder into this library, then write ours (and the files others need). */
export async function syncFolder(folder: SyncFolder, opts: { includeOriginals: boolean; onStep?: (s: string) => void }): Promise<{ result: ApplyResult; devices: number; unreadable: number }> {
  const step = opts.onStep ?? (() => undefined)
  const device = await thisDevice()
  step('Reading other devices…')
  const { catalogs, unreadable } = await readCatalogs(folder, device.id, parseCatalog)
  const original = opts.includeOriginals ? (p: { id: string; fileName: string }) => originalPath(p) : undefined
  const local = await localCatalog(device, original)
  const merged = mergeCatalogs(local, catalogs)
  const plan = planApply(local, merged)
  step('Updating this library…')
  const result = planIsEmpty(plan)
    ? { updated: 0, created: 0, deleted: 0, elsewhere: plan.elsewhere, thumbs: [] }
    : await applyPlan(plan, {
        raster: rasterFromFolder(folder),
        original: async (p: SyncPhoto) => (p.original ? folder.read(p.original) : null),
      })
  if (result.thumbs.length) queueThumbnails(result.thumbs)

  // What other devices need from us: AI results, and the originals if asked.
  step('Writing to the folder…')
  const rasters = await db.rasters.toArray()
  const wanted = new Set(merged.rasters.map((r) => r.id))
  for (const r of rasters) if (wanted.has(r.id) && !(await folder.exists(rasterPath(r.id)))) await folder.write(rasterPath(r.id), r.data as Uint8Array<ArrayBuffer>)
  if (opts.includeOriginals) {
    const photos = await db.photos.toArray()
    let i = 0
    for (const p of photos) {
      i++
      const path = originalPath(p)
      if (await folder.exists(path)) continue
      step(`Copying originals… ${i} of ${photos.length}`)
      const o = await db.originals.get(p.id)
      if (o) await folder.write(path, o.blob)
    }
  }
  const after = await localCatalog(device, original)
  // Ours, plus what only other devices have (so it lives on even if their files go).
  const keys = new Set(after.photos.map((p) => p.key))
  after.photos.push(...merged.photos.filter((p) => !keys.has(p.key)))
  const albumIds = new Set(after.albums.map((a) => a.id))
  after.albums.push(...merged.albums.filter((a) => !albumIds.has(a.id)))
  const rasterIds = new Set(after.rasters.map((r) => r.id))
  after.rasters.push(...merged.rasters.filter((r) => !rasterIds.has(r.id)))
  await folder.write(devicePath(device.id), JSON.stringify(after))
  return { result, devices: catalogs.length, unreadable }
}

/**
 * Sync with the saved folder. `ask` (from a click) may prompt for permission again;
 * without it, a folder that needs permission just reports so (e.g. on open).
 */
export function syncNow(ask: boolean): Promise<void> {
  if (running) return running
  running = (async () => {
    const handle = await savedFolder()
    if (!handle) return
    const perm = await folderPermission(handle, ask)
    if (perm !== 'granted') {
      setStatus({ state: 'needsPermission', message: `Lumen needs your OK to use “${handle.name}” again.` })
      return
    }
    const cfg = await loadConfig()
    setStatus({ state: 'running', step: 'Starting…' })
    try {
      const { result, devices, unreadable } = await syncFolder(handleFolder(handle), { includeOriginals: cfg.includeOriginals, onStep: (step) => setStatus({ state: 'running', step }) })
      const message = describe({ ...result, unreadable }, devices)
      const at = Date.now()
      await saveConfig({ lastSync: at, lastResult: message })
      setStatus({ state: 'done', message, at })
    } catch (e) {
      setStatus({ state: 'error', message: (e as Error).message || 'Sync failed' })
    }
  })().finally(() => {
    running = null
  })
  return running
}

let openedOnce = false
/** On opening the app: sync quietly if a folder is set up and still allowed. */
export function syncOnOpen() {
  if (openedOnce) return
  openedOnce = true
  void savedFolder().then((h) => h && syncNow(false))
}

// ---------- Sync file ----------

const toBase64 = (bytes: Uint8Array) => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

/** This library as a sync file: the catalog with the AI results inline (no originals). */
export async function exportSyncFile(): Promise<string> {
  const device = await thisDevice()
  const c = await localCatalog(device)
  const data = new Map((await db.rasters.bulkGet(c.rasters.map((r) => r.id))).filter((r) => !!r).map((r) => [r!.id, r!.data]))
  c.rasters = c.rasters.map((r) => ({ ...r, ...(data.has(r.id) && { data: toBase64(data.get(r.id)!) }) }))
  return JSON.stringify(c)
}

/** An edits backup (Settings → Back up edits) read as a catalog, so it merges like a sync file. */
export function backupAsCatalog(b: EditsBackup): Catalog {
  const c = emptyCatalog('backup', 'Edits backup', b.exportedAt)
  c.photos = b.photos.map((p) => ({
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
    meta: p.meta ?? {},
    recipe: p.recipe,
    edited: p.edited,
    editedAt: p.editedAt ?? 0,
    rating: p.rating ?? 0,
    flag: p.flag ?? 0,
    keywords: cleanKeywords(p.keywords),
    albumIds: p.albumIds ?? [],
    // A backup doesn't say when ratings changed: they count as of the backup.
    infoAt: p.rating || p.flag || p.albumIds?.length || p.keywords?.length ? b.exportedAt : 0,
  }))
  c.albums = b.albums.map((a) => ({ id: a.id, name: a.name, createdAt: a.createdAt, at: a.createdAt }))
  c.presets = b.presets
  return c
}

export function parseSyncFile(text: string): Catalog {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error("This file isn't a Lumen sync file.")
  }
  const j = json as { app?: string; type?: string; version?: number }
  if (j?.app === 'lumen' && j.type === 'edits' && j.version === 1) return backupAsCatalog(json as EditsBackup)
  return parseCatalog(json)
}

/** Merge a sync file (or an edits backup) into this library. */
export async function importSyncFile(text: string): Promise<string> {
  const remote = parseSyncFile(text)
  const device = await thisDevice()
  if (remote.device === device.id) return 'This sync file came from this device: nothing to merge.'
  const local = await localCatalog(device)
  const merged = mergeCatalogs(local, [remote])
  const plan = planApply(local, merged)
  const inline = new Map(remote.rasters.filter((r) => r.data).map((r) => [r.id, r.data!]))
  const result = planIsEmpty(plan)
    ? { updated: 0, created: 0, deleted: 0, elsewhere: plan.elsewhere, thumbs: [] }
    : await applyPlan(plan, { raster: async (r) => (inline.has(r.id) ? fromBase64(inline.get(r.id)!) : null) })
  if (result.thumbs.length) queueThumbnails(result.thumbs)
  const message = describe(result, 1).replace(/^1 other device: /, '')
  await saveConfig({ lastSync: Date.now(), lastResult: `Sync file from ${remote.deviceName || 'another device'}: ${message}` })
  return message
}
