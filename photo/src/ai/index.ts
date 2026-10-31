// Lumen's on-device AI: masks (subject, sky, background, people and their
// parts, click-to-select), object removal, noise reduction and 2× upscaling.
// Everything runs in this browser; photos never leave the device. The models
// are downloaded from Lumen's own site, only when downloadModel() is called;
// a run whose model isn't on the device throws ModelNotDownloadedError.
//
// Import this module lazily (`await import('../ai')`): it pulls in the AI
// worker, ONNX Runtime Web and MediaPipe only when used.
import type { AiTarget, BrushStroke, PersonPart, Rect } from '../edit/types'
import type { RasterImage, RenderedImage, SourceColor, SourceImage } from '../engine/types'
import { AreaResampler, resampleRgb16 } from '../io/decode/resample'
import { lowMemory } from '../io/platform'
import { call } from './client'
import { autoGain } from './color'
import { abortError, AiUnavailableError, ModelNotDownloadedError, throwIfAborted } from './errors'
import { planInpaint, rectInModel } from './inpaintPlan'
import * as store from './models'
import { morph, rasterizeStrokes, resize } from './pixels'
import { modelEntry, type ModelEntry } from './registry'
import { downloadRuntimeAsset, hasRuntimeAsset, RUNTIME_ASSETS, runtimeAssetsFor } from './runtimeAssets'
import { BandAssembler, cropInterleaved, scaleTile, tileGrid } from './tiling'

export { AiUnavailableError, ModelNotDownloadedError } from './errors'
export { MODELS } from './registry'
export type { ModelEntry } from './registry'
export { putRaster, getRaster, deleteRasters, pruneRasters } from '../io/rasters'
export type { RasterKind } from '../io/rasters'

/** Task names as the editor uses them. */
export type AiTaskName = 'segment' | 'object' | 'inpaint' | 'denoise' | 'upscale'

export interface AiModelInfo {
  id: string
  name: string
  /** Download size still needed (model files plus, the first time, the AI runtime). */
  bytes: number
  downloaded: boolean
  licence: string
  task: string
  tier: 'fast' | 'quality'
}

export interface AiSupport {
  available: boolean
  reason?: string
  backend?: 'webgpu' | 'wasm'
  /** Rough seconds per megapixel of the photo (denoise, upscale: of the input). Estimates. */
  secondsPerMp?: Partial<Record<AiTaskName, number>>
  /** Rough seconds per run for tasks whose cost doesn't grow with the photo (segment, object, inpaint). */
  secondsPerRun?: Partial<Record<AiTaskName, number>>
  /** Per segmentation target (they use different models). */
  segmentSeconds?: Partial<Record<AiTarget, number>>
  /** Phones: heavy jobs (denoise, upscale) take minutes and are limited in size. */
  lowMemory: boolean
}

export interface RunOptions {
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
  /** Use this model instead of the device default (an id from MODELS with the right task). */
  model?: string
}

export interface RunInfo {
  model: string
  backend: 'webgpu' | 'wasm'
  ms: number
  /** Select object: time spent on the photo's features (once per photo) and on the click. */
  encodeMs?: number
  decodeMs?: number
}

let last: RunInfo | null = null
/** Which model and backend the last run used, and how long it took. */
export const lastRun = (): RunInfo | null => last

// ---------- device ----------

let gpu: Promise<boolean> | null = null
function hasWebGpu(): Promise<boolean> {
  gpu ??= (async () => {
    try {
      const g = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
      return !!(g && (await g.requestAdapter()))
    } catch {
      return false
    }
  })()
  return gpu
}

