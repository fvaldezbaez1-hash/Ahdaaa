import { Dexie, type EntityTable } from 'dexie'
import type { RasterRecord } from './rasters'
import type { AlbumRecord, KV, OriginalRecord, PhotoRecord, ThumbRecord, UserPresetRecord } from './types'

// Everything lives in IndexedDB on the device. Originals are stored once and
// never modified; photos hold metadata + the edit recipe; thumbs are separate
// so listing thousands of photos stays light.
export class LumenDB extends Dexie {
  photos!: EntityTable<PhotoRecord, 'id'>
  originals!: EntityTable<OriginalRecord, 'id'>
  thumbs!: EntityTable<ThumbRecord, 'id'>
  albums!: EntityTable<AlbumRecord, 'id'>
  presets!: EntityTable<UserPresetRecord, 'id'>
  kv!: EntityTable<KV, 'key'>
  /** Phase 3: stored AI results (masks, removal fills, denoised sources), see rasters.ts. */
  rasters!: EntityTable<RasterRecord, 'id'>
  /** Phase 5: sync bookkeeping (see src/sync). */
  syncStamps!: EntityTable<SyncStamp, 'id'>
  tombstones!: EntityTable<Tombstone, 'id'>

  constructor(name = 'lumen') {
    super(name)
    this.version(1).stores({
      photos: 'id, addedAt, takenAt, rating, flag, edited, *albumIds, fileName',
      originals: 'id',
      thumbs: 'id',
      albums: 'id, createdAt',
      presets: 'id, createdAt, source, collection',
      kv: 'key',
    })
    // Phase 3: AI results. A new table only; existing data is untouched.
    this.version(2).stores({ rasters: 'id, photoId' })
    // Phase 5: a multi-entry index on keywords (photos without any just aren't in it, so no
    // data changes), and two small tables for sync: when ratings / flags / keywords / albums
    // last changed, and what was deleted (so other devices delete it too, not bring it back).
    this.version(3).stores({
      photos: 'id, addedAt, takenAt, rating, flag, edited, *albumIds, fileName, *keywords',
      syncStamps: 'id',
      tombstones: 'id, at',
    })
  }
}

/** Phase 5: when a photo's info (`p:<id>`) or an album (`a:<id>`) last changed, ms. */
export interface SyncStamp {
  id: string
  at: number
}

/** Phase 5: something deleted on this device; `key` is a photo's identity key or an album / preset id. */
export interface Tombstone {
  /** `${kind}:${key}` */
  id: string
  kind: 'photo' | 'album' | 'exportPreset'
  key: string
  at: number
}

export const db = new LumenDB()

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return (await db.kv.get(key))?.value as T | undefined
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await db.kv.put({ key, value })
}

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
