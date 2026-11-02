import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useDeferredValue, useMemo, useState } from 'react'
import { db, kvGet } from '../io/db'
import type { AlbumRecord } from '../io/types'
import { LAST_IMPORT_KEY } from './importer'
import {
  EMPTY_SELECTION,
  SMART_VIEWS,
  SORTS,
  albumIdOf,
  countPhotos,
  keywordOf,
  effectiveSelection,
  lastImportStart,
  plural,
  queryPhotos,
  type MinRating,
  type Selection,
  type SortKey,
  type View,
} from './library'
import { countKeywords, hasKeyword } from './keywords'
import { usePref } from './prefs'

/** Which sheet the library shows. */
export type LibrarySheet =
  | { type: 'import' }
  | { type: 'export'; ids: string[] }
  | { type: 'merge'; ids: string[] }
  | { type: 'preset'; ids: string[] }
  | { type: 'album'; ids: string[] }
  | { type: 'newAlbum'; ids: string[] }
  | { type: 'renameAlbum'; album: AlbumRecord }
  | { type: 'albumMenu'; album: AlbumRecord }
  | { type: 'deleteAlbum'; album: AlbumRecord }
  | { type: 'reset'; ids: string[] }
  | { type: 'delete'; ids: string[] }
  | { type: 'more'; ids: string[] }
  | { type: 'keywords'; ids: string[] }
  | { type: 'keywordMenu'; name: string }
  | { type: 'renameKeyword'; name: string }
  | { type: 'deleteKeyword'; name: string; count: number }

/** Compare (two photos side by side) or Survey (several), over the library. */
export type Loupe = { type: 'compare'; ids: string[]; select: string; candidate: string } | { type: 'survey'; ids: string[] }

/** Selection and scroll position outlive the screen, so coming back from the editor lands where you left. */
export const memory: { sel: Selection; scroll: Record<string, number> } = { sel: EMPTY_SELECTION, scroll: {} }

const isView = (v: unknown) => typeof v === 'string' && (SMART_VIEWS.some((s) => s.id === v) || v.startsWith('album:') || v.startsWith('keyword:'))
const isSort = (v: unknown) => SORTS.some((s) => s.id === v)
const isMinRating = (v: unknown) => v === 0 || v === 3 || v === 4 || v === 5

export function useLibrary() {
  const photos = useLiveQuery(() => db.photos.toArray(), [])
  const albums = useLiveQuery(() => db.albums.orderBy('createdAt').toArray(), [])
  const recorded = useLiveQuery(() => kvGet<number>(LAST_IMPORT_KEY).then((v) => v ?? null), [])
  const [storedView, setView] = usePref<View>('view', 'all', isView)
  const [sort, setSort] = usePref<SortKey>('sort', 'taken', isSort)
  const [minRating, setMinRating] = usePref<MinRating>('minRating', 0, isMinRating)
  const [search, setSearch] = useState('')
  const [loupe, setLoupe] = useState<Loupe | null>(null)
  // Typing stays responsive while 10,000 photos are filtered behind it.
  const query = useDeferredValue(search)

  const albumId = albumIdOf(storedView)
  const album = albumId ? albums?.find((a) => a.id === albumId) : undefined
  const keywords = useMemo(() => countKeywords(photos ?? []), [photos])
  const keyword = keywordOf(storedView)
  const keywordName = keyword ? keywords.find((k) => hasKeyword([k.name], keyword))?.name : undefined
  // An album deleted meanwhile (or a keyword no photo has any more) falls back to all photos.
  const view: View = (albumId && albums && !album) || (keyword && photos && !keywordName) ? 'all' : storedView

  const lastImportAt = useMemo(() => lastImportStart(photos?.map((p) => p.addedAt) ?? [], recorded ?? undefined), [photos, recorded])
  const visible = useMemo(() => (photos ? queryPhotos(photos, { view, minRating, search: query, sort, lastImportAt }) : []), [photos, view, minRating, query, sort, lastImportAt])
  const order = useMemo(() => visible.map((p) => p.id), [visible])
  const visibleIds = useMemo(() => new Set(order), [order])
  const counts = useMemo(() => countPhotos(photos ?? [], lastImportAt), [photos, lastImportAt])
  const byId = useMemo(() => new Map((photos ?? []).map((p) => [p.id, p])), [photos])

  const [sel, setSelState] = useState<Selection>(() => memory.sel)
  const setSel = useCallback((s: Selection) => {
    memory.sel = s
    setSelState(s)
  }, [])
  const selected = useMemo(() => order.filter((id) => sel.ids.has(id)), [order, sel.ids])
  /** What batch commands and shortcuts act on: the selection, or the focused photo. */
  const targets = useMemo(() => effectiveSelection(sel, order), [sel, order])
  const focused = sel.focus && visibleIds.has(sel.focus) ? byId.get(sel.focus) : undefined

  const keywordCount = keywordName ? (keywords.find((k) => k.name === keywordName)?.count ?? 0) : 0
  const viewTotal = album ? (counts.albums.get(album.id)?.count ?? 0) : keywordName ? keywordCount : counts.views[view as keyof typeof counts.views]
  const title = album?.name ?? (keywordName && view !== 'all' ? keywordName : undefined) ?? SMART_VIEWS.find((s) => s.id === view)?.label ?? 'All photos'
  const raw = visible.reduce((n, p) => n + (p.kind === 'raw' ? 1 : 0), 0)
  const countText = [
    minRating || query.trim() ? `${visible.length.toLocaleString('en-US')} of ${plural(viewTotal, 'photo')}` : plural(visible.length, 'photo'),
    raw && raw === visible.length ? 'all RAW' : raw ? `${raw.toLocaleString('en-US')} RAW` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  /** Compare the first two of `ids` (the first is the select); arrows then step the candidate through `pool`. */
  const openCompare = useCallback(
    (ids: readonly string[]) => {
      const pool = ids.length >= 2 ? [...ids] : order
      const select = ids[0] ?? order[0]
      if (!select) return
      const i = pool.indexOf(select)
      const candidate = ids[1] ?? pool[(i + 1) % pool.length] ?? select
      setLoupe({ type: 'compare', ids: pool, select, candidate })
    },
    [order],
  )
  const openSurvey = useCallback((ids: readonly string[]) => ids.length && setLoupe({ type: 'survey', ids: [...ids] }), [])

  return {
    photos,
    loupe,
    setLoupe,
    openCompare,
    openSurvey,
    albums: albums ?? [],
    counts,
    keywords,
    /** The keyword the view filters on, as spelled in the library. */
    keyword: view === 'all' ? undefined : keywordName,
    byId,
    lastImportAt,
    view,
    setView,
    album,
    sort,
    setSort,
    minRating,
    setMinRating,
    search,
    setSearch,
    visible,
    order,
    title,
    countText,
    sel,
    setSel,
    selected,
    targets,
    focused,
  }
}

export type Library = ReturnType<typeof useLibrary>
