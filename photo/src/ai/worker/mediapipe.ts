// MediaPipe Tasks Vision inside the AI worker (CPU / XNNPack). The WASM files
// come from Lumen's own origin via the runtime cache, handed to MediaPipe as
// blob URLs; tasks get model bytes, never URLs.
import type { ImageSegmenter, InteractiveSegmenter, InteractiveSegmenterLegacy } from '@mediapipe/tasks-vision'
import { runtimeAssetBytes } from '../runtimeAssets'

type Vision = typeof import('@mediapipe/tasks-vision')

let vision: Promise<{ mp: Vision; loader: Blob; wasmBinaryPath: string }> | null = null

async function load(): Promise<{ mp: Vision; fileset: { wasmLoaderPath: string; wasmBinaryPath: string } }> {
  vision ??= (async () => {
    const [mp, loader, wasm] = await Promise.all([import('@mediapipe/tasks-vision'), runtimeAssetBytes('mpLoader'), runtimeAssetBytes('mpWasm')])
    return { mp, loader: new Blob([loader], { type: 'text/javascript' }), wasmBinaryPath: URL.createObjectURL(new Blob([wasm], { type: 'application/wasm' })) }
  })()
  vision.catch(() => (vision = null))
  const v = await vision
  // Each task needs the loader module to run again (MediaPipe clears self.ModuleFactory after
  // creating a task, and an ES module only executes once per URL): a fresh blob URL each time.
  return { mp: v.mp, fileset: { wasmLoaderPath: URL.createObjectURL(v.loader), wasmBinaryPath: v.wasmBinaryPath } }
}

export async function imageSegmenter(model: ArrayBuffer): Promise<ImageSegmenter> {
  const { mp, fileset } = await load()
  return mp.ImageSegmenter.createFromOptions(fileset, {
    baseOptions: { modelAssetBuffer: new Uint8Array(model), delegate: 'CPU' },
    runningMode: 'IMAGE',
    outputConfidenceMasks: true,
    outputCategoryMask: false,
  })
}

export async function interactiveSegmenter(model: ArrayBuffer): Promise<InteractiveSegmenter> {
  const { mp, fileset } = await load()
  return mp.InteractiveSegmenter.createFromOptions(fileset, { baseOptions: { modelAssetBuffer: new Uint8Array(model), delegate: 'CPU' } })
}

export async function legacyInteractiveSegmenter(model: ArrayBuffer): Promise<InteractiveSegmenterLegacy> {
  const { mp, fileset } = await load()
  return mp.InteractiveSegmenterLegacy.createFromOptions(fileset, {
    baseOptions: { modelAssetBuffer: new Uint8Array(model), delegate: 'CPU' },
    outputConfidenceMasks: true,
    outputCategoryMask: false,
  })
}

/**
 * MediaPipe's BrushMode values. It is only a `declare enum` in vision.d.ts
 * (UNSPECIFIED 0, POSITIVE 1, NEGATIVE 2, LASSO 3): there is no runtime object.
 */
export const BRUSH = { positive: 1, negative: 2 } as const