export async function aiSupport(): Promise<AiSupport> {
  const low = lowMemory()
  if (typeof WebAssembly === 'undefined' || typeof Worker === 'undefined')
    return { available: false, reason: 'This browser can’t run on-device AI (it needs WebAssembly and workers).', lowMemory: low }
  const webgpu = await hasWebGpu()
  // Measured with WASM (one thread) on a desktop CPU in headless Chromium (scripts/ai/check.mjs).
  // Phones: ≈ 2.5× slower (estimate). WebGPU: estimated ≈ 15× faster for the big convolutional
  // models (subject, depth, removal, denoise, upscale); MediaPipe always runs on the CPU.
  const cpu = low ? 2.5 : 1
  const gpu = webgpu ? 1 / 15 : 1
  const subject = low ? 2.5 : 18 // U²-Netp on phones, IS-Net elsewhere
  const segment: Partial<Record<AiTarget, number>> = {
    subject: subject * cpu * gpu + 0.5,
    background: subject * cpu * gpu + 0.5,
    sky: 7.5 * cpu * gpu + 0.5,
    person: 1.5 * cpu + 0.3,
    object: 0.6 * cpu + 0.2,
  }
  return {
    available: true,
    backend: webgpu ? 'webgpu' : 'wasm',
    lowMemory: low,
    secondsPerMp: { denoise: 390 * cpu * gpu, upscale: 270 * cpu * gpu },
    secondsPerRun: { segment: segment.subject, object: segment.object, inpaint: 3.5 * cpu * gpu + 0.5 },
    segmentSeconds: segment,
  }
}

// ---------- models ----------

const DEFAULTS: Record<string, string> = {
  person: 'mp-selfie-multiclass',
  sky: 'depth-anything-v2-small',
  object: 'mp-magic-touch',
  inpaint: 'migan-512',
  denoise: 'scunet-real',
  upscale: 'realesr-general-x4v3',
}

/** The model a task runs on this device. Subject/background: the detailed IS-Net off phones, U²-Netp on them. */
export function defaultModel(task: AiTaskName, target?: AiTarget): ModelEntry {
  let id: string
  if (task === 'segment') id = target === 'subject' || target === 'background' || !target ? (lowMemory() ? 'u2netp' : 'isnet-general') : DEFAULTS[target]
  else id = DEFAULTS[task]
  return modelEntry(id)!
}

function chosen(task: AiTaskName, target: AiTarget | undefined, override?: string): ModelEntry {
  const m = override ? modelEntry(override) : defaultModel(task, target)
  if (!m) throw new Error(`Unknown AI model ${override}`)
  return m
}

async function missingRuntime(m: ModelEntry): Promise<(keyof typeof RUNTIME_ASSETS)[]> {
  if (typeof caches === 'undefined') return [] // nowhere to keep it: the browser's HTTP cache does
  const ids = runtimeAssetsFor(m.runtime, m.runtime === 'onnx' && (await hasWebGpu()))
  const out: (keyof typeof RUNTIME_ASSETS)[] = []
  for (const id of ids) if (!(await hasRuntimeAsset(id))) out.push(id)
  return out
}

async function infoFor(m: ModelEntry): Promise<AiModelInfo> {
  const base = await store.modelInfo(m.id)
  const runtime = await missingRuntime(m)
  const extra = runtime.reduce((n, id) => n + RUNTIME_ASSETS[id].bytes, 0)
  return { id: m.id, name: m.name, bytes: (base.downloaded ? 0 : base.bytes) + extra, downloaded: base.downloaded && !runtime.length, licence: m.licence, task: m.task, tier: m.tier }
}

/** The model `task` (and segmentation `target`) runs here, and whether it's on this device yet. */
export async function modelFor(task: AiTaskName, target?: AiTarget, override?: string): Promise<AiModelInfo> {
  return infoFor(chosen(task, target, override))
}

/** Every model (Settings → AI models). `bytes` is the model's own size there. */
export async function listModels(): Promise<(AiModelInfo & { upstream: string; phones: boolean })[]> {
  const all = await store.listModels()
  return all.map((m) => ({ id: m.id, name: m.name, bytes: m.bytes, downloaded: m.downloaded, licence: m.licence, task: m.task, tier: m.tier, upstream: m.upstream, phones: m.phones }))
}

