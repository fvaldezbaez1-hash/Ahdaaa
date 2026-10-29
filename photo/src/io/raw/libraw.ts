// RAW backend 1: LibRaw compiled to WASM (libraw-wasm). It runs in its own
// worker with shared memory + threads, which some browsers (iOS Safari) can't
// provide — the first use doubles as a health check and a failure disables it
// for the session. Files are decoded one at a time; the instance is recreated
// after any error and released when idle, since its WASM heap never shrinks.
import type LibRaw from 'libraw-wasm'
import type { LibRawSettings } from 'libraw-wasm'
import { abortError } from '../abort'
import { isIOS, lowMemory } from '../platform'
import { librawColor, librawPhotoMeta } from './librawMeta'
import { BackendUnavailable, type RawDecodeResult } from './types'

/** Linear 16-bit camera RGB with the camera's white balance; the engine does the rest. */
const SETTINGS: LibRawSettings = { outputBps: 16, gamm: [1, 1], noAutoBright: true, useCameraWb: true, outputColor: 0, userQual: 3, highlight: 0 }
const IDLE_MS = 15_000
const HEALTH_TIMEOUT_MS = 30_000

let state: 'untested' | 'ok' | 'broken' = 'untested'
let instance: LibRaw | null = null
let idleTimer: ReturnType<typeof setTimeout> | undefined
let queue: Promise<unknown> = Promise.resolve()

export function librawUsable(): boolean {
  if (state === 'untested' && isIOS()) state = 'broken'
  return state !== 'broken'
}

function drop() {
  instance?.dispose()
  instance = null
}

async function acquire(): Promise<LibRaw> {
  clearTimeout(idleTimer)
  if (instance) return instance
  let raw: LibRaw
  try {
    const { default: LibRawCtor } = await import('libraw-wasm')
    raw = new LibRawCtor()
  } catch (e) {
    state = 'broken'
    throw new BackendUnavailable(`LibRaw failed to start: ${(e as Error).message}`)
  }
  if (state === 'untested') {
    // If the WASM module can't start, its worker throws and calls never settle;
    // listen for that on the (internal) worker and time out as a backstop.
    const w = (raw as unknown as { worker?: Worker }).worker
    const ok = await new Promise<boolean>((resolve) => {
      const t = setTimeout(() => resolve(false), HEALTH_TIMEOUT_MS)
      w?.addEventListener('error', () => resolve(false), { once: true })
      raw.metadata(false).then(() => resolve(true), () => resolve(false)).finally(() => clearTimeout(t))
    })
    if (!ok) {
      raw.dispose()
      state = 'broken'
      throw new BackendUnavailable('LibRaw is not supported in this browser')
    }
    state = 'ok'
  }
  return (instance = raw)
}

export interface LibrawRequest {
  /** true/false, or 'auto' = half size when it still covers maxLongEdge. */
  halfSize: boolean | 'auto'
  maxLongEdge?: number
  signal?: AbortSignal
}

export function librawDecode(blob: Blob, req: LibrawRequest): Promise<RawDecodeResult> {
  const run = queue.then(() => decode(blob, req))
  queue = run.catch(() => undefined)
  return run
}

async function decode(blob: Blob, { halfSize, maxLongEdge, signal }: LibrawRequest): Promise<RawDecodeResult> {
  if (signal?.aborted) throw abortError()
  const raw = await acquire()
  const onAbort = () => drop() // terminates the worker; pending calls reject
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const open = async (half: boolean) => raw.open(new Uint8Array(await blob.arrayBuffer()), { ...SETTINGS, halfSize: half })
    await open(halfSize === true)
    const m = await raw.metadata(true)
    if (!m) throw new Error('No RAW metadata')
    const swap = ((m.flip ?? 0) & 4) !== 0
    const fullWidth = swap ? m.height : m.width, fullHeight = swap ? m.width : m.height
    // Opening is cheap (~50 ms); processing happens in imageData(), so re-open at half size when that's enough.
    if (halfSize === 'auto' && maxLongEdge && Math.max(fullWidth, fullHeight) / 2 >= maxLongEdge) await open(true)
    const img = await raw.imageData()
    if (!img || !(img.data instanceof Uint16Array)) throw new Error('LibRaw returned no 16-bit image')
    let data = img.data
    if (img.colors === 1) {
      data = new Uint16Array(img.width * img.height * 3)
      for (let i = 0; i < img.width * img.height; i++) data[i * 3] = data[i * 3 + 1] = data[i * 3 + 2] = img.data[i]
    } else if (img.colors !== 3) throw new Error(`Unexpected ${img.colors}-channel output`)
    return { width: img.width, height: img.height, data, fullWidth, fullHeight, meta: librawPhotoMeta(m), raw: librawColor(m) }
  } catch (e) {
    drop()
    if (signal?.aborted) throw abortError()
    throw e
  } finally {
    signal?.removeEventListener('abort', onAbort)
    if (instance) {
      if (lowMemory()) drop()
      else idleTimer = setTimeout(drop, IDLE_MS)
    }
  }
}
