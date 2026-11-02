// HDR and panorama merges of library photos. The result is a linear DNG
// (src/io/dng.ts) imported next to its sources with `merged` set, so it
// develops, edits and exports like any RAW. Work happens in a worker; the
// main thread only decodes sources (one at a time) and imports the result.
// Load lazily: `await import('../merge')`.
import type { Mat3 } from '../color/matrices'
import { abortError } from '../io/abort'
import { db } from '../io/db'
import { importFiles, refreshThumbnail, saveRecipe } from '../io/library'
import { lowMemory } from '../io/platform'
import type { DecodedPhoto, PhotoRecord } from '../io/types'
import { decodeStored } from '../io/working'
import { MergeWorker } from './client'
import { exifExposure, type Deghost } from './hdr'
import type { HdrAnalysis } from './merge.worker'
import type { PanoPlan, Projection } from './pano'

export type { Deghost } from './hdr'
export type { Projection } from './pano'

export type MergeKind = 'hdr' | 'pano'

export interface MergeOptions {
  deghost: Deghost
  projection: Projection | 'auto'
  autoCrop: boolean
}

export const DEFAULT_MERGE_OPTIONS: MergeOptions = { deghost: 'low', projection: 'auto', autoCrop: true }

export interface RunOptions {
  onProgress?: (fraction: number, stage: string) => void
  signal?: AbortSignal
}

/** What a merge will make, with its preview, before the full-resolution run. */
export interface MergePlan {
  kind: MergeKind
  ids: string[]
  options: MergeOptions
  /** Tone-mapped sRGB preview (RGBA 8-bit). */
  preview: { data: Uint8ClampedArray; width: number; height: number }
  /** Size the merged photo will have. */
  output: { width: number; height: number }
  /** Things to tell the person (estimated exposures, capped size…). */
  notes: string[]
  /** HDR: dynamic range covered, in stops. Panorama: field of view in degrees and projection. */
  stops?: number
  span?: [number, number]
  projection?: Projection
  /** Internal: what the run needs. */
  detail: HdrDetail | PanoDetail
}

interface Common {
  analysis: { width: number; height: number }[]
  refShotMul: number[]
  camXyz: Mat3
  rgbCam: Mat3 | null
}
interface HdrDetail extends Common {
  kind: 'hdr'
  hdr: Omit<HdrAnalysis, 'preview'>
}
interface PanoDetail extends Common {
  kind: 'pano'
  plan: PanoPlan
  gains: number[]
  crop: { x: number; y: number; w: number; h: number } | null
  /** Output px per analysis px, and each source's decode size. */
  scale: number
  decodeEdge: number[]
}

const sameCamera = (a: PhotoRecord, b: PhotoRecord) => a.kind === b.kind && (a.meta.make ?? '') === (b.meta.make ?? '') && (a.meta.model ?? '') === (b.meta.model ?? '')

/** HDR when the photos look like a bracket (same camera, size and focal length, EXIF exposures differing); else panorama. */
export function suggestKind(photos: readonly PhotoRecord[]): MergeKind {
  if (photos.length < 2) return 'pano'
  const ex = photos.map((p) => exifExposure(p.meta))
  const sameSize = photos.every((p) => p.width === photos[0].width && p.height === photos[0].height)
  const sameFocal = photos.every((p) => (p.meta.focalLength ?? 0) === (photos[0].meta.focalLength ?? 0))
  // Brackets: exposures that differ (by EXIF; without it, the person picks HDR themselves).
  const varied = ex.every((e) => e) && Math.max(...(ex as number[])) / Math.min(...(ex as number[])) > 1.4
  return sameSize && sameFocal && varied && photos.every((p) => sameCamera(p, photos[0])) ? 'hdr' : 'pano'
}