/** Download a model (and the AI runtime it needs, the first time). Progress in bytes. */
export async function downloadModel(id: string, opts: { onProgress?: (loaded: number, total: number) => void; signal?: AbortSignal } = {}): Promise<void> {
  const m = modelEntry(id)
  if (!m) throw new Error(`Unknown AI model ${id}`)
  const runtime = await missingRuntime(m)
  const runtimeBytes = runtime.reduce((n, r) => n + RUNTIME_ASSETS[r].bytes, 0)
  const needModel = !(await store.isDownloaded(id))
  const total = runtimeBytes + (needModel ? (await store.modelInfo(id)).bytes : 0)
  let rt = 0
  for (const r of runtime) await downloadRuntimeAsset(r, (n) => opts.onProgress?.(Math.min(total, (rt += n)), total), opts.signal)
  if (needModel) await store.downloadModel(id, { signal: opts.signal, onProgress: (loaded) => opts.onProgress?.(Math.min(total, runtimeBytes + loaded), total) })
  opts.onProgress?.(total, total)
}

export async function deleteModel(id: string): Promise<void> {
  await store.deleteModel(id)
}

/** Throws ModelNotDownloadedError unless the model and its runtime are on the device. */
async function ready(m: ModelEntry): Promise<void> {
  if (!(await store.isDownloaded(m.id)) || (await missingRuntime(m)).length) throw new ModelNotDownloadedError(m.id, m.name)
  const mem = store.memoryFiles(m.id)
  if (mem) await call('provideFiles', { id: m.id, files: mem })
}

// ---------- helpers ----------

/** A copy of the image at most `max` px on the long edge, safe to transfer to the worker. */
function workingCopy(image: SourceImage, max: number): { width: number; height: number; data: Uint16Array } {
  const r = resampleRgb16(image.data, image.width, image.height, max)
  return { width: r.width, height: r.height, data: r.data === image.data ? image.data.slice() : r.data }
}

async function timed<T>(model: string, run: () => Promise<T & { backend: 'webgpu' | 'wasm' }>): Promise<T & { backend: 'webgpu' | 'wasm' }> {
  const t0 = performance.now()
  const r = await run()
  last = { model, backend: r.backend, ms: Math.round(performance.now() - t0) }
  const x = r as { encodeMs?: number; decodeMs?: number }
  if (x.encodeMs !== undefined) last.encodeMs = Math.round(x.encodeMs)
  if (x.decodeMs !== undefined) last.decodeMs = Math.round(x.decodeMs)
  return r
}

const MASK_EDGE = 2048

// ---------- masks ----------

/** A mask of the subject, sky, background or people (optionally only some parts) over the whole source. */
export async function segment(target: Exclude<AiTarget, 'object'>, image: SourceImage, color: SourceColor, opts: RunOptions & { parts?: PersonPart[] } = {}): Promise<RasterImage> {
  const m = chosen('segment', target, opts.model)
  await ready(m)
  throwIfAborted(opts.signal)
  opts.onProgress?.(0.05)
  const img = workingCopy(image, MASK_EDGE)
  opts.onProgress?.(0.15)
  const r = await timed(m.id, () => call('segment', { target, parts: opts.parts, image: img, color, modelId: m.id }, [img.data.buffer], opts.signal))
  opts.onProgress?.(1)
  return { width: r.width, height: r.height, channels: 1, data: r.mask }
}

const imageKeys = new WeakMap<Uint16Array, string>()
let keyCount = 0

