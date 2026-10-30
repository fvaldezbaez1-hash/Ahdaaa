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
  effectiveSelection,
  lastImportStart,
  plural,
  queryPhotos,
  type MinRating,
  type Selection,
  type SortKey,
  type View,
} from './library'
import { usePref } from './prefs'

/** Which sheet the library shows. */
export type LibrarySheet =
  | { type: 'import' }
  | { type: 'export'; ids: string[] }
  | { type: 'preset'; ids: string[] }
  | { type: 'album'; ids: string[] }
  | { type: 'newAlbum'; ids: string[] }
  | { type: 'renameAlbum'; album: AlbumRecord }
  | { type: 'albumMenu'; album: AlbumRecord }
  | { type: 'deleteAlbum'; album: AlbumRecord }
  | { type: 'reset'; ids: string[] }
  | { type: 'delete'; ids: string[] }
  | { type: 'more'; ids: string[] }

/** Selection and scroll position outlive the screen, so coming back from the editor lands where you left. */
export const memory: { sel: Selection; scroll: Record<string, number> } = { sel: EMPTY_SELECTION, scroll: {} }

const isView = (v: unknown) => typeof v === 'string' && (SMART_VIEWS.some((s) => s.id === v) || v.startsWith('album:'))
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
  // Typing stays responsive while 10,000 photos are filtered behind it.
  const query = useDeferredValue(search)

  const albumId = albumIdOf(storedView)
  const album = albumId ? albums?.find((a) => a.id === albumId) : undefined
  // An album deleted meanwhile falls back to all photos.
  const view: View = albumId && albums && !album ? 'all' : storedView

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

  const viewTotal = album ? (counts.albums.get(album.id)?.count ?? 0) : counts.views[view as keyof typeof counts.views]
  const title = album?.name ?? SMART_VIEWS.find((s) => s.id === view)?.label ?? 'All photos'
  const raw = visible.reduce((n, p) => n + (p.kind === 'raw' ? 1 : 0), 0)
  const countText = [
    minRating || query.trim() ? `${visible.length.toLocaleString('en-US')} of ${plural(viewTotal, 'photo')}` : plural(visible.length, 'photo'),
    raw && raw === visible.length ? 'all RAW' : raw ? `${raw.toLocaleString('en-US')} RAW` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  return {
    photos,
    albums: albums ?? [],
    counts,
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
