// Export: decode at the size the output needs → render on the GPU → encode
// in the IO worker → hand to the user. One photo at a time; per-file failures
// are collected, not fatal.
import { ai } from '../editor/ai/core'
import type { RenderedImage } from '../engine/types'
import { abortError, isAbort } from './abort'
import { db } from './db'
import { EXTENSION, exportName, openSink } from './save'
import { seams } from './seams'
import type { DecodedPhoto, ExportOptions, PhotoRecord } from './types'
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

/** Cut a rendered image down to w × h (top-left), e.g. the pixel an odd long edge gains when upscaled ×2. */
export function cropRendered(r: RenderedImage, w: number, h: number): RenderedImage {
  if (w >= r.width && h >= r.height) return r
  const W = Math.min(w, r.width), H = Math.min(h, r.height)
  const data = r.data instanceof Uint16Array ? new Uint16Array(W * H * 4) : new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) data.set(r.data.subarray(y * r.width * 4, (y * r.width + W) * 4), y * W * 4)
  return { ...r, width: W, height: H, data }
}

async function exportOne(p: PhotoRecord, opts: ExportOptions, onFraction: (f: number) => void, signal?: AbortSignal): Promise<Blob> {
  const up = opts.upscale === 2
  // AI upscaling doubles the render, so render at half the requested size.
  const edge = up ? (opts.longEdge ? Math.ceil(opts.longEdge / 2) : undefined) : opts.longEdge
  let d: DecodedPhoto | null = await decodeStored(p, 'full', sourceEdgeFor(p, edge), signal)
  onFraction(0.35)
  const span = up ? 0.2 : 0.45
  const rendering = seams.render(p.recipe, d, {
    maxLongEdge: edge,
    bitDepth: opts.format === 'tiff16' ? 16 : 8,
    colorSpace: opts.colorSpace,
    onProgress: (f) => onFraction(0.35 + span * f),
    signal,
  })
  d = null // let the source (up to ~300 MB) go before encoding allocates
  let r = await rendering
  if (up) {
    r = await (await ai()).upscale(r, { onProgress: (f) => onFraction(0.55 + 0.25 * f), signal })
    const long = Math.max(r.width, r.height)
    if (opts.longEdge && long > opts.longEdge) {
      const k = opts.longEdge / long
      r = cropRendered(r, r.width >= r.height ? opts.longEdge : Math.round(r.width * k), r.height > r.width ? opts.longEdge : Math.round(r.height * k))
    }
  }
  onFraction(0.8)
  const exif = opts.keepMetadata ? { meta: p.meta, width: r.width, height: r.height, colorSpace: opts.colorSpace, includeGps: !opts.stripLocation } : undefined
  const keywords = opts.includeKeywords !== false && p.keywords?.length ? p.keywords : undefined
  return seams.encode({ format: opts.format, rgba: r.data as Uint8ClampedArray<ArrayBuffer> | Uint16Array, width: r.width, height: r.height, quality: opts.quality, exif, colorSpace: opts.colorSpace, keywords }, signal)
}

/** Phase 5: one set of export settings in a multi-preset export ("Web JPEG" + "Full TIFF"). */
export interface ExportVariant {
  opts: ExportOptions
  /** File name without extension for each photo (index in the export); default "<name>-lumen". */
  name?: (p: PhotoRecord, index: number) => string
  /** Shown with a failure when several variants run. */
  label?: string
}

export async function exportPhotos(ids: string[], opts: ExportOptions, onProgress?: (p: ExportProgress) => void, signal?: AbortSignal, name?: ExportVariant['name']): Promise<{ saved: number; failed: { name: string; reason: string }[] }> {
  return exportVariants(ids, [{ opts, name }], onProgress, signal)
}

/** Export every photo once per variant, into one place (one folder pick / one share). */
export async function exportVariants(ids: string[], variants: ExportVariant[], onProgress?: (p: ExportProgress) => void, signal?: AbortSignal): Promise<{ saved: number; failed: { name: string; reason: string }[] }> {
  const photos = (await db.photos.bulkGet(ids)).filter((p): p is PhotoRecord => !!p)
  const names = new Set<string>()
  const taken = (n: string) => names.has(n.toLowerCase())
  const jobs = variants.flatMap((v) =>
    photos.map((p, i) => {
      let file: string
      if (v.name) {
        const stem = v.name(p, i)
        for (let n = 1; ; n++) if (!taken((file = `${stem}${n > 1 ? `-${n}` : ''}${EXTENSION[v.opts.format]}`))) break
      } else file = exportName(p.fileName, v.opts.format, taken)
      names.add(file.toLowerCase())
      return { p, v, file }
    }),
  )
  // Ask where to save first, while the click that started the export still counts as a user gesture.
  const sink = seams.sink ?? (await openSink(jobs.map((j) => j.file), variants[0].opts.format))
  const failed: { name: string; reason: string }[] = []
  let saved = 0
  const total = jobs.length
  for (let i = 0; i < total; i++) {
    if (signal?.aborted) throw abortError()
    const { p, v, file } = jobs[i]
    const report = (fraction: number) => onProgress?.({ done: i, total, fraction, current: variants.length > 1 && v.label ? `${p.fileName} · ${v.label}` : p.fileName })
    report(0)
    try {
      const blob = await exportOne(p, v.opts, report, signal)
      await sink.write({ name: file, blob })
      saved++
    } catch (e) {
      if (isAbort(e) || signal?.aborted) throw abortError()
      failed.push({ name: p.fileName, reason: `${variants.length > 1 && v.label ? `${v.label}: ` : ''}${(e as Error).message || 'Export failed'}` })
    }
  }
  if (saved) await sink.finish()
  onProgress?.({ done: total, total, fraction: 1 })
  return { saved, failed }
}
