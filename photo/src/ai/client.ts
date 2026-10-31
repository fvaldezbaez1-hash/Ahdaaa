// Promise wrapper around the AI worker (same pattern as io/worker.ts). One
// worker, created on demand, terminated after a quiet spell: that releases the
// model sessions and the WebAssembly heap, which never shrinks otherwise.
import { lowMemory } from '../io/platform'
import type { AiOps } from './ai.worker'
import { abortError, ModelNotDownloadedError } from './errors'

let worker: Worker | null = null
let nextId = 0
let idleTimer: ReturnType<typeof setTimeout> | undefined
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>()

/** Phones give memory back sooner. */
const idleMs = () => (lowMemory() ? 8_000 : 45_000)

function getWorker(): Worker {
  clearTimeout(idleTimer)
  if (worker) return worker
  const w = new Worker(new URL('./ai.worker.ts', import.meta.url), { type: 'module', name: 'lumen-ai' })
  w.onmessage = (e: MessageEvent<{ id: number; result?: unknown; error?: { name: string; message: string; modelId?: string } }>) => {
    const p = pending.get(e.data.id)
    if (!p) return
    pending.delete(e.data.id)
    const err = e.data.error
    if (err) p.reject(err.name === 'ModelNotDownloadedError' && err.modelId ? new ModelNotDownloadedError(err.modelId, err.message) : Object.assign(new Error(err.message), { name: err.name }))
    else p.resolve(e.data.result)
    settle()
  }
  w.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || 'The AI worker stopped unexpectedly (out of memory?).'))
    pending.clear()
    w.terminate()
    if (worker === w) worker = null
  }
  return (worker = w)
}

function settle() {
  if (pending.size) return
  clearTimeout(idleTimer)
  idleTimer = setTimeout(terminateAi, idleMs())
}

/** Drop the worker now (frees every model). */
export function terminateAi(): void {
  clearTimeout(idleTimer)
  worker?.terminate()
  worker = null
}

type Arg<K extends keyof AiOps> = Parameters<AiOps[K]>[0]
type Result<K extends keyof AiOps> = Awaited<ReturnType<AiOps[K]>>

/** Run an op in the worker. Buffers in `transfer` move. Aborting stops waiting (the current inference finishes and is dropped). */
export function call<K extends keyof AiOps>(op: K, args: Arg<K>, transfer: Transferable[] = [], signal?: AbortSignal): Promise<Result<K>> {
  if (signal?.aborted) return Promise.reject(abortError())
  return new Promise((resolve, reject) => {
    const id = nextId++
    const onAbort = () => {
      pending.delete(id)
      reject(abortError())
      settle()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    pending.set(id, {
      resolve: (v) => {
        signal?.removeEventListener('abort', onAbort)
        resolve(v as Result<K>)
      },
      reject: (e) => {
        signal?.removeEventListener('abort', onAbort)
        reject(e)
      },
    })
    getWorker().postMessage({ id, op, args }, transfer)
  })
}
