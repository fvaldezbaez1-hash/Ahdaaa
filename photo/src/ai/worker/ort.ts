// ONNX Runtime Web inside the AI worker: WebGPU when the device has it, else
// single-threaded WebAssembly (no SharedArrayBuffer threads, no cross-origin
// isolation).
//
// onnxruntime-web 1.31 ships only "threaded" WebAssembly builds, whose glue
// always creates a *shared* memory declared with a 4 GiB maximum, even with one
// thread. iPhones reserve a shared memory's whole maximum up front and fail
// at 2 GiB and above. So before ORT loads, WebAssembly.Memory is wrapped to
// cap a shared memory's maximum (1 GiB on phones, 4 GiB elsewhere); allocations
// past the cap then fail cleanly instead of the page being killed.
import type * as Ort from 'onnxruntime-web'
import { runtimeAssetBytes } from '../runtimeAssets'

export type Backend = 'webgpu' | 'wasm'

let memoryCapPages = 65536
let lastMemory: WebAssembly.Memory | null = null

function capSharedMemory() {
  const native = WebAssembly.Memory
  if ((native as unknown as { __lumenCapped?: boolean }).__lumenCapped) return
  const capped = new Proxy(native, {
    construct(target, [desc]: [WebAssembly.MemoryDescriptor]) {
      const d = desc.shared && (desc.maximum ?? 65536) > memoryCapPages ? { ...desc, maximum: Math.max(desc.initial, memoryCapPages) } : desc
      const m = new target(d)
      if (desc.shared) lastMemory = m
      return m
    },
    get(target, key, recv) {
      return key === '__lumenCapped' ? true : Reflect.get(target, key, recv)
    },
  })
  WebAssembly.Memory = capped
}

/** Bytes the ORT heap has grown to (it never shrinks; the worker is recycled when idle). */
export const ortHeapBytes = () => lastMemory?.buffer.byteLength ?? 0

let ortPromise: Promise<{ ort: typeof Ort; backend: Backend }> | null = null

export async function webgpuAvailable(): Promise<boolean> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
    return !!(gpu && (await gpu.requestAdapter()))
  } catch {
    return false
  }
}

export function loadOrt(opts: { lowMemory: boolean; preferWasm?: boolean }): Promise<{ ort: typeof Ort; backend: Backend }> {
  ortPromise ??= (async () => {
    memoryCapPages = opts.lowMemory ? 16384 : 65536
    capSharedMemory()
    const gpu = !opts.preferWasm && (await webgpuAvailable())
    const ort = (gpu ? await import('onnxruntime-web') : await import('onnxruntime-web/wasm')) as typeof Ort
    ort.env.wasm.numThreads = 1
    ort.env.wasm.proxy = false
    ort.env.wasm.wasmBinary = await runtimeAssetBytes(gpu ? 'ortGpu' : 'ort')
    ort.env.logLevel = 'error'
    return { ort, backend: gpu ? 'webgpu' : 'wasm' }
  })()
  ortPromise.catch(() => (ortPromise = null))
  return ortPromise
}

export interface OrtModel {
  session: Ort.InferenceSession
  backend: Backend
  ort: typeof Ort
}

/** Create a session, on WebGPU when possible (ops it lacks run on the CPU), else WASM. */
export async function createSession(bytes: ArrayBuffer, opts: { lowMemory: boolean; wasmOnly?: boolean }): Promise<OrtModel> {
  const { ort, backend } = await loadOrt(opts)
  const base: Ort.InferenceSession.SessionOptions = { graphOptimizationLevel: 'all', enableMemPattern: !opts.lowMemory, enableCpuMemArena: !opts.lowMemory }
  if (backend === 'webgpu' && !opts.wasmOnly) {
    try {
      const session = await ort.InferenceSession.create(new Uint8Array(bytes), { ...base, executionProviders: ['webgpu', 'wasm'] })
      return { session, backend: 'webgpu', ort }
    } catch {
      // Some drivers / ops fail on WebGPU: fall back to the CPU.
    }
  }
  const session = await ort.InferenceSession.create(new Uint8Array(bytes), { ...base, executionProviders: ['wasm'] })
  return { session, backend: 'wasm', ort }
}

export async function run(m: OrtModel, feeds: Record<string, { type: 'float32' | 'uint8'; data: Float32Array | Uint8Array; dims: number[] }>): Promise<Record<string, Ort.Tensor>> {
  const inputs: Record<string, Ort.Tensor> = {}
  for (const [k, v] of Object.entries(feeds)) inputs[k] = new m.ort.Tensor(v.type, v.data, v.dims)
  const out = await m.session.run(inputs)
  for (const t of Object.values(inputs)) t.dispose?.()
  return out
}

/** Copy a result tensor to the CPU as Float32Array / Uint8Array and free it. */
export async function read<T extends Float32Array | Uint8Array>(t: Ort.Tensor): Promise<T> {
  const data = (await t.getData(true)) as T
  return data
}
