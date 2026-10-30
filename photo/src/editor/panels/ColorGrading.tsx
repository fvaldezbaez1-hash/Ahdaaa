import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { Grading } from '../../edit/types'
import { editor, useEditor } from '../../state/editor'
import { Segmented } from '../../ui/controls'
import { hueSatToPoint, pointToHueSat, WHEEL_GRADIENT, wheelColor } from '../math/wheel'
import { RecipeSlider } from './RecipeSlider'

type Range = 'shadows' | 'midtones' | 'highlights' | 'global'
const RANGES: { value: Range; label: string }[] = [
  { value: 'shadows', label: 'Shadows' },
  { value: 'midtones', label: 'Midtones' },
  { value: 'highlights', label: 'Highlights' },
  { value: 'global', label: 'Global' },
]
const labelOf = (r: Range) => RANGES.find((x) => x.value === r)!.label
const FINE = 0.25

function setWheel(range: Range, hue: number, sat: number) {
  editor.preview((r) => ({ ...r, grading: { ...r.grading, [range]: { ...r.grading[range], hue, sat } } as Grading }))
}

/** Drag on the wheel: angle = hue, distance from the center = saturation. Alt/Option for fine control. */
function Wheel({ range, size }: { range: Range; size: number }) {
  const w = useEditor((s) => s.recipe?.grading[range])
  const drag = useRef<{ x: number; y: number; px: number; py: number; fine: boolean } | null>(null)
  if (!w) return null
  const R = size / 2
  const puck = hueSatToPoint(w.hue, w.sat, R)
  const label = labelOf(range)
  const commit = () => {
    const cur = editor.getState().recipe?.grading[range]
    editor.commit(cur && cur.sat ? `${label} color ${cur.hue}°, ${cur.sat}` : `${label} color`)
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    e.currentTarget.focus()
    const rect = e.currentTarget.getBoundingClientRect()
    drag.current = { x: e.clientX, y: e.clientY, px: puck.x, py: puck.y, fine: e.altKey }
    if (!e.altKey) {
      const hs = pointToHueSat(e.clientX - rect.left - R, e.clientY - rect.top - R, R)
      setWheel(range, hs.hue, hs.sat)
    }
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    const rect = e.currentTarget.getBoundingClientRect()
    const hs = d.fine
      ? pointToHueSat(d.px + (e.clientX - d.x) * FINE, d.py + (e.clientY - d.y) * FINE, R)
      : pointToHueSat(e.clientX - rect.left - R, e.clientY - rect.top - R, R)
    setWheel(range, hs.hue, hs.sat)
  }
  const onPointerUp = () => {
    if (!drag.current) return
    drag.current = null
    commit()
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 10 : 1
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }
    if (e.key in moves) {
      e.preventDefault()
      const [dh, ds] = moves[e.key]
      setWheel(range, (w.hue + dh + 360) % 360, Math.min(100, Math.max(0, w.sat + ds)))
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      setWheel(range, 0, 0)
      commit()
    }
  }

  return (
    <div
      className="ed-wheel"
      role="slider"
      tabIndex={0}
      aria-label={`${label} color`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={w.sat}
      aria-valuetext={w.sat ? `Hue ${w.hue}°, saturation ${w.sat}` : 'No tint'}
      aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Delete"
      title="Drag to tint · double-click to reset · Alt for fine control"
      style={{ width: size, height: size, background: `radial-gradient(circle closest-side, #8a8a8a, rgb(138 138 138 / 0)), ${WHEEL_GRADIENT}` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      onKeyUp={(e) => e.key.startsWith('Arrow') && commit()}
      onDoubleClick={() => editor.apply((r) => ({ ...r, grading: { ...r.grading, [range]: { ...r.grading[range], hue: 0, sat: 0 } } as Grading }), `Reset ${label} color`)}
    >
      <span className="ed-puck" style={{ transform: `translate(${R + puck.x}px, ${R + puck.y}px)`, background: w.sat ? wheelColor(w.hue, w.sat) : '#fff' }} />
    </div>
  )
}

function Readout({ range }: { range: Range }) {
  const hue = useEditor((s) => s.recipe?.grading[range].hue ?? 0)
  const sat = useEditor((s) => s.recipe?.grading[range].sat ?? 0)
  return <span className="muted small tnum">{sat ? `${hue}° · ${sat}` : 'No tint'}</span>
}

function RangeControls({ range, size }: { range: Range; size: number }) {
  const label = labelOf(range)
  return (
    <div className="ed-wheel-cell">
      <div className="row between">
        <span className="ed-wheel-label">{label}</span>
        <Readout range={range} />
      </div>
      <Wheel range={range} size={size} />
      <RecipeSlider path={`grading.${range}.lum`} label="Luminance" history={`${label} luminance`} />
    </div>
  )
}

/** Shadows / midtones / highlights / global tint wheels. 'grid' shows all four; 'single' one at a time (phones). */
export function ColorGrading({ layout }: { layout: 'grid' | 'single' }) {
  const [range, setRange] = useState<Range>('midtones')
  return (
    <div className="stack tight">
      {layout === 'grid' ? (
        <div className="ed-wheels">
          {RANGES.map((r) => (
            <RangeControls key={r.value} range={r.value} size={108} />
          ))}
        </div>
      ) : (
        <>
          <Segmented label="Range" value={range} onChange={setRange} options={RANGES} className="ed-seg-full" />
          <RangeControls key={range} range={range} size={156} />
        </>
      )}
      <RecipeSlider path="grading.blending" label="Blending" />
      <RecipeSlider path="grading.balance" label="Balance" />
    </div>
  )
}
