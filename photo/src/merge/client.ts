// Promise wrapper around the merge worker, with progress. One worker per merge
// session; terminated when the merge ends (that frees its memory at once).
import type { MergeOps } from './merge.worker'

type Arg<K extends keyof MergeOps> = Parameters<MergeOps[K]>[0]
type Result<K extends keyof MergeOps> = Awaited<ReturnType<MergeOps[K]>>

const abortError = () => new DOMException('The operation was aborted.', 'AbortError')

export class MergeWorker {
  private worker: Worker | null = new Worker(new URL('./merge.worker.ts', import.meta.url), { type: 'module', name: 'lumen-merge' })
  private next = 0
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void; progress?: (f: number) => void }>()

  constructor() {
    this.worker!.onmessage = (e: MessageEvent<{ id: number; result?: unknown; error?: { name: string; message: string }; progress?: number }>) => {
      const p = this.pending.get(e.data.id)
      if (!p) return
      if (e.data.progress !== undefined) return p.progress?.(e.data.progress)
      this.pending.delete(e.data.id)
      if (e.data.error) p.reject(Object.assign(new Error(e.data.error.message), { name: e.data.error.name }))
      else p.resolve(e.data.result)
    }
    this.worker!.onerror = (e) => {
      for (const p of this.pending.values()) p.reject(new Error(e.message || 'The merge stopped unexpectedly (out of memory?).'))
      this.pending.clear()
      this.close()
    }
  }

  call<K extends keyof MergeOps>(op: K, args: Arg<K>, opts: { transfer?: Transferable[]; progress?: (f: number) => void; signal?: AbortSignal } = {}): Promise<Result<K>> {
    if (opts.signal?.aborted) return Promise.reject(abortError())
    if (!this.worker) return Promise.reject(new Error('The merge was closed.'))
    return new Promise((resolve, reject) => {
      const id = this.next++
      const onAbort = () => {
        // Work in the worker can't be interrupted: drop the worker itself.
        this.close()
        reject(abortError())
      }
      opts.signal?.addEventListener('abort', onAbort, { once: true })
      this.pending.set(id, {
        resolve: (v) => {
          opts.signal?.removeEventListener('abort', onAbort)
          resolve(v as Result<K>)
        },
        reject: (e) => {
          opts.signal?.removeEventListener('abort', onAbort)
          reject(e)
        },
        progress: opts.progress,
      })
      this.worker!.postMessage({ id, op, args }, opts.transfer ?? [])
    })
  }

  close(): void {
    this.worker?.terminate()
    this.worker = null
    for (const p of this.pending.values()) p.reject(abortError())
    this.pending.clear()
  }
}
