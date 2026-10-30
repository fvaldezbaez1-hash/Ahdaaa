// Pure library logic: which photos a view shows, in what order, and how the
// grid and selection behave. No React, no database, so it is unit-tested.
import type { PhotoRecord } from '../io/types'

/** Smart collections in the sidebar, or an album (`album:<id>`). */
export type View = 'all' | 'last' | 'picks' | 'rejected' | 'rated' | 'edited' | `album:${string}`
export type SortKey = 'taken' | 'added' | 'rating' | 'name'
/** Minimum star rating (0 = any). */
export type MinRating = 0 | 3 | 4 | 5

export const SMART_VIEWS: { id: View; label: string }[] = [
  { id: 'all', label: 'All photos' },
  { id: 'last', label: 'Last import' },
  { id: 'picks', label: 'Picks' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'rated', label: '3 stars and up' },
  { id: 'edited', label: 'Edited' },
]

export const SORTS: { id: SortKey; label: string }[] = [
  { id: 'taken', label: 'Capture date' },
  { id: 'added', label: 'Date added' },
  { id: 'rating', label: 'Rating' },
  { id: 'name', label: 'File name' },
]

export interface Query {
  view: View
  minRating: MinRating
  search: string
  sort: SortKey
  /** Photos added at or after this time count as the last import. */
  lastImportAt: number
}

export function albumIdOf(view: View): string | undefined {
  return view.startsWith('album:') ? view.slice(6) : undefined
}

export function inView(p: PhotoRecord, view: View, lastImportAt: number): boolean {
  switch (view) {
    case 'all':
      return true
    case 'last':
      return p.addedAt >= lastImportAt
    case 'picks':
      return p.flag === 1
    case 'rejected':
      return p.flag === -1
    case 'rated':
      return p.rating >= 3
    case 'edited':
      return p.edited
    default:
      return p.albumIds.includes(view.slice(6))
  }
}

/** Text the search box matches: file name, camera and lens. */
export function searchText(p: PhotoRecord): string {
  const m = p.meta
  return `${p.fileName} ${m.make ?? ''} ${m.model ?? ''} ${m.lens ?? ''}`.toLowerCase()
}

/** Every whitespace-separated term must appear (so "sony 85" finds Sony shots at 85 mm lenses). */
export function matchesSearch(p: PhotoRecord, terms: string[]): boolean {
  if (terms.length === 0) return true
  const text = searchText(p)
  return terms.every((t) => text.includes(t))
}

export const searchTerms = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean)

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Newest first for dates, best first for rating, A→Z for names. Ties fall back to capture time, then name. */
export function comparePhotos(sort: SortKey): (a: PhotoRecord, b: PhotoRecord) => number {
  const byTaken = (a: PhotoRecord, b: PhotoRecord) => b.takenAt - a.takenAt || collator.compare(a.fileName, b.fileName)
  switch (sort) {
    case 'added':
      return (a, b) => b.addedAt - a.addedAt || byTaken(a, b)
    case 'rating':
      return (a, b) => b.rating - a.rating || byTaken(a, b)
    case 'name':
      return (a, b) => collator.compare(a.fileName, b.fileName) || byTaken(a, b)
    default:
      return byTaken
  }
}

export function queryPhotos(photos: readonly PhotoRecord[], q: Query): PhotoRecord[] {
  const terms = searchTerms(q.search)
  return photos.filter((p) => p.rating >= q.minRating && inView(p, q.view, q.lastImportAt) && matchesSearch(p, terms)).sort(comparePhotos(q.sort))
}

export interface Counts {
  views: Record<Exclude<View, `album:${string}`>, number>
  albums: Map<string, { count: number; cover?: string; coverTakenAt: number }>
  bytes: number
  raw: number
}