/** Click-to-select: points in mask coordinates (0…1 of the source), positive = include. */
export async function selectObject(points: { x: number; y: number; positive: boolean }[], image: SourceImage, color: SourceColor, opts: RunOptions = {}): Promise<RasterImage> {
  const m = chosen('object', 'object', opts.model)
  await ready(m)
  if (!points.length) return { width: 1, height: 1, channels: 1, data: new Uint8Array(1) }
  let key = imageKeys.get(image.data)
  if (!key) imageKeys.set(image.data, (key = `img${++keyCount}`))
  opts.onProgress?.(0.1)
  const args = { points, imageKey: key, color, modelId: m.id }
  if (m.files[0].file.endsWith('.tflite')) {
    // Magic Touch v1 has no reusable image features: always send the photo.
    const img = workingCopy(image, 1024)
    const r = await timed(m.id, () => call('selectObject', { ...args, image: img }, [img.data.buffer], opts.signal))
    opts.onProgress?.(1)
    return { width: r.width, height: r.height, channels: 1, data: r.mask }
  }
  const r = await timed(m.id, async () => {
    try {
      // The worker keeps the last photo's features: send pixels only when it doesn't have them.
      return await call('selectObject', args, [], opts.signal)
    } catch (e) {
      if ((e as Error).message !== 'needs-image') throw e
      const img = workingCopy(image, MASK_EDGE)
      return call('selectObject', { ...args, image: img }, [img.data.buffer], opts.signal)
    }
  })
  opts.onProgress?.(1)
  return { width: r.width, height: r.height, channels: 1, data: r.mask }
}

// ---------- removal ----------

/**
 * Remove what the strokes cover. Pass the full-resolution source for full
 * detail: the area plus context is cut from it, filled by the model at 512²,
 * and the fill comes back in the source's color space at the model's
 * effective resolution, covering `rect` (mask coordinates).
 */
export async function inpaint(image: SourceImage, color: SourceColor, opts: RunOptions & { strokes: BrushStroke[] }): Promise<{ rect: Rect; fill: RasterImage }> {
  const m = chosen('inpaint', undefined, opts.model)
  await ready(m)
  const W = image.width, H = image.height
  const plan = planInpaint(opts.strokes, W, H, 512)
  if (!plan) throw new Error('Paint over what you want to remove first.')
  opts.onProgress?.(0.05)
  const S = plan.model
  const cropped = cropInterleaved(image.data, W, 3, plan.crop)
  let square: Uint16Array
  if (plan.crop.w >= S && plan.crop.h >= S) {
    const r = new AreaResampler(plan.crop.w, plan.crop.h, S, S)
    for (let y = 0; y < plan.crop.h; y++) r.pushRow(cropped, y * plan.crop.w * 3)
    square = r.out
  } else square = Uint16Array.from(resize(Float32Array.from(cropped), plan.crop.w, plan.crop.h, S, S, 3), (v) => Math.round(v))
  const area = { x: plan.crop.x / W, y: plan.crop.y / H, w: plan.crop.w / W, h: plan.crop.h / H }
  const hole = morph(rasterizeStrokes(opts.strokes, area, S, S, W, H), S, S, 2, 'dilate')
  const hole8 = Uint8Array.from(hole, (v) => (v > 0.5 ? 1 : 0))
  opts.onProgress?.(0.15)
  const r = await timed(m.id, () =>
    call('inpaint', { crop: { width: S, height: S, data: square }, hole: hole8, color, rect: rectInModel(plan), out: plan.fill, modelId: m.id }, [square.buffer, hole8.buffer], opts.signal),
  )
  opts.onProgress?.(1)
  return { rect: plan.rect, fill: { width: plan.fill.width, height: plan.fill.height, channels: 3, data: r.fill } }
}

// ---------- denoise ----------

/**
 * AI noise reduction of the whole source at full resolution (same size and
 * color space), tiled with overlap. Minutes on phones and without WebGPU.
 */
