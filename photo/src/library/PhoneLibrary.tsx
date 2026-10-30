import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { navigate } from '../router'
import { updateSettings, useSettings } from '../state/settings'
import { Icon, type IconName } from '../ui/Icon'
import { Segmented, Spinner } from '../ui/controls'
import { useElementSize } from '../ui/hooks'
import { pasteEdits } from './actions'
import { useImport } from './importer'
import { useLongPress } from './longPress'
import { EMPTY_SELECTION, clickSelect, gridLayout, plural, selectAll } from './library'
import { PhoneTile } from './Tiles'
import { memory, type Library, type LibrarySheet } from './useLibrary'
import { VirtualGrid } from './VirtualGrid'

type Filter = 'all' | 'picks' | 'stars' | 'edited'
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'picks', label: 'Picks' },
  { value: 'stars', label: '★ 4+' },
  { value: 'edited', label: 'Edited' },
]

export function PhoneLibrary({ lib, open }: { lib: Library; open: (s: LibrarySheet) => void }) {
  const settings = useSettings()
  const dark = settings?.theme !== 'light'
  const imp = useImport()
  const [selecting, setSelecting] = useState(false)
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null)
  // Imperative scrolling goes through a ref; state only tells the grid which element to watch.
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const scrollerCallback = useCallback((el: HTMLDivElement | null) => {
    scrollerRef.current = el
    setScroller(el)
  }, [])
  const [grid, setGrid] = useState<HTMLDivElement | null>(null)
  const { width } = useElementSize(grid)
  const layout = useMemo(() => gridLayout(width, { cols: 3, gap: 4, tileHeight: (w) => w }), [width])
  const { view, minRating, sel, setSel, visible, order, selected } = lib

  const filter: Filter | 'other' = minRating === 4 && view === 'all' ? 'stars' : minRating ? 'other' : view === 'all' || view === 'picks' || view === 'edited' ? view : 'other'
  const setFilter = (f: Filter) => {
    lib.setView(f === 'picks' || f === 'edited' ? f : 'all')
    lib.setMinRating(f === 'stars' ? 4 : 0)
  }

  const viewKey = `phone|${view}|${minRating}`
  const measured = width > 0
  useLayoutEffect(() => {
    if (scrollerRef.current && measured) scrollerRef.current.scrollTop = memory.scroll[viewKey] ?? 0
  }, [scroller, viewKey, measured])

  const startSelecting = (first?: string) => {
    setSelecting(true)
    setSel(first ? { ids: new Set([first]), focus: first, anchor: first } : EMPTY_SELECTION)
  }
  const stopSelecting = () => {
    setSelecting(false)
    setSel(EMPTY_SELECTION)
  }

  const longPress = useLongPress((id) => {
    if (selecting) setSel(clickSelect(sel, id, order, { toggle: true }))
    else startSelecting(id)
  }, true)
  const onClick = (e: React.MouseEvent) => {
    // The click that ends a long press only finishes the gesture.
    if (longPress.consumeClick()) return
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-id]')?.dataset.id
    if (!id) return
    if (selecting) setSel(clickSelect(sel, id, order, { toggle: true }))
    else navigate(`/edit/${encodeURIComponent(id)}`)
  }

  const title = filter === 'stars' ? '4 stars and up' : lib.title
  const n = selected.length

  return (
    <div className="plib">
      <header className="plib-head">
        {selecting ? (
          <div className="plib-title">
            <button type="button" className="btn ghost lg" onClick={stopSelecting}>
              Cancel
            </button>
            <div className="grow sel-title" aria-live="polite">
              {n ? `${n.toLocaleString('en-US')} selected` : 'Select photos'}
            </div>
            <button type="button" className="btn ghost lg" onClick={() => (n === order.length ? setSel(EMPTY_SELECTION) : setSel(selectAll(order, sel)))}>
              {n === order.length && n > 0 ? 'None' : 'All'}
            </button>
          </div>
        ) : (
          <div className="plib-title">
            <h1>Library</h1>
            <button type="button" className="btn ghost lg" onClick={() => startSelecting()} disabled={!order.length}>
              Select
            </button>
            <button
              type="button"
              className="icon-btn lg"
              aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
              onClick={() => void updateSettings({ theme: dark ? 'light' : 'dark' })}
            >
              <Icon name={dark ? 'sun' : 'moon'} size={19} />
            </button>
            <button type="button" className="icon-btn lg accent" aria-label="Import photos" onClick={() => open({ type: 'import' })}>
              <Icon name="plus" size={20} />
            </button>
          </div>
        )}
        <Segmented className="plib-seg" label="Filter" value={filter as Filter} options={FILTERS} onChange={setFilter} />
        {lib.albums.length > 0 && (
          <div className="chips no-scrollbar" role="group" aria-label="Albums">
            {lib.albums.map((a) => {
              const on = view === `album:${a.id}`
              return (
                <button key={a.id} type="button" className={on ? 'chip on' : 'chip'} aria-pressed={on} onClick={() => lib.setView(on ? 'all' : `album:${a.id}`)}>
                  <Icon name="album" size={14} />
                  {a.name}
                </button>
              )
            })}
          </div>
        )}
        {imp.running && imp.progress && (
          <button type="button" className="lib-progress-chip" onClick={() => open({ type: 'import' })}>
            <Spinner label="Importing" />
            Importing {Math.min(imp.progress.done + 1, imp.progress.total)} of {imp.progress.total}
          </button>
        )}
      </header>

      <div
        ref={scrollerCallback}
        className={selecting ? 'plib-scroll no-scrollbar with-batch' : 'plib-scroll no-scrollbar'}
        onScroll={(e) => {
          memory.scroll[viewKey] = e.currentTarget.scrollTop
        }}
      >
        <div className="plib-section">
          <h2>{title}</h2>
          <span className="muted small tnum">{plural(visible.length, 'photo')}</span>
        </div>
        {visible.length ? (
          <VirtualGrid
            grid={grid}
            gridRef={setGrid}
            scroller={scroller}
            layout={layout}
            count={visible.length}
            overscan={4}
            role="list"
            aria-label={`${title}: ${plural(visible.length, 'photo')}`}
            {...longPress.handlers}
            onClick={onClick}
            render={(i, box) => {
              const p = visible[i]
              return <PhoneTile key={p.id} photo={p} box={box} index={i} total={visible.length} selected={selecting && sel.ids.has(p.id)} selecting={selecting} />
            }}
          />
        ) : (
          <div className="lib-empty">
            {imp.running ? <Spinner label="Importing" /> : <Icon name="image" size={30} />}
            {imp.running ? 'Importing your photos…' : lib.album ? 'This album is empty.' : 'No photos here yet.'}
          </div>
        )}
        <div className="privacy-card">
          <Icon name="lock" size={20} />
          <div>
            <b>Private by design</b>
            <span>Originals stay on this phone. RAW from Files, JPEG and HEIC from Photos.</span>
          </div>
        </div>
      </div>

      {selecting && (
        <div className="plib-batch" role="toolbar" aria-label="Selected photos">
          <PhoneAction icon="presets" label="Preset" disabled={!n} onClick={() => open({ type: 'preset', ids: selected })} />
          <PhoneAction icon="paste" label="Paste" disabled={!n} onClick={() => void pasteEdits(selected)} />
          <PhoneAction icon="album" label="Album" disabled={!n} onClick={() => open({ type: 'album', ids: selected })} />
          <PhoneAction icon="share" label="Export" disabled={!n} onClick={() => open({ type: 'export', ids: selected })} />
          <PhoneAction icon="trash" label="Delete" danger disabled={!n} onClick={() => open({ type: 'delete', ids: selected })} />
          <PhoneAction icon="more" label="More" disabled={!n} onClick={() => open({ type: 'more', ids: selected })} />
        </div>
      )}
    </div>
  )
}

function PhoneAction({ icon, label, danger, disabled, onClick }: { icon: IconName; label: string; danger?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" className={danger ? 'danger' : undefined} disabled={disabled} onClick={onClick}>
      <Icon name={icon} size={21} />
      {label}
    </button>
  )
}