/** Sidebar counts, album covers (newest photo) and storage totals in one pass. */
export function countPhotos(photos: readonly PhotoRecord[], lastImportAt: number): Counts {
  const views = { all: 0, last: 0, picks: 0, rejected: 0, rated: 0, edited: 0 }
  const albums: Counts['albums'] = new Map()
  let bytes = 0
  let raw = 0
  for (const p of photos) {
    views.all++
    if (p.addedAt >= lastImportAt) views.last++
    if (p.flag === 1) views.picks++
    if (p.flag === -1) views.rejected++
    if (p.rating >= 3) views.rated++
    if (p.edited) views.edited++
    if (p.kind === 'raw') raw++
    bytes += p.fileSize || 0
    for (const a of p.albumIds) {
      const c = albums.get(a)
      if (!c) albums.set(a, { count: 1, cover: p.id, coverTakenAt: p.takenAt })
      else {
        c.count++
        if (p.takenAt > c.coverTakenAt) {
          c.cover = p.id
          c.coverTakenAt = p.takenAt
        }
      }
    }
  }
  return { views, albums, bytes, raw }
}

/**
 * Start of the last import: `recorded` when the app saved it, otherwise the
 * newest run of photos added within 30 minutes of each other.
 */
export function lastImportStart(addedAts: readonly number[], recorded?: number): number {
  if (recorded !== undefined) return recorded
  if (addedAts.length === 0) return Infinity
  const sorted = [...addedAts].sort((a, b) => b - a)
  let start = sorted[0]
  for (let i = 1; i < sorted.length && start - sorted[i] < 30 * 60_000; i++) start = sorted[i]
  return start
}

// ---------- Grid geometry & virtualization ----------

export interface GridLayout {
  cols: number
  tileW: number
  tileH: number
  /** Row pitch: tile height + gap. */
  rowH: number
  gap: number
}

/**
 * Fit as many columns of at least `minTile` px as the width allows (or exactly
 * `cols`), stretching tiles to fill the row. `tileHeight` maps width → height.
 */
export function gridLayout(width: number, opts: { minTile?: number; cols?: number; gap: number; tileHeight: (w: number) => number }): GridLayout {
  const { gap } = opts
  const cols = Math.max(1, opts.cols ?? Math.floor((width + gap) / ((opts.minTile ?? 160) + gap)))
  const tileW = Math.max(1, (width - gap * (cols - 1)) / cols)
  const tileH = opts.tileHeight(tileW)
  return { cols, tileW, tileH, rowH: tileH + gap, gap }
}

/** Rows [start, end) to render for a viewport, with `overscan` extra rows on each side. */
export function visibleRows(scrollTop: number, viewportH: number, rowH: number, rowCount: number, overscan = 2): { start: number; end: number } {
  if (rowCount === 0 || rowH <= 0) return { start: 0, end: 0 }
  const first = Math.floor(Math.max(0, scrollTop) / rowH)
  const last = Math.ceil((Math.max(0, scrollTop) + viewportH) / rowH)
  return { start: Math.max(0, first - overscan), end: Math.min(rowCount, last + overscan) }
}

/** The scrollTop that brings row `row` fully into view (unchanged if it already is). */
export function scrollToRow(row: number, scrollTop: number, viewportH: number, layout: GridLayout, offset = 0, pad = 8): number {
  const top = offset + row * layout.rowH
  const bottom = top + layout.tileH
  if (top - pad < scrollTop) return Math.max(0, top - pad)
  if (bottom + pad > scrollTop + viewportH) return bottom + pad - viewportH
  return scrollTop
}

// ---------- Selection ----------

export interface Selection {
  ids: ReadonlySet<string>
  /** The photo the info panel shows and the keyboard moves from. */
  focus: string | null
  /** Where a Shift-range starts. */
  anchor: string | null
}

export const EMPTY_SELECTION: Selection = { ids: new Set(), focus: null, anchor: null }

function range(order: readonly string[], a: string, b: string): string[] {
  const i = order.indexOf(a)
  const j = order.indexOf(b)
  if (i < 0 || j < 0) return [b]
  return order.slice(Math.min(i, j), Math.max(i, j) + 1)
}

