// Stored AI results the recipes refer to by id (see edit/types: an AI mask's
// `raster`, a removal's `fill`, AI denoise's `raster`). Kept losslessly
// compressed in the `rasters` table: a left-neighbour delta per row, 16-bit
// values split into high and low byte planes, then deflate. Deleting a photo
// deletes its rasters; edit backups leave them out (they can be recomputed).
//
// Kinds: 'mask' (1 channel, 8-bit, whole source), 'fill' (3 channels, 16-bit
// linear, source color space, covering RemoveArea.rect), 'denoise' (3 channels,
// 16-bit, the whole source denoised).
import type { EditRecipe } from '../edit/types'
import type { RasterImage } from '../engine/types'
import { db, uid } from './db'
import { deflate } from './encode/deflate'

export type RasterKind = 'mask' | 'fill' | 'denoise'

export interface RasterRecord {
  id: string
  photoId: string
  kind: RasterKind
  width: number
  height: number
  channels: 1 | 3
  depth: 8 | 16
  /** 'delta-deflate' (see above). */
  codec: 'delta-deflate'
  data: Uint8Array
  createdAt: number
}

/** Reversible per-row delta (left neighbour, same channel); 16-bit as high bytes then low bytes. */
export function packRaster(img: RasterImage): Uint8Array {
  const { width: w, height: h, channels: c, data } = img
  const row = w * c
  if (data instanceof Uint8Array) {
    const out = new Uint8Array(data.length)
    for (let y = 0; y < h; y++) {
      const o = y * row
      for (let i = 0; i < row; i++) out[o + i] = (data[o + i] - (i >= c ? data[o + i - c] : 0)) & 0xff
    }
    return out
  }
  const n = data.length
  const out = new Uint8Array(n * 2)
  for (let y = 0; y < h; y++) {
    const o = y * row
    for (let i = 0; i < row; i++) {
      const d = (data[o + i] - (i >= c ? data[o + i - c] : 0)) & 0xffff
      out[o + i] = d >> 8
      out[n + o + i] = d & 0xff
    }
  }
  return out
}

export function unpackRaster(bytes: Uint8Array, width: number, height: number, channels: 1 | 3, depth: 8 | 16): RasterImage {
  const row = width * channels
  const n = row * height
  if (depth === 8) {
    const data = new Uint8Array(n)
    for (let y = 0; y < height; y++) {
      const o = y * row
      for (let i = 0; i < row; i++) data[o + i] = (bytes[o + i] + (i >= channels ? data[o + i - channels] : 0)) & 0xff
    }
    return { width, height, channels, data }
  }
  const data = new Uint16Array(n)
  for (let y = 0; y < height; y++) {
    const o = y * row
    for (let i = 0; i < row; i++) data[o + i] = (((bytes[o + i] << 8) | bytes[n + o + i]) + (i >= channels ? data[o + i - channels] : 0)) & 0xffff
  }
  return { width, height, channels, data }
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Store an AI result for a photo; returns its id (what the recipe keeps). */
export async function putRaster(photoId: string, kind: RasterKind, img: RasterImage): Promise<string> {
  const depth = img.data instanceof Uint8Array ? 8 : 16
  if (img.data.length !== img.width * img.height * img.channels) throw new Error('Raster size does not match its data')
  const rec: RasterRecord = {
    id: uid(),
    photoId,
    kind,
    width: img.width,
    height: img.height,
    channels: img.channels,
    depth,
    codec: 'delta-deflate',
    data: await deflate(packRaster(img)),
    createdAt: Date.now(),
  }
  await db.rasters.add(rec)
  return rec.id
}

export async function getRaster(id: string): Promise<RasterImage | undefined> {
  if (!id) return undefined
  const r = await db.rasters.get(id)
  if (!r) return undefined
  return unpackRaster(await inflate(r.data), r.width, r.height, r.channels, r.depth)
}

export async function deleteRasters(ids: Iterable<string>): Promise<void> {
  await db.rasters.bulkDelete([...ids])
}

/** Delete this photo's rasters except those in `keep` (the editor passes ids its undo history can still bring back). */
export async function pruneRasters(photoId: string, keep: Iterable<string>): Promise<number> {
  const k = new Set(keep)
  const gone = (await db.rasters.where('photoId').equals(photoId).primaryKeys()).filter((id) => !k.has(id))
  await db.rasters.bulkDelete(gone)
  return gone.length
}

/** Raster ids a recipe refers to. */
export function recipeRasterIds(recipe: EditRecipe): Set<string> {
  const ids = new Set<string>()
  for (const l of recipe.layers) for (const m of l.masks) if (m.type === 'ai' && m.raster) ids.add(m.raster)
  for (const t of recipe.retouch) if (t.mode === 'remove' && t.fill) ids.add(t.fill)
  if (recipe.denoise?.raster) ids.add(recipe.denoise.raster)
  return ids
}

/** Total stored bytes of a photo's rasters (or all), for storage info. */
export async function rasterBytes(photoId?: string): Promise<number> {
  const rows = photoId ? await db.rasters.where('photoId').equals(photoId).toArray() : await db.rasters.toArray()
  return rows.reduce((n, r) => n + r.data.byteLength, 0)
}
