// The AI runtimes' own WebAssembly files (bundled by Vite, served from Lumen's
// origin). They are too big for the app's offline precache, so they download
// together with the first model that needs them (counted in its size) and live
// in Cache Storage next to the models. Runs never fetch them implicitly.
import mpLoaderUrl from '@mediapipe/tasks-vision/vision_wasm_module_internal.js?url'
import mpWasmUrl from '@mediapipe/tasks-vision/vision_wasm_module_internal.wasm?url'
import ortGpuWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url'
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'
import type { Runtime } from './registry'

export interface RuntimeAsset {
  url: string
  /** Approximate size (for progress and the "download N MB?" prompt). */
  bytes: number
  type: string
}

/** onnxruntime-web 1.31.1 and @mediapipe/tasks-vision 1.2.0 file sizes. */
export const RUNTIME_ASSETS = {
  /** ONNX Runtime with WebGPU (JSEP) and WASM. */
  ortGpu: { url: ortGpuWasmUrl, bytes: 29520971, type: 'application/wasm' },
  /** ONNX Runtime, WASM only (devices without WebGPU). */
  ort: { url: ortWasmUrl, bytes: 14848852, type: 'application/wasm' },
  mpLoader: { url: mpLoaderUrl, bytes: 334166, type: 'text/javascript' },
  mpWasm: { url: mpWasmUrl, bytes: 14466676, type: 'application/wasm' },
} satisfies Record<string, RuntimeAsset>

export type RuntimeAssetId = keyof typeof RUNTIME_ASSETS

export function runtimeAssetsFor(runtime: Runtime, webgpu: boolean): RuntimeAssetId[] {
  return runtime === 'mediapipe' ? ['mpLoader', 'mpWasm'] : [webgpu ? 'ortGpu' : 'ort']
}

const CACHE = 'lumen-ai-runtime-v1'
const abs = (url: string) => new URL(url, globalThis.location?.href).href

async function open(): Promise<Cache | null> {
  try {
    return typeof caches === 'undefined' ? null : await caches.open(CACHE)
  } catch {
    return null
  }
}

export async function hasRuntimeAsset(id: RuntimeAssetId): Promise<boolean> {
  const c = await open()
  return !!(await c?.match(abs(RUNTIME_ASSETS[id].url)))
}

/** Fetch into the cache (with byte progress). Old versions (other URLs) are dropped. */
export async function downloadRuntimeAsset(id: RuntimeAssetId, onBytes: (n: number) => void, signal?: AbortSignal): Promise<void> {
  const c = await open()
  const a = RUNTIME_ASSETS[id]
  const url = abs(a.url)
  if (await c?.match(url)) return
  const res = await fetch(url, { signal })
  if (!res.ok || !res.body) throw new Error(`Couldn’t download the AI runtime (HTTP ${res.status}).`)
  const parts: Uint8Array[] = []
  const reader = res.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
    onBytes(value.length)
  }
  if (!c) return // nothing to keep it in: the worker will fetch it itself (from the HTTP cache).
  await c.put(url, new Response(new Blob(parts as BlobPart[], { type: a.type }), { headers: { 'content-type': a.type } }))
  const current = new Set(Object.values(RUNTIME_ASSETS).map((x) => abs(x.url)))
  for (const k of await c.keys()) if (!current.has(k.url)) await c.delete(k)
}

/** The asset's bytes: from the cache, else the network (only when Cache Storage is unavailable). */
export async function runtimeAssetBytes(id: RuntimeAssetId): Promise<ArrayBuffer> {
  const url = abs(RUNTIME_ASSETS[id].url)
  const hit = await (await open())?.match(url)
  const res = hit ?? (await fetch(url))
  if (!res.ok) throw new Error(`Couldn’t load the AI runtime (HTTP ${res.status}).`)
  return res.arrayBuffer()
}