/** Click: select one · Cmd/Ctrl (toggle): add/remove · Shift (range): from the anchor, added to the selection when toggling too. */
export function clickSelect(sel: Selection, id: string, order: readonly string[], mods: { toggle?: boolean; range?: boolean }): Selection {
  if (mods.range && sel.anchor) {
    const span = range(order, sel.anchor, id)
    const ids = new Set(mods.toggle ? sel.ids : [])
    span.forEach((x) => ids.add(x))
    return { ids, focus: id, anchor: sel.anchor }
  }
  if (mods.toggle) {
    const ids = new Set(sel.ids)
    if (ids.has(id)) ids.delete(id)
    else ids.add(id)
    return { ids, focus: id, anchor: id }
  }
  return { ids: new Set([id]), focus: id, anchor: id }
}

export type Move = 'left' | 'right' | 'up' | 'down' | 'home' | 'end'

/** Arrow keys: move the focus (selecting it); with Shift, extend the range from the anchor. */
export function moveSelect(sel: Selection, order: readonly string[], cols: number, move: Move, extend: boolean): Selection {
  if (order.length === 0) return sel
  const cur = sel.focus ? order.indexOf(sel.focus) : -1
  let next: number
  if (cur < 0) next = move === 'end' ? order.length - 1 : 0
  else {
    const delta = { left: -1, right: 1, up: -cols, down: cols, home: -Infinity, end: Infinity }[move]
    next = Math.min(order.length - 1, Math.max(0, cur + delta))
    // Up/down at the edge with no full row to go to: stay put rather than jump sideways.
    if ((move === 'up' || move === 'down') && Math.abs(next - cur) < cols) next = cur
  }
  const id = order[next]
  if (extend && sel.anchor) return { ids: new Set(range(order, sel.anchor, id)), focus: id, anchor: sel.anchor }
  return { ids: new Set([id]), focus: id, anchor: id }
}

export function selectAll(order: readonly string[], sel: Selection): Selection {
  return { ids: new Set(order), focus: sel.focus ?? order[0] ?? null, anchor: sel.anchor ?? order[0] ?? null }
}

/** The selected photos that are still visible, in grid order; the focused one if nothing is selected. */
export function effectiveSelection(sel: Selection, order: readonly string[]): string[] {
  const picked = order.filter((id) => sel.ids.has(id))
  if (picked.length) return picked
  return sel.focus && order.includes(sel.focus) ? [sel.focus] : []
}

// ---------- Keyboard ----------

export type Command =
  | { type: 'move'; move: Move; extend: boolean }
  | { type: 'rate'; value: number }
  | { type: 'flag'; value: -1 | 0 | 1 }
  | { type: 'open' }
  | { type: 'delete' }
  | { type: 'selectAll' }
  | { type: 'clear' }
  | { type: 'copy' }
  | { type: 'paste' }

export interface KeyLike {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}

const MOVES: Record<string, Move> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', Home: 'home', End: 'end' }

/** Library shortcuts. `mac` decides whether ⌘ or Ctrl is the command key. */
export function keyCommand(e: KeyLike, mac: boolean): Command | null {
  const mod = mac ? e.metaKey : e.ctrlKey
  const other = mac ? e.ctrlKey : e.metaKey
  if (e.altKey || other) return null
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
  if (mod) {
    if (e.shiftKey) return null
    if (k === 'a') return { type: 'selectAll' }
    if (k === 'c') return { type: 'copy' }
    if (k === 'v') return { type: 'paste' }
    if (k === 'Backspace') return { type: 'delete' }
    return null
  }
  if (k in MOVES) return { type: 'move', move: MOVES[k], extend: e.shiftKey }
  if (e.shiftKey) return null
  if (/^[0-5]$/.test(k)) return { type: 'rate', value: Number(k) }
  if (k === 'p') return { type: 'flag', value: 1 }
  if (k === 'x') return { type: 'flag', value: -1 }
  if (k === 'u') return { type: 'flag', value: 0 }
  if (k === 'Enter') return { type: 'open' }
  if (k === 'Delete' || k === 'Backspace') return { type: 'delete' }
  if (k === 'Escape') return { type: 'clear' }
  return null
}

