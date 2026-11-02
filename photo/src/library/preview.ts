// Larger edited previews than the grid's thumbnails, for Compare (zooming in
// on two photos). Rendered one at a time and kept for the few photos in play.
import { useEffect, useState } from 'react'
import { previewJpeg } from '../io/api'
import type { PhotoRecord } from '../io/types'

const MAX = 6
const done = new Map<string, string>()
const pending = new Map<string, Promise<string>>()
let queue: Promise<unknown> = Promise.resolve()

const keyOf = (p: PhotoRecord, edge: number) => `${p.id}|${p.thumbVersion}|${p.editedAt ?? 0}|${edge}`

function render(p: PhotoRecord, edge: number): Promise<string> {
  const key = keyOf(p, edge)
  const hit = done.get(key)
  if (hit) return Promise.resolve(hit)
  let job = pending.get(key)
  if (!job) {
    // One render at a time: the GPU and the decoder are shared with the rest of the app.
    job = (queue = queue.catch(() => undefined).then(() => previewJpeg(p.id, p.recipe, edge))).then((r) => {
      done.set(key, (r as { dataUrl: string }).dataUrl)
      while (done.size > MAX) done.delete(done.keys().next().value as string)
      return (r as { dataUrl: string }).dataUrl
    })
    pending.set(key, job)
    void job.finally(() => pending.delete(key)).catch(() => undefined)
  }
  return job
}

/** A `edge`-px edited preview of the photo, or undefined until it's ready (show the thumbnail meanwhile). */
export function usePreview(p: PhotoRecord | undefined, edge: number): string | undefined {
  const key = p ? keyOf(p, edge) : ''
  const [url, setUrl] = useState<{ key: string; url: string } | undefined>(() => (p && done.has(key) ? { key, url: done.get(key)! } : undefined))
  useEffect(() => {
    if (!p) return
    let live = true
    render(p, edge).then(
      (u) => live && setUrl({ key, url: u }),
      () => undefined,
    )
    return () => {
      live = false
    }
    // The key covers the photo's edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return url?.key === key ? url.url : undefined
}
