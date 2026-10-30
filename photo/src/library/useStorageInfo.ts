import { useEffect, useState } from 'react'
import { storageEstimate, type StorageInfo } from '../io/api'

/** Device storage used by Lumen; re-read whenever `dep` changes (e.g. the photo count). */
export function useStorageInfo(dep: unknown): StorageInfo | null {
  const [info, setInfo] = useState<StorageInfo | null>(null)
  useEffect(() => {
    let live = true
    storageEstimate()
      .then((i) => live && setInfo(i))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [dep])
  return info
}