// ---------- Formatting ----------

export function extOf(fileName: string): string {
  const i = fileName.lastIndexOf('.')
  return i > 0 ? fileName.slice(i + 1).toUpperCase() : ''
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 MB'
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)} TB`
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)} GB`
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)} MB`
  return `${Math.max(1, Math.round(n / 1e3))} KB`
}

/** Fractions below 0.4 s like cameras show them ("1/320 s"), longer ones in seconds ("0.5 s", "2.5 s"). */
export function formatShutter(s: number): string {
  if (s >= 0.4) return `${Number(s.toFixed(1))} s`
  return `1/${Math.round(1 / s)} s`
}

const trim = (n: number, dp = 1) => String(Number(n.toFixed(dp)))

/** "ISO 100 · 1/320 s · ƒ/8 · 35 mm" (missing parts left out; each part stays on one line). */
export function formatExposure(m: PhotoRecord['meta']): string {
  const parts: string[] = []
  if (m.iso) parts.push(`ISO ${m.iso}`)
  if (m.shutter) parts.push(formatShutter(m.shutter))
  if (m.aperture) parts.push(`ƒ/${trim(m.aperture)}`)
  if (m.focalLength) parts.push(`${trim(m.focalLength, 0)} mm`)
  return parts.map((p) => p.replace(/ /g, '\u00a0')).join(' · ')
}

/** Camera name without the maker repeated ("Canon" + "Canon EOS R5" → "Canon EOS R5"). */
export function formatCamera(m: PhotoRecord['meta']): string {
  const make = (m.make ?? '').trim()
  const model = (m.model ?? '').trim()
  if (!model) return make
  const brand = make.split(/\s+/)[0]?.toLowerCase() ?? ''
  if (!brand || model.toLowerCase().startsWith(brand)) return model
  return `${make.replace(/\s+(corporation|corp\.?|co\.?,? ?ltd\.?|imaging|camera ab)$/i, '')} ${model}`
}

export function formatMegapixels(w: number, h: number): string {
  const mp = (w * h) / 1e6
  return `${mp >= 10 ? Math.round(mp) : trim(mp)} MP`
}

export function formatDimensions(w: number, h: number): string {
  return `${w.toLocaleString('en-US')} × ${h.toLocaleString('en-US')}`
}

/** "Sep 14, 2026 · 18:42" in the viewer's locale. */
export function formatTaken(ms: number, locale?: string): string {
  const d = new Date(ms)
  const date = d.toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' })
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  return `${date} · ${time}`
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

/** "Imported 22 photos · 2 skipped (already in your library) · 1 note · 3 other files ignored". */
export function importSummary(added: number, skipped: readonly { reason: string }[], notices: readonly unknown[], ignored: number, cancelled: boolean): string {
  const parts = [cancelled ? `Import stopped after ${plural(added, 'photo')}` : added ? `Imported ${plural(added, 'photo')}` : 'No photos imported']
  if (skipped.length) {
    const reasons = new Map<string, number>()
    for (const s of skipped) {
      const r = s.reason.charAt(0).toLowerCase() + s.reason.slice(1)
      reasons.set(r, (reasons.get(r) ?? 0) + 1)
    }
    const top = [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 2)
    const why = top.map(([r, n]) => (reasons.size > 1 ? `${n} ${r}` : r)).join(', ') + (reasons.size > 2 ? ', …' : '')
    parts.push(`${skipped.length.toLocaleString('en-US')} skipped (${why})`)
  }
  if (notices.length) parts.push(plural(notices.length, 'note'))
  if (ignored) parts.push(`${plural(ignored, 'other file')} ignored`)
  return parts.join(' · ')
}
