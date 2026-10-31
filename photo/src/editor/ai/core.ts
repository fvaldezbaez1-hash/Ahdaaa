import type { AiTarget, BrushStroke, EditRecipe, PersonPart, Rect } from '../../edit/types'
import type { RasterImage, RenderedImage, SourceColor, SourceImage } from '../../engine/types'
import { getRaster, pruneRasters, putRaster, type RasterKind } from '../../io/rasters'
import { rasterRefs } from './refs'

// The editor's one door to the on-device AI (src/ai) and its result store
// (src/io/rasters). Everything else in the app talks to this interface, so
// the AI core can change behind it, and tests can swap in a fake (setAiCore).

export type AiTask = 'segment' | 'object' | 'inpaint' | 'denoise' | 'upscale'

export interface AiModel {
  id: string
  name: string
  /** Download size. */
  bytes: number
  downloaded: boolean
}

export interface AiSupport {
  available: boolean
  /** Why not, in words for people. */
  reason?: string
  backend?: 'webgpu' | 'wasm'
  /** Rough speed on this device, for "about 20 s". */
  secondsPerMp?: Partial<Record<AiTask, number>>
}

export interface RunOptions {
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
}

export type { RasterKind }

export interface AiCore {
  support(): Promise<AiSupport>
  /** The models a task (and segmentation target) runs, and whether they're on this device yet. */
  modelsFor(task: AiTask, target?: AiTarget, parts?: PersonPart[]): Promise<AiModel[]>
  downloadModel(id: string, opts: { onProgress?: (loaded: number, total: number) => void; signal?: AbortSignal }): Promise<void>
  listModels(): Promise<AiModel[]>
  deleteModel(id: string): Promise<void>
  /** A mask covering the whole source (1 channel, 0…255). */
  segment(target: Exclude<AiTarget, 'object'>, image: SourceImage, color: SourceColor, opts: RunOptions & { parts?: PersonPart[] }): Promise<RasterImage>
  selectObject(points: { x: number; y: number; positive: boolean }[], image: SourceImage, color: SourceColor, opts: RunOptions): Promise<RasterImage>
  /** Fill for the painted strokes: 3 channels, linear, the source's color space, covering `rect` (mask coordinates). */
  inpaint(image: SourceImage, color: SourceColor, opts: RunOptions & { strokes: BrushStroke[] }): Promise<{ rect: Rect; fill: RasterImage }>
  denoise(image: SourceImage, color: SourceColor, opts: RunOptions): Promise<SourceImage>
  upscale(image: RenderedImage, opts: RunOptions): Promise<RenderedImage>
  putRaster(photoId: string, kind: RasterKind, img: RasterImage): Promise<string>
  getRaster(id: string): Promise<RasterImage | undefined>
  /** Delete this photo's stored results except `keep` (undo can bring back ones the recipe dropped). */
  pruneRasters(photoId: string, keep: Iterable<string>): Promise<void>
}

type AiModule = typeof import('../../ai')
let loading: Promise<AiModule> | null = null
/** The AI core pulls in a worker and big runtimes, so it loads on first use only. */
const load = () => (loading ??= import('../../ai'))

/** src/ai and the raster store behind this interface. */
const real: AiCore = {
  async support() {
    try {
      const s = await (await load()).aiSupport()
      return { available: s.available, reason: s.reason, backend: s.backend, secondsPerMp: s.secondsPerMp }
    } catch {
      loading = null
      return { available: false, reason: 'On-device AI couldn’t start. Check your connection and reload Lumen.' }
    }
  },
  modelsFor: async (task, target) => [await (await load()).modelFor(task, target)],
  downloadModel: async (id, opts) => (await load()).downloadModel(id, opts),
  listModels: async () => (await load()).listModels(),
  deleteModel: async (id) => (await load()).deleteModel(id),
  segment: async (target, image, color, opts) => (await load()).segment(target, image, color, opts),
  selectObject: async (points, image, color, opts) => (await load()).selectObject(points, image, color, opts),
  inpaint: async (image, color, opts) => (await load()).inpaint(image, color, opts),
  denoise: async (image, color, opts) => (await load()).denoise(image, color, opts),
  upscale: async (image, opts) => (await load()).upscale(image, opts),
  putRaster,
  getRaster,
  pruneRasters: async (photoId, keep) => void (await pruneRasters(photoId, keep)),
}

let current: AiCore = real

/** The AI core. */
export async function ai(): Promise<AiCore> {
  return current
}

/** Test seam: run the app against a fake AI core (null = the real one). */
export function setAiCore(core: AiCore | null) {
  current = core ?? real
  listeners.forEach((l) => l())
}

const listeners = new Set<() => void>()

/** Notified when the core is swapped, so cached support/model info refreshes. */
export function onAiCoreChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** The stored AI results a recipe refers to, for rendering it off-screen (exports, thumbnails, previews). */
export async function rastersFor(recipe: Pick<EditRecipe, 'layers' | 'retouch' | 'denoise'>): Promise<Map<string, RasterImage>> {
  const ids = rasterRefs(recipe)
  const out = new Map<string, RasterImage>()
  if (!ids.length) return out
  const core = await ai()
  await Promise.all(ids.map(async (id) => {
    const img = await core.getRaster(id).catch(() => undefined)
    if (img) out.set(id, img)
  }))
  return out
}
