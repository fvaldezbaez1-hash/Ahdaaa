import { useSyncExternalStore } from 'react'
import type { AiTarget, PersonPart } from '../../edit/types'
import { toast } from '../../ui/toast'
import { ai, onAiCoreChange, type AiCore, type AiModel, type AiSupport, type AiTask, type RunOptions } from './core'

// One AI task at a time: check the model is on this device (asking before
// downloading it), download with progress, run with progress; cancel any time.

export type JobScope = 'mask' | 'remove' | 'denoise'

export interface AiJob {
  scope: JobScope
  /** What's happening, e.g. "Detecting the sky…". */
  label: string
  phase: 'confirm' | 'download' | 'run' | 'error'
  /** The models this task needs (the ones to download while confirming / downloading). */
  models?: AiModel[]
  /** 0…1 of the download or run; 0 = not known yet. */
  fraction: number
  loaded?: number
  total?: number
  error?: string
}

let job: AiJob | null = null
let controller: AbortController | null = null
let answer: ((ok: boolean) => void) | null = null
const listeners = new Set<() => void>()

function set(next: AiJob | null) {
  job = next
  listeners.forEach((l) => l())
}
const patch = (p: Partial<AiJob>) => job && set({ ...job, ...p })

export function useAiJob(): AiJob | null {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => job,
  )
}

export const aiBusy = () => !!job && job.phase !== 'error'

/** The person's answer to "download this model?". */
export function confirmDownload(ok: boolean) {
  answer?.(ok)
  answer = null
}

export function cancelAi() {
  if (job?.phase === 'confirm') return confirmDownload(false)
  controller?.abort()
}

export function dismissAiError() {
  if (job?.phase === 'error') set(null)
}

const isAbort = (e: unknown) => (e as { name?: string } | null)?.name === 'AbortError'

/**
 * Run an AI task: null when cancelled, unavailable or failed (the job card
 * then says why). The model comes back too, since recipes record it.
 */
export async function runAi<T>(opts: {
  scope: JobScope
  label: string
  task: AiTask
  target?: AiTarget
  parts?: PersonPart[]
  run: (core: AiCore, o: RunOptions) => Promise<T>
}): Promise<{ value: T; model: string } | null> {
  if (aiBusy()) {
    toast('Another AI task is still running')
    return null
  }
  const core = await ai()
  const support = await core.support()
  if (!support.available) {
    toast(support.reason ?? 'On-device AI isn’t available on this device.', 5000)
    return null
  }
  controller = new AbortController()
  const { signal } = controller
  set({ scope: opts.scope, label: opts.label, phase: 'run', fraction: 0 })
  try {
    const models = await core.modelsFor(opts.task, opts.target, opts.parts)
    const missing = models.filter((m) => !m.downloaded)
    if (missing.length) {
      patch({ phase: 'confirm', models: missing })
      const ok = await new Promise<boolean>((resolve) => (answer = resolve))
      if (!ok) {
        set(null)
        return null
      }
      // One bar for all of them, by bytes.
      const total = missing.reduce((n, m) => n + m.bytes, 0)
      let done = 0
      patch({ phase: 'download', fraction: 0, loaded: 0, total })
      for (const m of missing) {
        await core.downloadModel(m.id, { onProgress: (loaded) => patch({ fraction: total ? (done + loaded) / total : 0, loaded: done + loaded }), signal })
        done += m.bytes
      }
    }
    patch({ phase: 'run', fraction: 0, models, label: opts.label })
    const value = await opts.run(core, { onProgress: (fraction) => patch({ fraction }), signal })
    set(null)
    return { value, model: models.map((m) => m.id).join('+') }
  } catch (e) {
    if (isAbort(e) || signal.aborted) set(null)
    else patch({ phase: 'error', error: (e as Error)?.message || 'Something went wrong.' })
    return null
  } finally {
    controller = null
    answer = null
  }
}

// ---- What this device can do (asked once, refreshed when the core changes) ----

let support: AiSupport | null = null
let asked = false
const supportListeners = new Set<() => void>()

function askSupport() {
  asked = true
  void ai()
    .then((c) => c.support())
    .then(
      (s) => (support = s),
      () => (support = { available: false }),
    )
    .then(() => supportListeners.forEach((l) => l()))
}
onAiCoreChange(() => {
  support = null
  askSupport()
})

export function useAiSupport(): AiSupport | null {
  return useSyncExternalStore(
    (fn) => {
      supportListeners.add(fn)
      if (!asked) askSupport()
      return () => supportListeners.delete(fn)
    },
    () => support,
  )
}

/** "about 20 s" / "about 2 min" for a task on `megapixels`, or null when unknown. */
export function estimate(s: AiSupport | null, task: AiTask, megapixels: number): string | null {
  const per = s?.secondsPerMp?.[task]
  if (!per) return null
  const secs = per * megapixels
  if (secs < 5) return 'a few seconds'
  if (secs < 90) return `about ${Math.round(secs / 5) * 5} s`
  return `about ${Math.round(secs / 60)} min`
}

export const formatBytes = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(b >= 1e8 ? 0 : 1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`)