/** Why these photos can't be merged this way (null = they can). */
export function cantMerge(photos: readonly PhotoRecord[], kind: MergeKind): string | null {
  if (photos.length < 2) return 'Choose at least two photos.'
  if (photos.some((p) => p.previewOnly)) return 'One of these RAW files only opens through its preview here, so it can’t be merged.'
  if (photos.some((p) => p.merged?.kind === 'hdr' && kind === 'hdr')) return 'One of these photos is already an HDR merge.'
  if (kind === 'hdr') {
    if (photos.length > 9) return 'HDR merges up to 9 brackets.'
    if (!photos.every((p) => sameCamera(p, photos[0]))) return 'HDR brackets must come from the same camera, all RAW or all JPEG.'
    if (!photos.every((p) => p.width === photos[0].width && p.height === photos[0].height)) return 'HDR brackets must be the same size and orientation.'
  } else {
    if (photos.length > 30) return 'Panoramas can combine up to 30 photos.'
    if (!photos.every((p) => p.kind === photos[0].kind)) return 'Use all RAW or all JPEG photos for a panorama.'
    if (photos[0].kind === 'raw' && !photos.every((p) => sameCamera(p, photos[0]))) return 'RAW panoramas need photos from the same camera.'
  }
  return null
}

const ANALYSIS_EDGE = { hdr: 1200, pano: 900 }
/** Most pixels a merged photo may have. */
export const maxMergePixels = (kind: MergeKind) => (lowMemory() ? (kind === 'hdr' ? 24e6 : 30e6) : kind === 'hdr' ? 100e6 : 120e6)
/** Memory for panorama sources held at once (16-bit RGB). */
const sourceBudget = () => (lowMemory() ? 250e6 : 1200e6)

const check = (signal?: AbortSignal) => {
  if (signal?.aborted) throw abortError()
}

/** White balance multipliers the decoded data carry (green = 1), and the colour matrices. */
function colorOf(d: DecodedPhoto): { shotMul: number[]; camXyz: Mat3; rgbCam: Mat3 | null } {
  if (d.color.space === 'camera' && d.color.camXyz && d.color.rgbCam) return { shotMul: d.color.shotMul ? [...d.color.shotMul] : [1, 1, 1], camXyz: d.color.camXyz, rgbCam: d.color.rgbCam }
  // Linear sRGB: XYZ (D65) → linear sRGB.
  return { shotMul: [1, 1, 1], camXyz: [3.2404542, -1.5371385, -0.4985314, -0.969266, 1.8760108, 0.041556, 0.0556434, -0.2040259, 1.0572252], rgbCam: null }
}

async function records(ids: readonly string[]): Promise<PhotoRecord[]> {
  const ps = await db.photos.bulkGet([...ids])
  if (ps.some((p) => !p)) throw new Error('A photo of this merge is no longer in the library.')
  return ps as PhotoRecord[]
}

