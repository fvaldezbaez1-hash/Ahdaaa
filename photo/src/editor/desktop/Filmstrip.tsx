import { useEffect, useMemo, useRef, useState } from 'react'
import { PhotoThumb } from '../../ui/PhotoThumb'
import { openPhoto, type StripItem } from '../photos'

const H = 64
const GAP = 8
const PAD = 14
/** Render this far beyond the visible part so fast scrolling doesn't show gaps. */
const OVERSCAN = 600

/** The library as a strip of thumbnails; only the visible ones are mounted. */
export function Filmstrip({ order, current }: { order: StripItem[]; current: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [range, setRange] = useState({ left: 0, width: 2000 })
  const layout = useMemo(() => {
    const items: (StripItem & { x: number; w: number })[] = []
    for (const p of order) {
      const prev = items[items.length - 1]
      items.push({ ...p, x: prev ? prev.x + prev.w + GAP : PAD, w: Math.round(H * Math.min(1.8, Math.max(0.6, p.ratio))) })
    }
    const last = items[items.length - 1]
    return { items, width: last ? last.x + last.w + PAD : 0 }
  }, [order])

  const measure = () => {
    const el = ref.current
    if (el) setRange({ left: el.scrollLeft, width: el.clientWidth })
  }

  // Keep the current photo in view.
  useEffect(() => {
    const el = ref.current
    const it = layout.items.find((p) => p.id === current)
    if (!el || !it) return
    if (it.x < el.scrollLeft || it.x + it.w > el.scrollLeft + el.clientWidth) el.scrollLeft = it.x - el.clientWidth / 2 + it.w / 2
    measure()
  }, [current, layout])

  const visible = layout.items.filter((p) => p.x + p.w > range.left - OVERSCAN && p.x < range.left + range.width + OVERSCAN)
  return (
    <div ref={ref} className="ed-strip scroll" aria-label="Filmstrip" role="list" onScroll={measure}>
      <div className="ed-strip-track" style={{ width: layout.width }}>
        {visible.map((p) => (
          <div role="listitem" key={p.id} className="ed-strip-item" style={{ left: p.x, width: p.w }}>
            <button
              type="button"
              className={p.id === current ? 'ed-strip-thumb current' : 'ed-strip-thumb'}
              aria-current={p.id === current ? 'true' : undefined}
              aria-label={`Open ${p.name}`}
              title={p.name}
              onClick={() => p.id !== current && openPhoto(p.id)}
            >
              <PhotoThumb id={p.id} />
              {p.edited && <span className="ed-edited" aria-hidden="true" />}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