export async function denoise(image: SourceImage, color: SourceColor, opts: RunOptions = {}): Promise<SourceImage> {
  const m = chosen('denoise', undefined, opts.model)
  await ready(m)
  const W = image.width, H = image.height
  if (lowMemory() && W * H > 50e6) throw new AiUnavailableError('This photo is too large to denoise on this device.')
  const webgpu = await hasWebGpu()
  const size = webgpu ? 512 : 256, overlap = 32
  const gain = autoGain(image.data, color)
  const rows = tileGrid(W, H, size, overlap)
  const total = rows.reduce((n, r) => n + r.length, 0)
  const out = new Uint16Array(W * H * 3)
  const asm = new BandAssembler(W, H, 3, overlap / 2, (y, row) => {
    const o = y * W * 3
    for (let i = 0; i < row.length; i++) out[o + i] = row[i] < 0 ? 0 : row[i] > 65535 ? 65535 : Math.round(row[i])
  })
  let done = 0
  const t0 = performance.now()
  let backend: 'webgpu' | 'wasm' = 'wasm'
  for (let j = 0; j < rows.length; j++) {
    for (const t of rows[j]) {
      if (opts.signal?.aborted) throw abortError()
      const tile = cropInterleaved(image.data, W, 3, t)
      const r = await call('denoiseTile', { tile: { width: t.w, height: t.h, data: tile }, color, gain, modelId: m.id }, [tile.buffer], opts.signal)
      backend = r.backend
      asm.add(t, r.data)
      opts.onProgress?.(++done / total)
    }
    asm.flush(j + 1 < rows.length ? rows[j + 1][0].y : H)
  }
  last = { model: m.id, backend, ms: Math.round(performance.now() - t0) }
  return { width: W, height: H, data: out, ...(image.fullWidth ? { fullWidth: image.fullWidth } : {}) }
}

// ---------- upscale ----------

/** "Super Resolution" for export: the rendered image at 2× (same bit depth and color space), tiled. */
export async function upscale(image: RenderedImage, opts: RunOptions = {}): Promise<RenderedImage> {
  const m = chosen('upscale', undefined, opts.model)
  await ready(m)
  const W = image.width, H = image.height
  const maxOut = lowMemory() ? 48e6 : 160e6
  if (4 * W * H > maxOut) throw new AiUnavailableError(`Super Resolution is limited to ${Math.round(maxOut / 4e6)} MP photos on this device.`)
  const size = (await hasWebGpu()) ? 384 : 192, overlap = 16
  const sixteen = image.bitDepth === 16
  const max = sixteen ? 65535 : 255
  const OW = W * 2, OH = H * 2
  const data = sixteen ? new Uint16Array(OW * OH * 4) : new Uint8ClampedArray(OW * OH * 4)
  const asm = new BandAssembler(OW, OH, 3, overlap, (y, row) => {
    const o = y * OW * 4
    for (let x = 0; x < OW; x++) {
      data[o + x * 4] = Math.round(row[x * 3] * max)
      data[o + x * 4 + 1] = Math.round(row[x * 3 + 1] * max)
      data[o + x * 4 + 2] = Math.round(row[x * 3 + 2] * max)
      data[o + x * 4 + 3] = max
    }
  })
  const rows = tileGrid(W, H, size, overlap)
  const total = rows.reduce((n, r) => n + r.length, 0)
  let done = 0
  const t0 = performance.now()
  let backend: 'webgpu' | 'wasm' = 'wasm'
  for (let j = 0; j < rows.length; j++) {
    for (const t of rows[j]) {
      if (opts.signal?.aborted) throw abortError()
      const rgb = new Float32Array(t.w * t.h * 3)
      for (let y = 0; y < t.h; y++)
        for (let x = 0; x < t.w; x++) {
          const s = ((t.y + y) * W + t.x + x) * 4, d = (y * t.w + x) * 3
          rgb[d] = image.data[s] / max
          rgb[d + 1] = image.data[s + 1] / max
          rgb[d + 2] = image.data[s + 2] / max
        }
      const r = await call('upscaleTile', { rgb, width: t.w, height: t.h, modelId: m.id }, [rgb.buffer], opts.signal)
      backend = r.backend
      asm.add(scaleTile(t, 2), r.data)
      opts.onProgress?.(++done / total)
    }
    asm.flush(j + 1 < rows.length ? rows[j + 1][0].y * 2 : OH)
  }
  last = { model: m.id, backend, ms: Math.round(performance.now() - t0) }
  return { width: OW, height: OH, data, bitDepth: image.bitDepth, colorSpace: image.colorSpace }
}
