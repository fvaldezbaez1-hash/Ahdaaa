import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { curveLut, IDENTITY_CURVE, normalizeCurve, type CurvePoint } from '../../color/curve'
import type { ToneCurve as Curves } from '../../edit/types'
import { editor, useEditor } from '../../state/editor'
import { insertPoint, movePoint, nearestPoint, removePoint } from '../math/curve'
import { useView } from '../view'

type Channel = keyof Curves
const CHANNELS: { id: Channel; label: string; color: string }[] = [
  { id: 'rgb', label: 'RGB', color: 'var(--text)' },
  { id: 'r', label: 'Red', color: '#e5484d' },
  { id: 'g', label: 'Green', color: '#30a46c' },
  { id: 'b', label: 'Blue', color: '#3e7bfa' },
]
const S = 256
/** Dragging a point this far outside the graph removes it. */
const OUT = 0.08

const toPath = (lut: Float32Array) => Array.from(lut, (y, i) => `${i ? 'L' : 'M'}${((i / (lut.length - 1)) * S).toFixed(1)} ${((1 - y) * S).toFixed(1)}`).join('')

function histPath(bins: Uint32Array | undefined): string {
  if (!bins) return ''
  let max = 1
  for (let i = 2; i < 254; i++) max = Math.max(max, bins[i])
  let d = `M0 ${S}`
  for (let i = 0; i < 256; i++) d += `L${(i / 255) * S} ${S - Math.min(1, bins[i] / max) * S * 0.9}`
  return `${d}L${S} ${S}Z`
}

/**
 * Point curve editor: click to add a point on the curve, drag to shape it,
 * drag it off the graph or double-click to remove it. Points take arrow keys
 * (Shift = ×10) and Delete.
 */
export function ToneCurve() {
  const [ch, setCh] = useState<Channel>('rgb')
  const stored = useEditor((s) => s.recipe?.curve[ch])
  const points = useMemo(() => normalizeCurve(stored ?? IDENTITY_CURVE), [stored])
  const hist = useView((s) => s.histogram)
  const [active, setActive] = useState(-1)
  const drag = useRef<{ pts: CurvePoint[]; i: number; removed: boolean } | null>(null)
  const color = CHANNELS.find((c) => c.id === ch)!.color

  const write = (pts: CurvePoint[]) => editor.preview((r) => ({ ...r, curve: { ...r.curve, [ch]: pts } }))
  const unit = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: (e.clientX - r.left) / r.width, y: 1 - (e.clientY - r.top) / r.height, px: r.width }
  }

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return
    const u = unit(e)
    const reach = (e.pointerType === 'mouse' ? 10 : 22) / u.px
    let i = nearestPoint(points, u.x, u.y, reach)
    let pts = points
    if (i < 0) {
      const added = insertPoint(points, u.x)
      if (added.index < 0) return
      ;({ points: pts, index: i } = added)
      write(pts)
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { pts, i, removed: false }
    setActive(i)
  }
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current
    if (!d) return
    const u = unit(e)
    const inner = d.i > 0 && d.i < d.pts.length - 1
    const outside = u.x < -OUT || u.x > 1 + OUT || u.y < -OUT || u.y > 1 + OUT
    if (inner && outside) {
      if (!d.removed) write(removePoint(d.pts, d.i))
      d.removed = true
      return
    }
    d.removed = false
    d.pts = movePoint(d.pts, d.i, u.x, u.y)
    write(d.pts)
  }
  const onPointerUp = () => {
    const d = drag.current
    if (!d) return
    drag.current = null
    if (d.removed) setActive(-1)
    editor.commit(d.removed ? 'Curve point removed' : 'Tone curve')
  }

  const remove = (i: number) => {
    if (i <= 0 || i >= points.length - 1) return
    editor.apply((r) => ({ ...r, curve: { ...r.curve, [ch]: removePoint(points, i) } }), 'Curve point removed')
    setActive(-1)
  }
  const onKey = (e: KeyboardEvent<SVGCircleElement>, i: number) => {
    const step = (e.shiftKey ? 10 : 1) / 255
    const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }
    if (e.key in d) {
      e.preventDefault()
      write(movePoint(points, i, points[i].x + d[e.key][0], points[i].y + d[e.key][1]))
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      remove(i)
    }
  }

  const lut = useMemo(() => curveLut(points, 128), [points])
  const shown = active >= 0 && active < points.length ? points[active] : null
  const hBins = hist ? (ch === 'rgb' ? hist.luma : hist[ch]) : undefined

  return (
    <div className="stack tight">
      <div className="row between">
        <div className="ed-channels" role="radiogroup" aria-label="Curve channel">
          {CHANNELS.map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={ch === c.id}
              aria-label={c.label}
              title={c.label}
              className="ed-channel"
              style={{ background: c.color }}
              onClick={() => {
                setCh(c.id)
                setActive(-1)
              }}
            />
          ))}
        </div>
        <span className="muted small tnum" aria-live="polite">
          {shown ? `In ${Math.round(shown.x * 255)} · Out ${Math.round(shown.y * 255)}` : 'Click to add a point'}
        </span>
      </div>
      <svg
        className="ed-curve"
        viewBox={`0 0 ${S} ${S}`}
        role="group"
        aria-label={`${CHANNELS.find((c) => c.id === ch)!.label} tone curve`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <path d={histPath(hBins)} className="ed-curve-hist" style={{ fill: ch === 'rgb' ? 'var(--text-3)' : color }} />
        <path d={`M${S / 4} 0V${S}M${S / 2} 0V${S}M${(3 * S) / 4} 0V${S}M0 ${S / 4}H${S}M0 ${S / 2}H${S}M0 ${(3 * S) / 4}H${S}`} className="ed-curve-grid" />
        <path d={`M0 ${S}L${S} 0`} className="ed-curve-grid" strokeDasharray="4 4" />
        <path d={toPath(lut)} className="ed-curve-line" style={{ stroke: color }} />
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x * S}
            cy={(1 - p.y) * S}
            r={i === active ? 6 : 4.5}
            className="ed-curve-pt"
            style={{ stroke: color }}
            tabIndex={0}
            role="slider"
            aria-label={`Point ${i + 1}`}
            aria-valuemin={0}
            aria-valuemax={255}
            aria-valuenow={Math.round(p.y * 255)}
            aria-valuetext={`Input ${Math.round(p.x * 255)}, output ${Math.round(p.y * 255)}`}
            onFocus={() => setActive(i)}
            onKeyDown={(e) => onKey(e, i)}
            onKeyUp={(e) => e.key.startsWith('Arrow') && editor.commit('Tone curve')}
            onDoubleClick={() => remove(i)}
          />
        ))}
      </svg>
    </div>
  )
}
