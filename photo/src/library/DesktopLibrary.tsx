import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { navigate } from '../router'
import { Icon } from '../ui/Icon'
import { Segmented, Spinner } from '../ui/controls'
import { isTyping, useElementSize } from '../ui/hooks'
import { toast } from '../ui/toast'
import { copyEdits, pasteEdits, removeFromAlbum, setFlag, setRating } from './actions'
import { InfoPanel } from './InfoPanel'
import { useImport } from './importer'
import { useLongPress } from './longPress'
import { EMPTY_SELECTION, SORTS, clickSelect, gridLayout, keyCommand, moveSelect, plural, scrollToRow, selectAll, type MinRating, type SortKey } from './library'
import { isApple } from './platform'
import { usePref } from './prefs'
import { Sidebar } from './Sidebar'
import { DesktopTile } from './Tiles'
import { memory, type Library, type LibrarySheet } from './useLibrary'
import { VirtualGrid } from './VirtualGrid'

/** Height of the rating/flag row under each thumbnail. */
const META_H = 37
const RATINGS = [
  { value: '0', label: 'All' },
  { value: '3', label: '★ 3+', title: '3 stars and up' },
  { value: '4', label: '★ 4+', title: '4 stars and up' },
  { value: '5', label: '★ 5', title: '5 stars' },
]
const isSize = (v: unknown) => typeof v === 'number' && v >= 120 && v <= 360
const FLAG_WORDS = { 1: 'Picked', 0: 'Unflagged', [-1]: 'Rejected' } as const

const editPhoto = (id: string) => navigate(`/edit/${encodeURIComponent(id)}`)