/** Analyse the photos and make a quick preview (a few seconds). */
export async function planMerge(ids: readonly string[], kind: MergeKind, options: MergeOptions = DEFAULT_MERGE_OPTIONS, opts: RunOptions = {}): Promise<MergePlan> {
  const photos = await records(ids)
  const why = cantMerge(photos, kind)
  if (why) throw new Error(why)
  const worker = new MergeWorker()
  try {
    const small: DecodedPhoto[] = []
    for (let i = 0; i < photos.length; i++) {
      opts.onProgress?.((0.6 * i) / photos.length, 'Reading the photos…')
      small.push(await decodeStored(photos[i], 'full', ANALYSIS_EDGE[kind], opts.signal))
      check(opts.signal)
    }
    const c = colorOf(small[0])
    const notes: string[] = []
    const frames = small.map((d) => ({ data: d.image.data, width: d.image.width, height: d.image.height, color: d.color, shotMul: colorOf(d).shotMul, exposure: exifExposure(d.meta) }))
    const analysis = small.map((d) => ({ width: d.image.width, height: d.image.height }))
    opts.onProgress?.(0.65, kind === 'hdr' ? 'Aligning the brackets…' : 'Matching the photos…')
    if (kind === 'hdr') {
      const r = await worker.call('hdrAnalyze', { frames, deghost: options.deghost, rgbCam: c.rgbCam }, { signal: opts.signal, transfer: frames.map((f) => f.data.buffer) })
      notes.push(...r.notes)
      const ref = photos[r.ref]
      let { width, height } = ref
      const cap = maxMergePixels('hdr')
      if (width * height > cap) {
        const s = Math.sqrt(cap / (width * height))
        width = Math.round(width * s)
        height = Math.round(height * s)
        notes.push(`The merged photo is limited to ${Math.round(cap / 1e6)} MP on this device.`)
      }
      const { preview, ...hdr } = r
      return {
        kind,
        ids: [...ids],
        options,
        preview: { data: preview, width: r.width, height: r.height },
        output: { width, height },
        notes,
        stops: r.stops,
        detail: { kind: 'hdr', hdr, analysis, refShotMul: colorOf(small[r.ref]).shotMul, camXyz: c.camXyz, rgbCam: c.rgbCam },
      }
    }
    const r = await worker.call('panoAnalyze', { images: frames, projection: options.projection, autoCrop: options.autoCrop, rgbCam: c.rgbCam, refShotMul: c.shotMul }, { signal: opts.signal, transfer: frames.map((f) => f.data.buffer) })
    // Output: as sharp as the sources, within the pixel cap and the memory the sources take.
    const b = r.plan.bounds
    const area = (b.x1 - b.x0) * (b.y1 - b.y0) * (r.crop ? r.crop.w * r.crop.h : 1)
    const natural = photos.map((p, i) => Math.max(p.width, p.height) / Math.max(analysis[i].width, analysis[i].height))
    let scale = natural.slice().sort((x, y) => x - y)[Math.floor(natural.length / 2)]
    const cap = maxMergePixels('pano')
    if (area * scale * scale > cap) {
      scale = Math.sqrt(cap / area)
      notes.push(`The panorama is limited to ${Math.round(cap / 1e6)} MP on this device.`)
    }
    const srcPixels = photos.reduce((n, p, i) => n + p.width * p.height * Math.min(1, scale / natural[i]) ** 2, 0)
    if (srcPixels * 6 > sourceBudget()) {
      const s = Math.sqrt(sourceBudget() / (srcPixels * 6))
      scale *= s
      notes.push('The panorama is made smaller to fit this device’s memory.')
    }
    const decodeEdge = photos.map((p, i) => Math.round(Math.max(p.width, p.height) * Math.min(1, scale / natural[i])))
    return {
      kind,
      ids: [...ids],
      options,
      preview: { data: r.preview, width: r.width, height: r.height },
      output: { width: Math.round((b.x1 - b.x0) * scale * (r.crop?.w ?? 1)), height: Math.round((b.y1 - b.y0) * scale * (r.crop?.h ?? 1)) },
      notes,
      span: r.plan.span,
      projection: r.plan.projection,
      detail: { kind: 'pano', plan: r.plan, gains: r.gains, crop: r.crop, scale, decodeEdge, analysis, refShotMul: c.shotMul, camXyz: c.camXyz, rgbCam: c.rgbCam },
    }
  } finally {
    worker.close()
  }
}

function fileName(p: PhotoRecord, kind: MergeKind): string {
  const base = p.fileName.replace(/\.[^.]+$/, '')
  const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, '')
  return `${base}-${kind === 'hdr' ? 'HDR' : 'Pano'}-${stamp}.dng`
}

