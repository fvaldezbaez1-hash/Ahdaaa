// Working-resolution images for the editor, decoded from the stored original
// and kept in a small LRU so reopening a recent photo is instant.
import { db } from './db'
import { workingLongEdge } from './platform'
import { seams } from './seams'
import type { DecodedPhoto, PhotoRecord } from './types'
import { work } from './worker'

const MAX_ENTRIES = 3

const cache = new Map<string, DecodedPhoto>() // insertion order = least recently used first
const inflight = new Map<string, Promise<DecodedPhoto>>()

const longEdge = (w: number, h: number) => Math.max(w, h)

/** The cached working image, if any (any size). */
export function cachedWorking(id: string): DecodedPhoto | undefined {
  return cache.get(id)
}

export function forgetWorking(ids: string[]): void {
  for (const id of ids) cache.delete(id)
}

/** Decode a library photo's stored original. */
export async function decodeStored(p: PhotoRecord, quality: 'preview' | 'full', maxLongEdge: number | undefined, signal?: AbortSignal): Promise<DecodedPhoto> {
  const original = await db.originals.get(p.id)
  if (!original) throw new Error('The original file is missing from this device. Import it again to keep editing.')
  return seams.decode(original.blob, { fileName: p.fileName, quality, maxLongEdge, fullSize: { width: p.width, height: p.height }, previewOnly: p.previewOnly, signal })
}

export async function loadWorking(id: string, maxLongEdge = workingLongEdge()): Promise<DecodedPhoto> {
  const hit = cache.get(id)
  if (hit) {
    const edge = longEdge(hit.image.width, hit.image.height)
    // A cached image serves any request it covers (or it already is full resolution).
    if (edge >= maxLongEdge || edge >= longEdge(hit.fullWidth, hit.fullHeight)) {
      cache.delete(id)
      cache.set(id, hit)
      if (edge <= maxLongEdge) return hit
      return { ...hit, image: await work('resample', { image: hit.image, maxLongEdge }) }
    }
  }
  const key = `${id}@${maxLongEdge}`
  let p = inflight.get(key)
  if (!p) {
    p = (async () => {
      const rec = await db.photos.get(id)
      if (!rec) throw new Error('This photo is no longer in the library.')
      const d = await decodeStored(rec, 'full', maxLongEdge)
      cache.delete(id)
      cache.set(id, d)
      while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!)
      return d
    })().finally(() => inflight.delete(key))
    inflight.set(key, p)
  }
  return p
}
