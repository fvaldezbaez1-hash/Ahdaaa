import { useLayoutEffect, useState, type HTMLAttributes, type ReactNode } from 'react'
import { visibleRows, type GridLayout } from './library'

export interface TileBox {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Renders only the rows inside the scroller's viewport (plus `overscan`), so
 * the DOM stays small however many photos there are. The scroller must be the
 * grid's offsetParent (position: relative) so offsetTop is measured from it.
 */
export function VirtualGrid({
  grid,
  gridRef,
  scroller,
  layout,
  count,
  render,
  overscan = 3,
  style,
  ...rest
}: {
  grid: HTMLDivElement | null
  gridRef: (el: HTMLDivElement | null) => void
  scroller: HTMLElement | null
  layout: GridLayout
  count: number
  render: (index: number, box: TileBox) => ReactNode
  overscan?: number
} & HTMLAttributes<HTMLDivElement>) {
  const rows = Math.ceil(count / layout.cols)
  const [win, setWin] = useState({ start: 0, end: 0 })

  useLayoutEffect(() => {
    if (!scroller || !grid) return
    const update = () => {
      const r = visibleRows(scroller.scrollTop - grid.offsetTop, scroller.clientHeight, layout.rowH, rows, overscan)
      setWin((w) => (w.start === r.start && w.end === r.end ? w : r))
    }
    update()
    scroller.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(scroller)
    return () => {
      scroller.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [scroller, grid, layout.rowH, rows, overscan])

  const items: ReactNode[] = []
  for (let r = win.start; r < Math.min(win.end, rows); r++) {
    for (let c = 0; c < layout.cols; c++) {
      const i = r * layout.cols + c
      if (i >= count) break
      items.push(render(i, { x: c * (layout.tileW + layout.gap), y: r * layout.rowH, w: layout.tileW, h: layout.tileH }))
    }
  }
  return (
    <div ref={gridRef} className="vgrid" style={{ ...style, height: Math.max(0, rows * layout.rowH - layout.gap) }} {...rest}>
      {items}
    </div>
  )
}
