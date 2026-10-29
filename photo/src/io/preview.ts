import type { EditRecipe } from '../edit/types'
import { seams } from './seams'
import { work } from './worker'
import { loadWorking } from './working'

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

/** A small JPEG of the edited photo, e.g. for the AI assistant. */
export async function previewJpeg(id: string, recipe: EditRecipe, maxLongEdge = 1024): Promise<{ dataUrl: string; width: number; height: number }> {
  const d = await loadWorking(id)
  const r = await seams.render(recipe, d, { maxLongEdge, bitDepth: 8, colorSpace: 'srgb' })
  const blob = await work('rgbaToJpeg', { rgba: r.data as Uint8ClampedArray<ArrayBuffer>, width: r.width, height: r.height, quality: 0.85 }, [r.data.buffer as ArrayBuffer])
  return { dataUrl: await toDataUrl(blob), width: r.width, height: r.height }
}

export interface StorageInfo {
  /** Bytes used by this site (originals dominate). */
  usage: number
  quota: number
  /** True when the browser promised not to evict the library. */
  persisted: boolean
}

export async function storageEstimate(): Promise<StorageInfo> {
  const s = typeof navigator !== 'undefined' ? navigator.storage : undefined
  const [est, persisted] = await Promise.all([s?.estimate?.().catch(() => undefined), s?.persisted?.().catch(() => false)])
  return { usage: est?.usage ?? 0, quota: est?.quota ?? 0, persisted: !!persisted }
}
