import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../io/db'
import { navigate } from '../router'
import { finishCrop, isCropping } from './crop/cropTool'

// The library in filmstrip order (newest capture first), for the filmstrip,
// "3 of 120" and the ←/→ shortcuts.

export interface StripItem {
  id: string
  /** Width ÷ height. */
  ratio: number
  edited: boolean
  name: string
}

export function usePhotoOrder(): StripItem[] | undefined {
  return useLiveQuery(
    async () => (await db.photos.orderBy('takenAt').reverse().toArray()).map((p) => ({ id: p.id, ratio: p.width && p.height ? p.width / p.height : 1.5, edited: p.edited, name: p.fileName })),
    [],
  )
}

/** Switch to another photo. Replaces the history entry so Back still returns to the library. */
export function openPhoto(id: string) {
  if (isCropping()) finishCrop()
  navigate(`/edit/${encodeURIComponent(id)}`, { replace: true })
}

export function neighbor(order: StripItem[] | undefined, id: string, step: 1 | -1): string | undefined {
  if (!order) return undefined
  const i = order.findIndex((p) => p.id === id)
  return i < 0 ? undefined : order[i + step]?.id
}
