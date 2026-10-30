import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import type { EditRecipe, SourceKind } from '../edit/types'
import type { SourceColor, SourceImage } from '../engine/types'
import { db } from '../io/db'
import { useObjectUrl } from '../ui/hooks'
import { stripLook } from './apply'
import type { PreviewTarget } from './LookTile'
import { previewSource, recipeHash, type PreviewSource } from './previews'

/** Settle time before previews follow an edit (so dragging a slider doesn't re-render every tile per frame). */
const SETTLE_MS = 350

/** What look previews render on: a small copy of the photo and its edits without any look. */
export function usePreviewTarget(photoId: string | null, photo: { image: SourceImage; color: SourceColor } | null, kind: SourceKind, recipe: EditRecipe | null): PreviewTarget | null {
  const [source, setSource] = useState<PreviewSource | null>(null)
  useEffect(() => {
    if (!photoId || !photo) return
    // Downscaling a working-size image takes a few tens of ms: after first paint.
    const t = setTimeout(() => setSource(previewSource(photoId, photo.image, photo.color)), 30)
    return () => clearTimeout(t)
  }, [photoId, photo])

  const base = useMemo(() => (recipe ? stripLook(recipe) : null), [recipe])
  const [settled, setSettled] = useState(base)
  useEffect(() => {
    const t = setTimeout(() => setSettled(base), SETTLE_MS)
    return () => clearTimeout(t)
  }, [base])

  const thumb = useLiveQuery(() => (photoId ? db.thumbs.get(photoId) : undefined), [photoId])
  const thumbUrl = useObjectUrl(thumb?.blob)
  const current = source && photoId && source.key.startsWith(`${photoId}@`) ? source : null
  return useMemo(() => (current && settled ? { source: current, base: settled, baseKey: recipeHash(settled), kind, thumbUrl } : null), [current, settled, kind, thumbUrl])
}
