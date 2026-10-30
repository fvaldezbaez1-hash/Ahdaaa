import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { normalizeRecipe } from '../edit/defaults'
import type { Preset } from '../edit/types'
import { loadWorking } from '../io/api'
import { db, kvGet } from '../io/db'
import type { DecodedPhoto } from '../io/types'
import { stripLook } from './apply'
import { builtinPresets, collectionName, lookMatches, searchTerms } from './catalog'
import { previewSource } from './previews'
import { photoStats, suggestLooks, type Suggestion } from './stats'
import { useFavorites, useUserPresets } from './store'
import { usePreviewTarget } from './usePreviewTarget'

export type View = 'suggested' | 'favorites' | 'mine' | 'lightroom' | string

/** Long edge of the big preview's source. */
const STAGE_EDGE = 1600

export interface Card {
  preset: Preset
  reason?: string
}

/** State of the Presets screen: which photo looks are previewed on, the grid, and the selected look. */
export function useBrowser() {
  // Photos to preview on: the last one edited, then the newest in the library.
  const choices = useLiveQuery(async () => {
    const last = await kvGet<string>('lastPhoto')
    const recent = await db.photos.orderBy('addedAt').reverse().limit(6).primaryKeys()
    const lastExists = last && (await db.photos.get(last)) ? [last] : []
    return [...new Set([...lastExists, ...recent])].slice(0, 4)
  }, [])
  const [picked, setPhotoId] = useState<string | null>(null)
  const photoId = picked && choices?.includes(picked) ? picked : (choices?.[0] ?? null)
  const record = useLiveQuery(() => (photoId ? db.photos.get(photoId) : undefined), [photoId])

  const [decoded, setDecoded] = useState<{ id: string; photo: DecodedPhoto } | { id: string; error: string } | null>(null)
  useEffect(() => {
    if (!photoId) return
    let live = true
    loadWorking(photoId).then(
      (photo) => live && setDecoded({ id: photoId, photo }),
      (e: unknown) => live && setDecoded({ id: photoId, error: e instanceof Error ? e.message : String(e) }),
    )
    return () => {
      live = false
    }
  }, [photoId])
  const photo = decoded?.id === photoId && 'photo' in decoded ? decoded.photo : null
  const decodeError = decoded?.id === photoId && 'error' in decoded ? decoded.error : null

  const kind = record?.kind ?? 'display'
  const recipe = useMemo(() => (record ? normalizeRecipe(record.recipe, record.kind, record.raw?.asShot) : null), [record])
  const before = useMemo(() => (recipe ? stripLook(recipe) : null), [recipe])
  const target = usePreviewTarget(photo ? photoId : null, photo, kind, recipe)
  const stageSource = useMemo(() => (photo && photoId ? previewSource(photoId, photo.image, photo.color, STAGE_EDGE) : null), [photo, photoId])

  const src = target?.source
  const stats = useMemo(() => (src ? photoStats(src.image, src.color) : null), [src])
  const suggestions: Suggestion[] = useMemo(() => (stats ? suggestLooks(stats, builtinPresets()) : []), [stats])

  const user = useUserPresets()
  const favs = useFavorites()
  const [chosenView, setView] = useState<View | null>(null)
  const view: View = chosenView ?? (choices?.length ? 'suggested' : 'essentials')
  const [q, setQ] = useState('')

  const all = useMemo(() => [...(user ?? []), ...builtinPresets()], [user])
  const cards: Card[] = useMemo(() => {
    const terms = searchTerms(q)
    if (terms.length) return all.filter((p) => lookMatches(p, terms)).map((preset) => ({ preset }))
    if (view === 'suggested') return suggestions.map((s) => ({ preset: s.preset, reason: s.reason }))
    if (view === 'favorites') return all.filter((p) => favs.has(p.id)).map((preset) => ({ preset }))
    if (view === 'mine') return (user ?? []).filter((p) => p.source !== 'lightroom').map((preset) => ({ preset }))
    if (view === 'lightroom') return (user ?? []).filter((p) => p.source === 'lightroom').map((preset) => ({ preset }))
    return builtinPresets().filter((p) => p.collection === view).map((preset) => ({ preset }))
  }, [q, view, all, user, favs, suggestions])

  const [selectedId, select] = useState<string | null>(null)
  const fallbackId = recipe?.look?.presetId ?? cards[0]?.preset.id ?? builtinPresets()[0].id
  const selected = all.find((p) => p.id === (selectedId ?? fallbackId)) ?? builtinPresets()[0]
  const [amount, setAmount] = useState(100)

  return {
    choices: choices ?? [],
    loading: choices === undefined,
    photoId,
    setPhotoId,
    record,
    kind,
    recipe,
    before,
    target,
    stageSource,
    decodeError,
    suggestions,
    user: user ?? [],
    favs,
    view,
    setView: (v: View) => {
      setView(v)
      setQ('')
    },
    q,
    setQ,
    cards,
    selected,
    select: (id: string) => {
      select(id)
      setAmount(100)
    },
    amount,
    setAmount,
    collectionLabel: (p: Preset) => collectionName(p.collection),
  }
}

export type Browser = ReturnType<typeof useBrowser>