export function DesktopLibrary({ lib, open, onImportFolder }: { lib: Library; open: (s: LibrarySheet) => void; onImportFolder: () => void }) {
  const imp = useImport()
  const [size, setSize] = usePref('tileSize', 190, isSize)
  const [infoOpen, setInfoOpen] = usePref('info', matchMedia('(min-width: 1200px)').matches)
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null)
  // Imperative scrolling goes through a ref; state only tells the grid which element to watch.
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const scrollerCallback = useCallback((el: HTMLDivElement | null) => {
    scrollerRef.current = el
    setScroller(el)
  }, [])
  const [grid, setGrid] = useState<HTMLDivElement | null>(null)
  const { width } = useElementSize(grid)
  const layout = useMemo(() => gridLayout(width, { minTile: size, gap: 12, tileHeight: (w) => Math.round((w * 2) / 3) + META_H }), [width, size])
  const pendingFocus = useRef<string | null>(null)
  const { order, sel, setSel, visible, targets } = lib

  // Come back to the same scroll position per view (e.g. after editing a photo).
  const viewKey = `${lib.view}|${lib.sort}|${lib.minRating}`
  const measured = width > 0
  useLayoutEffect(() => {
    if (scrollerRef.current && measured) scrollerRef.current.scrollTop = memory.scroll[viewKey] ?? 0
  }, [scroller, viewKey, measured])

  // Move DOM focus to a tile once the virtual grid has rendered it.
  useLayoutEffect(() => {
    const id = pendingFocus.current
    if (!id || !grid) return
    const el = grid.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"] .tile-media`)
    if (el) {
      el.focus({ preventScroll: true })
      pendingFocus.current = null
    }
  })

  const reveal = (id: string) => {
    const i = order.indexOf(id)
    const el = scrollerRef.current
    if (i < 0 || !el || !grid) return
    el.scrollTop = scrollToRow(Math.floor(i / layout.cols), el.scrollTop, el.clientHeight, layout, grid.offsetTop)
    pendingFocus.current = id
  }

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.defaultPrevented || isTyping(e) || document.querySelector('.sheet-backdrop')) return
    const cmd = keyCommand(e, isApple)
    if (!cmd) return
    const t = e.target as HTMLElement
    const inGrid = t === document.body || !!grid?.contains(t)
    switch (cmd.type) {
      case 'move': {
        if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement) return
        e.preventDefault()
        const next = moveSelect(sel, order, layout.cols, cmd.move, cmd.extend)
        setSel(next)
        if (next.focus) reveal(next.focus)
        return
      }
      case 'open':
        if (!inGrid || !lib.focused) return
        e.preventDefault()
        editPhoto(lib.focused.id)
        return
      case 'selectAll':
        e.preventDefault()
        setSel(selectAll(order, sel))
        return
      case 'clear':
        setSel({ ...EMPTY_SELECTION, focus: sel.focus, anchor: sel.focus })
        return
      case 'copy':
        if (window.getSelection()?.toString() || !lib.focused) return
        e.preventDefault()
        void copyEdits(lib.focused)
        return
    }
    if (!targets.length) return
    e.preventDefault()
    if (cmd.type === 'rate') {
      void setRating(targets, cmd.value)
      if (targets.length > 1) toast(`${cmd.value ? '★'.repeat(cmd.value) : 'No stars'} · ${plural(targets.length, 'photo')}`)
    } else if (cmd.type === 'flag') {
      void setFlag(targets, cmd.value)
      if (targets.length > 1) toast(`${FLAG_WORDS[cmd.value]} · ${plural(targets.length, 'photo')}`)
    } else if (cmd.type === 'paste') void pasteEdits(targets)
    else if (cmd.type === 'delete') open({ type: 'delete', ids: targets })
  })
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  // Touch screens in this layout (iPad) have no ⌘ key: press and hold adds a photo to the selection.
  const longPress = useLongPress((id) => setSel(clickSelect(sel, id, order, { toggle: true })))

  const onGridClick = (e: React.MouseEvent) => {
    if (longPress.consumeClick()) return
    const t = e.target as HTMLElement
    const act = t.closest<HTMLElement>('[data-act]')?.dataset
    const id = t.closest<HTMLElement>('[data-id]')?.dataset.id
    const p = id ? lib.byId.get(id) : undefined
    if (!act || !p) return
    if (act.act === 'star') {
      const n = Number(act.n)
      void setRating([p.id], p.rating === n ? 0 : n)
    } else if (act.act === 'flag') void setFlag([p.id], p.flag === 0 ? 1 : 0)
    else if (act.act === 'select') setSel(clickSelect(sel, p.id, order, { toggle: e.metaKey || e.ctrlKey, range: e.shiftKey }))
  }
  const onGridDoubleClick = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement
    const id = t.closest('[data-act="select"]') && t.closest<HTMLElement>('[data-id]')?.dataset.id
    if (id) editPhoto(id)
  }

  const selected = lib.selected
  const tabId = lib.focused?.id ?? order[0]
  const clearFilters = () => {
    lib.setView('all')
    lib.setMinRating(0)
    lib.setSearch('')
  }

  return (
    <div className="lib">
      <Sidebar lib={lib} open={open} onImportFolder={onImportFolder} />
      <main className="lib-main" aria-label={lib.title}>
        <div className="lib-toolbar">
          <div className="lib-title">
            <h1 className="ellipsis">{lib.title}</h1>
            <div className="muted small tnum">{lib.countText}</div>
          </div>
          {imp.running && imp.progress && (
            <button type="button" className="lib-progress-chip" onClick={() => open({ type: 'import' })}>
              <Spinner label="Importing" />
              Importing {Math.min(imp.progress.done + 1, imp.progress.total)} of {imp.progress.total}
            </button>
          )}
          <Segmented label="Minimum rating" value={String(lib.minRating)} options={RATINGS} onChange={(v) => lib.setMinRating(Number(v) as MinRating)} />
          <label className="lib-sort">
            Sort
            <select className="lib-select" value={lib.sort} onChange={(e) => lib.setSort(e.target.value as SortKey)}>
              {SORTS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="lib-size" title="Thumbnail size">
            <Icon name="image" size={15} />
            <span className="sr-only">Thumbnail size</span>
            <input type="range" className="range" min={120} max={360} step={10} value={size} onChange={(e) => setSize(Number(e.target.value))} />
          </label>
          <button
            type="button"
            className={infoOpen ? 'icon-btn on' : 'icon-btn'}
            aria-pressed={infoOpen}
            aria-label="Photo info panel"
            title="Photo info"
            onClick={() => setInfoOpen(!infoOpen)}
          >
            <Icon name="info" />
          </button>
        </div>

        <div
          ref={scrollerCallback}
          className={selected.length ? 'lib-scroll scroll with-batch' : 'lib-scroll scroll'}
          onScroll={(e) => {
            memory.scroll[viewKey] = e.currentTarget.scrollTop
          }}
        >
          {visible.length ? (
            <VirtualGrid
              grid={grid}
              gridRef={setGrid}
              scroller={scroller}
              layout={layout}
              count={visible.length}
              role="list"
              aria-label={`${lib.title}: ${plural(visible.length, 'photo')}`}
              {...longPress.handlers}
              onClick={onGridClick}
              onDoubleClick={onGridDoubleClick}
              style={{ userSelect: 'none' }}
              render={(i, box) => {
                const p = visible[i]
                return (
                  <DesktopTile
                    key={p.id}
                    photo={p}
                    box={box}
                    index={i}
                    total={visible.length}
                    selected={sel.ids.has(p.id)}
                    focused={sel.focus === p.id}
                    tabbable={tabId === p.id}
                  />
                )
              }}
            />
          ) : imp.running ? (
            <div className="lib-empty">
              <Spinner label="Importing" />
              Importing your photos…
            </div>
          ) : lib.album && !lib.minRating && !lib.search ? (
            <div className="lib-empty">
              <Icon name="album" size={30} />
              <b>This album is empty</b>
              <span>Select photos in your library, then choose Add to album.</span>
            </div>
          ) : (
            <div className="lib-empty">
              <Icon name="search" size={30} />
              <b>No photos match these filters</b>
              <button type="button" className="btn outline" onClick={clearFilters}>
                Show all photos
              </button>
            </div>
          )}
        </div>

        {selected.length > 0 && (
          <div className="lib-batch" role="toolbar" aria-label="Selected photos">
            <span className="count">{selected.length.toLocaleString('en-US')} selected</span>
            <BatchButton icon="presets" label="Apply preset" onClick={() => open({ type: 'preset', ids: selected })} />
            <BatchButton icon="paste" label="Paste edits" onClick={() => void pasteEdits(selected)} />
            <BatchButton icon="undo" label="Reset edits" onClick={() => open({ type: 'reset', ids: selected })} />
            {lib.album ? (
              <BatchButton icon="minus" label="Remove from album" onClick={() => void removeFromAlbum(selected, lib.album!.id)} />
            ) : (
              <BatchButton icon="album" label="Add to album" onClick={() => open({ type: 'album', ids: selected })} />
            )}
            <BatchButton icon="download" label="Export" onClick={() => open({ type: 'export', ids: selected })} />
            <BatchButton icon="trash" label="Delete" danger onClick={() => open({ type: 'delete', ids: selected })} />
            <span className="sep" />
            <button
              type="button"
              className="icon-btn"
              aria-label="Clear selection"
              title="Clear selection (Esc)"
              onClick={() => setSel({ ...EMPTY_SELECTION, focus: sel.focus, anchor: sel.focus })}
            >
              <Icon name="x" />
            </button>
          </div>
        )}
      </main>
      {infoOpen && <InfoPanel photo={lib.focused} selectedCount={selected.length} albums={lib.albums} />}
    </div>
  )
}

function BatchButton({ icon, label, danger, onClick }: { icon: Parameters<typeof Icon>[0]['name']; label: string; danger?: boolean; onClick: () => void }) {
  return (
    <button type="button" className={danger ? 'btn ghost danger-text' : 'btn ghost'} aria-label={label} title={label} onClick={onClick}>
      <Icon name={icon} size={17} />
      <span className="lbl">{label}</span>
    </button>
  )
}
