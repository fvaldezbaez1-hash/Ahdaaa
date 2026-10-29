// Promise wrapper around the IO worker. One worker, created on demand and
// closed after a quiet spell so the WASM encoders' memory goes back to the OS.
import { abortError } from './abort'
import type { IoOps } from './io.worker'

const IDLE_MS = 30_000

let worker: Worker | null = null
let nextId = 0
let idleTimer: ReturnType<typeof setTimeout> | undefined
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>()

function getWorker(): Worker {
  clearTimeout(idleTimer)
  if (worker) return worker
  const w = new Worker(new URL('./io.worker.ts', import.meta.url), { type: 'module', name: 'lumen-io' })
  w.onmessage = (e: MessageEvent<{ id: number; result?: unknown; error?: { name: string; message: string } }>) => {
    const p = pending.get(e.data.id)
    if (!p) return
    pending.delete(e.data.id)
    if (e.data.error) p.reject(Object.assign(new Error(e.data.error.message), { name: e.data.error.name }))
    else p.resolve(e.data.result)
    settle()
  }
  w.onerror = (e) => {
    // A crash (e.g. out of memory) fails everything in flight; the next call starts a fresh worker.
    for (const p of pending.values()) p.reject(new Error(e.message || 'The image worker stopped unexpectedly'))
    pending.clear()
    w.terminate()
    if (worker === w) worker = null
  }
  return (worker = w)
}

function settle() {
  if (pending.size) return
  clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    worker?.terminate()
    worker = null
  }, IDLE_MS)
}

type Arg<K extends keyof IoOps> = Parameters<IoOps[K]>[0]
type Result<K extends keyof IoOps> = Awaited<ReturnType<IoOps[K]>>

/** Run an operation in the worker. Buffers in `transfer` move (are detached here). */
export function work<K extends keyof IoOps>(op: K, args: Arg<K>, transfer: Transferable[] = [], signal?: AbortSignal): Promise<Result<K>> {
  if (signal?.aborted) return Promise.reject(abortError())
  return new Promise((resolve, reject) => {
    const id = nextId++
    const onAbort = () => {
      // The worker finishes the current job; its result is dropped.
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