/** Make the merged photo at full resolution and add it to the library; returns its id. */
export async function runMerge(plan: MergePlan, opts: RunOptions = {}): Promise<string> {
  const photos = await records(plan.ids)
  const worker = new MergeWorker()
  const report = opts.onProgress
  try {
    const d = plan.detail
    const first = photos[d.kind === 'hdr' ? d.hdr.ref : 0]
    const camera = [first.meta.make, first.meta.model].filter(Boolean).join(' ')
    const meta = {
      ...first.meta,
      // A panorama's geometry is no longer the lens's: no lens profile should apply to it.
      ...(d.kind === 'pano' ? { lens: undefined, focalLength: undefined } : {}),
      // JPEG sources: LibRaw must not recognise the camera (it would swap our sRGB matrix for its raw one).
      ...(first.kind === 'display' ? { make: 'Lumen', model: d.kind === 'hdr' ? 'HDR merge' : 'Panorama' } : {}),
    }
    const uniqueCameraModel = `Lumen ${d.kind === 'hdr' ? 'HDR' : 'Panorama'}${camera ? ` (${camera})` : ''}`
    let result: { dng: Blob; baselineExposure: number; width: number; height: number }
    if (d.kind === 'hdr') {
      const h = d.hdr
      const darkest = h.k.indexOf(Math.min(...h.k))
      await worker.call('hdrBegin', plan.output)
      for (let i = 0; i < photos.length; i++) {
        report?.((0.7 * i) / photos.length, `Merging bracket ${i + 1} of ${photos.length}…`)
        const full = await decodeStored(photos[i], 'full', Math.max(plan.output.width, plan.output.height), opts.signal)
        check(opts.signal)
        if (full.image.width !== plan.output.width || full.image.height !== plan.output.height) throw new Error('The brackets don’t all have the same size.')
        const frame = { data: full.image.data, width: full.image.width, height: full.image.height, color: full.color }
        await worker.call(
          'hdrAdd',
          { frame, k: h.k[i], transform: h.transforms[i], shotMul: colorOf(full).shotMul, darkest: i === darkest, mask: i === h.ref ? null : { data: h.masks[i], width: h.width, height: h.height }, analysisScale: full.image.width / h.width },
          { signal: opts.signal, transfer: [frame.data.buffer] },
        )
      }
      result = await worker.call('hdrFinish', { refShotMul: d.refShotMul, camXyz: d.camXyz, rgbCam: d.rgbCam, meta, uniqueCameraModel }, { signal: opts.signal, progress: (f) => report?.(0.7 + 0.25 * f, 'Writing the HDR photo…') })
    } else {
      const sources = []
      for (let i = 0; i < photos.length; i++) {
        report?.((0.35 * i) / photos.length, `Reading photo ${i + 1} of ${photos.length}…`)
        const full = await decodeStored(photos[i], 'full', d.decodeEdge[i], opts.signal)
        check(opts.signal)
        sources.push({ data: full.image.data, width: full.image.width, height: full.image.height, color: full.color, shotMul: colorOf(full).shotMul, analysisWidth: d.analysis[i].width })
      }
      result = await worker.call(
        'panoRender',
        { plan: d.plan, gains: d.gains, crop: d.crop, scale: d.scale, sources, refShotMul: d.refShotMul, camXyz: d.camXyz, rgbCam: d.rgbCam, meta, uniqueCameraModel },
        { signal: opts.signal, transfer: sources.map((s) => s.data.buffer), progress: (f) => report?.(0.35 + 0.6 * f, 'Stitching…') },
      )
    }
    worker.close()
    report?.(0.96, 'Adding it to the library…')
    const r = await importFiles([new File([result.dng], fileName(first, plan.kind), { type: 'image/x-adobe-dng' })])
    const id = r.added[0]
    if (!id) throw new Error(r.skipped[0]?.reason ?? 'Couldn’t add the merged photo to the library.')
    const rec = (await db.photos.get(id))!
    // Open at the reference exposure's brightness. Lumen's RAW decode currently applies LibRaw's
    // BT.709 curve (see linearize.ts), so in its terms a stop of BaselineExposure is ≈ 0.45 stop.
    const ev = Math.max(-5, Math.min(5, Math.round(result.baselineExposure * 100) / 100))
    await db.photos.update(id, { merged: { kind: plan.kind, sources: [...plan.ids], at: Date.now() } })
    if (ev) await saveRecipe(id, { ...rec.recipe, basic: { ...rec.recipe.basic, exposure: ev } })
    await refreshThumbnail(id).catch(() => undefined)
    report?.(1, 'Done')
    return id
  } finally {
    worker.close()
  }
}
