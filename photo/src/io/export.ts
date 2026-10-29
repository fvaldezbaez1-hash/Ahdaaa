// Export: decode at the size the output needs → render on the GPU → encode
// in the IO worker → hand to the user. One photo at a time; per-file failures
// are collected, not fatal.
import { abortError, isAbort } from './abort'
import { db } from './db'
import { exportName, openSink } from './save'
import { seams } from './seams'
import type { ExportOptions, PhotoRecord } from './types'
import { decodeStored } from './working'

export interface ExportProgress {
  done: number
  total: number
  /** 0…1 within the current photo. */
  fraction: number
  current?: string
}

/**
 * Long edge to decode the source at so the rendered output can reach
 * `longEdge` after crop and straightening (undefined = full resolution).
 */
export function sourceEdgeFor(p: PhotoRecord, longEdge: number | undefined): number | undefined {
  if (!longEdge) return undefined
  const g = p.recipe.geometry
  const [w, h] = g.rotate % 2 ? [p.height, p.width] : [p.width, p.height]
  const cropLong = Math.max(g.crop.w * w, g.crop.h * h)
  // Straightening zooms in to keep the frame filled.
  const a = Math.abs((g.angle * Math.PI) / 180)
  const zoom = Math.cos(a) + (Math.max(w, h) / Math.min(w, h)) * Math.sin(a)
  const edge = Math.ceil((Math.max(w, h) * longEdge * zoom) / cropLong)
  return edge >= Math.max(w, h) ? undefined : edge
}

async function exportOne(p: PhotoRecord, opts: ExportOptions, onFraction: (f: number) => void, signal?: AbortSignal): Promise<Blob> {
  const d = await decodeStored(p, 'full', sourceEdgeFor(p, opts.longEdge), signal)
  onFraction(0.35)
  const r = await seams.render(p.recipe, d, {
    maxLongEdge: opts.longEdge,
    bitDepth: opts.format === 'tiff16' ? 16 : 8,
    colorSpace: opts.colorSpace,
    onProgress: (f) => onFraction(0.35 + 0.45 * f),
    signal,
  })
  onFraction(0.8)
  const exif = opts.keepMetadata ? { meta: p.meta, width: r.width, height: r.height, colorSpace: opts.colorSpace, includeGps: !opts.stripLocation } : undefined
  return seams.encode({ format: opts.format, rgba: r.data as Uint8ClampedArray<ArrayBuffer> | Uint16Array, width: r.width, height: r.height, quality: opts.quality, exif, colorSpace: opts.colorSpace }, signal)
}

export async function exportPhotos(ids: string[], opts: ExportOptions, onProgress?: (p: ExportProgress) => void, signal?: AbortSignal): Promise<{ saved: number; failed: { name: string; reason: string }[] }> {
  const photos = (await db.photos.bulkGet(ids)).filter((p): p is PhotoRecord => !!p)
  const names = new Set<string>()
  const planned = photos.map((p) => {
    const name = exportName(p.fileName, opts.format, (n) => names.has(n))
    names.add(name)
    return name
  })
  // Ask where to save first, while the click that started the export still counts as a user gesture.
  const sink = seams.sink ?? (await openSink(planned, opts.format))
  const failed: { name: string; reason: string }[] = []
  let saved = 0
  const total = photos.length
  for (let i = 0; i < total; i++) {
    if (signal?.aborted) throw abortError()
    const p = photos[i]
    const report = (fraction: number) => onProgress?.({ done: i, total, fraction, current: p.fileName })
    report(0)
    try {
      const blob = await exportOne(p, opts, report, signal)
      await sink.write({ name: planned[i], blob })
      saved++
    } catch (e) {
      if (isAbort(e) || signal?.aborted) throw abortError()
      failed.push({ name: p.fileName, reason: (e as Error).message || 'Export failed' })
    }
  }
  if (saved) await sink.finish()
  onProgress?.({ done: total, total, fraction: 1 })
  return { saved, failed }
}
