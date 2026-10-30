// The model store: downloads model files from Lumen's own origin (models/…,
// put there at build time), checks their sha256 and keeps them in Cache
// Storage keyed by that hash, so they work offline and survive app updates
// that don't change them. Nothing downloads unless downloadModel() is called.
import { abortError, ModelNotDownloadedError } from './errors'
import { MODELS, modelBytes, modelEntry, type AiTask, type ModelEntry, type ModelFile } from './registry'

export interface ModelInfo {
  id: string
  name: string
  task: AiTask
  /** Download size (all files). */
  bytes: number
  downloaded: boolean
  licence: string
  upstream: string
  tier: 'fast' | 'quality'
  /** Worth offering on phones. */
  phones: boolean
}

export interface DownloadOptions {
  onProgress?: (loaded: number, total: number) => void
  signal?: AbortSignal
}

const CACHE = 'lumen-ai-models-v1'

/** Cache key for a file: a synthetic same-origin URL that is never fetched. */
const keyFor = (sha256: string) => `${self.location.origin}/__lumen-ai-model__/${sha256}`

/** Where the app is served from (the folder of index.html). Set by the main thread; workers never download. */
let base: string | null = null
export function setModelBase(url: string): void {
  base = url
}
function modelUrl(f: ModelFile): string {
  if (!base) base = new URL(import.meta.env.BASE_URL || './', document.baseURI).href
  return new URL(`models/${f.file}`, base).href
}

// Cache Storage is missing in some private modes and insecure contexts: fall back to memory for the session.
const memory = new Map<string, ArrayBuffer>()
async function openCache(): Promise<Cache | null> {
  try {
    return typeof caches === 'undefined' ? null : await caches.open(CACHE)
  } catch {
    return null
  }
}

async function hasFile(cache: Cache | null, f: ModelFile): Promise<boolean> {
  if (memory.has(f.sha256)) return true
  const r = await cache?.match(keyFor(f.sha256))
  return !!r && Number(r.headers.get('content-length')) === f.bytes
}

export async function isDownloaded(id: string): Promise<boolean> {
  const m = modelEntry(id)
  if (!m) return false
  const cache = await openCache()
  for (const f of m.files) if (!(await hasFile(cache, f))) return false
  return true
}

function info(m: ModelEntry, downloaded: boolean): ModelInfo {
  return { id: m.id, name: m.name, task: m.task, bytes: modelBytes(m), downloaded, licence: m.licence, upstream: m.upstream, tier: m.tier, phones: m.hints.phones }
}

export async function modelInfo(id: string): Promise<ModelInfo> {
  const m = modelEntry(id)
  if (!m) throw new Error(`Unknown AI model ${id}`)
  return info(m, await isDownloaded(id))
}

/** Every model, for Settings → AI models. */
export async function listModels(): Promise<ModelInfo[]> {
  return Promise.all(MODELS.map(async (m) => info(m, await isDownloaded(m.id))))
}

export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data as BufferSource)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function fetchFile(f: ModelFile, onBytes: (n: number) => void, signal?: AbortSignal): Promise<ArrayBuffer> {
  const res = await fetch(modelUrl(f), { signal, cache: 'no-store' })
  if (!res.ok || !res.body) throw new Error(res.status === 404 ? 'This model isn’t available in this version of Lumen.' : `Download failed (HTTP ${res.status}).`)
  // Written straight into one buffer of the known size: no second copy of a 100 MB file.
  const out = new Uint8Array(f.bytes)
  let n = 0
  const reader = res.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (n + value.length > f.bytes) throw new Error('The downloaded model is larger than expected.')
    out.set(value, n)
    n += value.length
    onBytes(value.length)
  }
  if (n !== f.bytes) throw new Error('The model download was incomplete. Try again.')
  if ((await sha256Hex(out)) !== f.sha256) throw new Error('The downloaded model is damaged (checksum mismatch). Try again.')
  return out.buffer
}

const downloading = new Map<string, Promise<void>>()

/** Download a model's files (those not cached yet), with progress in bytes over the whole model. */
export function downloadModel(id: string, opts: DownloadOptions = {}): Promise<void> {
  const running = downloading.get(id)
  if (running) return running
  const m = modelEntry(id)
  if (!m) return Promise.reject(new Error(`Unknown AI model ${id}`))
  const p = (async () => {
    const cache = await openCache()
    const total = modelBytes(m)
    let loaded = 0
    opts.onProgress?.(0, total)
    for (const f of m.files) {
      if (opts.signal?.aborted) throw abortError()
      if (await hasFile(cache, f)) {
        loaded += f.bytes
        opts.onProgress?.(loaded, total)
        continue
      }
      const bytes = await fetchFile(f, (n) => opts.onProgress?.((loaded += n), total), opts.signal)
      const headers = { 'content-type': 'application/octet-stream', 'content-length': String(f.bytes), 'x-lumen-model': m.id }
      try {
        if (!cache) throw new Error('no cache')
        await cache.put(keyFor(f.sha256), new Response(bytes, { headers }))
      } catch {
        memory.set(f.sha256, bytes)
      }
    }
    opts.onProgress?.(total, total)
  })().finally(() => downloading.delete(id))
  downloading.set(id, p)
  return p
}

export async function deleteModel(id: string): Promise<void> {
  const m = modelEntry(id)
  if (!m) return
  const cache = await openCache()
  // A file shared with another model stays (none today, but keys are content hashes).
  const inUse = new Set(MODELS.filter((x) => x.id !== id).flatMap((x) => x.files.map((f) => f.sha256)))
  for (const f of m.files) {
    if (inUse.has(f.sha256)) continue
    memory.delete(f.sha256)
    await cache?.delete(keyFor(f.sha256))
  }
}

/** A model file's bytes from the store (works in workers). Throws ModelNotDownloadedError when missing. */
export async function readModelFile(id: string, index = 0): Promise<ArrayBuffer> {
  const m = modelEntry(id)
  if (!m) throw new Error(`Unknown AI model ${id}`)
  const f = m.files[index]
  const mem = memory.get(f.sha256)
  if (mem) return mem
  const r = await (await openCache())?.match(keyFor(f.sha256))
  if (!r) throw new ModelNotDownloadedError(m.id, m.name)
  const bytes = await r.arrayBuffer()
  if (bytes.byteLength !== f.bytes) throw new ModelNotDownloadedError(m.id, m.name)
  return bytes
}

/** Bytes held in memory instead of Cache Storage (handed to the worker, which can't see them). */
export function memoryFiles(id: string): ArrayBuffer[] | null {
  const m = modelEntry(id)
  if (!m || !m.files.every((f) => memory.has(f.sha256))) return null
  return m.files.map((f) => memory.get(f.sha256)!)
}

export async function ensureDownloaded(id: string): Promise<void> {
  if (!(await isDownloaded(id))) {
    const m = modelEntry(id)!
    throw new ModelNotDownloadedError(m.id, m.name)
  }
}
