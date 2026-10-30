// Live look previews: ONE shared off-screen engine renders a small copy of the
// photo with each look. Tiles ask for a preview when they scroll into view; a
// queue renders a few per frame (so scrolling stays smooth) and finished
// previews are kept as bitmaps, keyed by photo, look and the photo's own edits.

import type { EditRecipe } from '../edit/types'
import { createEngine } from '../engine'
import { boxReduce } from '../engine/image'
import type { Engine, SourceColor, SourceImage } from '../engine/types'

/** A downscaled copy of one photo, uploaded once and shared by all its tiles. */
export interface PreviewSource {
  key: string
  image: SourceImage
  color: SourceColor
}

/** Long edge of tile previews: sharp at ~180 css px on 2× screens. */
export const TILE_EDGE = 360

const sources = new WeakMap<SourceImage, Map<number, PreviewSource>>()

/** A small copy of `image` (cached per image), at least `edge` px on its long side. */
export function previewSource(photoId: string, image: SourceImage, color: SourceColor, edge = TILE_EDGE): PreviewSource {
  let byEdge = sources.get(image)
  if (!byEdge) sources.set(image, (byEdge = new Map()))
  let s = byEdge.get(edge)
  if (!s) {
    const k = Math.max(1, Math.floor(Math.max(image.width, image.height) / edge))
    s = { key: `${photoId}@${edge}#${image.width}`, image: { ...boxReduce(image, k), fullWidth: image.fullWidth ?? image.width }, color }
    byEdge.set(edge, s)
  }
  return s
}

interface Job {
  key: string
  source: PreviewSource
  recipe: () => EditRecipe
  done: (b: ImageBitmap) => void
}

const MAX_CACHED = 320
/** Per-frame render budget; at least one preview renders each frame. */
const BUDGET_MS = 8

let engine: Engine | null | undefined
let canvas: HTMLCanvasElement | OffscreenCanvas | null = null
let loaded: string | null = null
const cache = new Map<string, ImageBitmap>() // insertion order = least recently used first
const queue: Job[] = []
let scheduled = false

function getEngine(): Engine | null {
  if (engine !== undefined) return engine
  try {
    canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas')
    engine = createEngine(canvas)
    if (!engine.supported) engine = null
    engine?.onContextRestored(() => {
      loaded = null
      cache.forEach((b) => b.close())
      cache.clear()
    })
  } catch {
    engine = null
  }
  return engine
}

/** False when this browser can't render previews (no WebGL2): tiles show an approximation. */
export function previewsSupported(): boolean {
  return getEngine() !== null
}

export function cachedPreview(key: string): ImageBitmap | undefined {
  const b = cache.get(key)
  if (b) {
    cache.delete(key)
    cache.set(key, b)
  }
  return b
}

function remember(key: string, b: ImageBitmap) {
  cache.set(key, b)
  while (cache.size > MAX_CACHED) {
    const [k, old] = cache.entries().next().value!
    old.close()
    cache.delete(k)
  }
}

async function snapshot(): Promise<ImageBitmap> {
  const c = canvas!
  if ('transferToImageBitmap' in c) return c.transferToImageBitmap()
  return createImageBitmap(c)
}

async function renderOne(job: Job) {
  const e = engine!
  if (loaded !== job.source.key) {
    e.setSource(job.source.image, job.source.color)
    loaded = job.source.key
  }
  const recipe = job.recipe()
  const out = e.outputSize(recipe)
  e.resize(out.width, out.height)
  e.render(recipe)
  const b = await snapshot()
  remember(job.key, b)
  job.done(b)
}

let running = false

function pump() {
  scheduled = false
  if (running) return
  running = true
  void (async () => {
    const start = performance.now()
    let n = 0
    while (queue.length && (n++ === 0 || performance.now() - start < BUDGET_MS)) {
      const job = queue.shift()!
      const hit = cache.get(job.key)
      if (hit) job.done(hit)
      else
        try {
          await renderOne(job)
        } catch {
          // A failed preview leaves the tile on its approximation.
        }
    }
    running = false
    if (queue.length) schedule()
  })()
}

function schedule() {
  if (scheduled) return
  scheduled = true
  requestAnimationFrame(pump)
}

/**
 * Ask for a preview. `recipe` is only built when the job runs. Returns a
 * cancel function (call it when the tile leaves the screen or changes).
 */
export function requestPreview(key: string, source: PreviewSource, recipe: () => EditRecipe, done: (b: ImageBitmap) => void): () => void {
  const hit = cachedPreview(key)
  if (hit) {
    done(hit)
    return () => undefined
  }
  if (!getEngine()) return () => undefined
  const job: Job = { key, source, recipe, done }
  queue.push(job)
  schedule()
  return () => {
    const i = queue.indexOf(job)
    if (i >= 0) queue.splice(i, 1)
  }
}

/** Short stable hash of a recipe (FNV-1a over its JSON), for cache keys. */
export function recipeHash(r: EditRecipe): string {
  const s = JSON.stringify(r)
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(36)
}
