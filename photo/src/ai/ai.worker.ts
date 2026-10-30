// The AI worker: model inference off the UI thread. Created on demand by
// client.ts and terminated when idle, which is the only way a WebAssembly heap
// gives its memory back.
import { ModelNotDownloadedError } from './errors'
import { ortHeapBytes } from './worker/ort'
import * as tasks from './worker/tasks'

const handlers = {
  segment: tasks.segment,
  selectObject: tasks.selectObject,
  inpaint: tasks.inpaint,
  denoiseTile: tasks.denoiseTile,
  upscaleTile: tasks.upscaleTile,
  async provideFiles(a: { id: string; files: ArrayBuffer[] }) {
    tasks.provideFiles(a.id, a.files)
  },
  async release() {
    tasks.releaseAll()
  },
  async heap() {
    return ortHeapBytes()
  },
}

export type AiOps = typeof handlers

function transferables(result: unknown): Transferable[] {
  const out: Transferable[] = []
  if (result && typeof result === 'object')
    for (const v of Object.values(result)) if (ArrayBuffer.isView(v) && v.buffer instanceof ArrayBuffer) out.push(v.buffer)
  return out
}

self.onmessage = async (e: MessageEvent<{ id: number; op: keyof AiOps; args: never }>) => {
  const { id, op, args } = e.data
  try {
    const result = await handlers[op](args)
    self.postMessage({ id, result }, { transfer: transferables(result) })
  } catch (err) {
    const error =
      err instanceof ModelNotDownloadedError
        ? { name: err.name, message: err.message, modelId: err.modelId }
        : err instanceof Error
          ? { name: err.name, message: err.message }
          : { name: 'Error', message: String(err) }
    self.postMessage({ id, error })
  }
}
