import { useEffect, useMemo, useRef, type CSSProperties } from 'react'
import { spotsOf } from '../../edit/retouch'
import type { BrushStroke, Mask, RemoveArea, RetouchSpot } from '../../edit/types'
import { editor, useEditor } from '../../state/editor'
import { useSession } from '../session'
import { toolBus } from '../stage/toolBus'
import { useView } from '../view'
import { linearLayout, radialLayout, removalPin, type Handle } from './handles'
import { makeSpace, type Space } from './space'
import { createHealTool, createMaskTool, type CursorFn } from './tools'

/** Long enough to cross any photo: the gradient lines are clipped by the box. */
const FAR = 1e5

function HandleDots({ handles, out }: { handles: Handle[]; out: { w: number; h: number } }) {
  return (
    <>
      {handles.map((h) => (
        <span key={h.id} className={`ed-mh ${h.id}`} style={{ left: `${(h.x / out.w) * 100}%`, top: `${(h.y / out.h) * 100}%` }} aria-hidden="true" />
      ))}
    </>
  )
}

function MaskShapes({ mask, s, out }: { mask: Mask; s: Space; out: { w: number; h: number } }) {
  if (mask.type === 'linear') {
    const { p1, p2, mid, dir, handles } = linearLayout(mask, s)
    const n = { x: -dir.y * FAR, y: dir.x * FAR }
    const line = (p: { x: number; y: number }, cls: string) => <line x1={p.x - n.x} y1={p.y - n.y} x2={p.x + n.x} y2={p.y + n.y} className={cls} />
    const knob = handles.find((h) => h.id === 'rotate')!
    return (
      <>
        <svg className="ed-mask-svg" viewBox={`0 0 ${out.w} ${out.h}`} preserveAspectRatio="none" aria-hidden="true">
          {line(p1, 'ed-ml strong')}
          {line(mid, 'ed-ml thin')}
          {line(p2, 'ed-ml dashed')}
          <line x1={mid.x} y1={mid.y} x2={knob.x} y2={knob.y} className="ed-ml thin" />
        </svg>
        <HandleDots handles={handles} out={out} />
      </>
    )
  }
  if (mask.type === 'radial') {
    const { c, angle, rx, ry, inner, handles } = radialLayout(mask, s)
    const knob = handles.find((h) => h.id === 'rotate')!
    const top = handles.find((h) => h.id === 'ry2')!
    const deg = (angle * 180) / Math.PI
    return (
      <>
        <svg className="ed-mask-svg" viewBox={`0 0 ${out.w} ${out.h}`} preserveAspectRatio="none" aria-hidden="true">
          <ellipse cx={c.x} cy={c.y} rx={rx} ry={ry} transform={`rotate(${deg} ${c.x} ${c.y})`} className="ed-ml strong" />
          {inner > 0.02 && <ellipse cx={c.x} cy={c.y} rx={rx * inner} ry={ry * inner} transform={`rotate(${deg} ${c.x} ${c.y})`} className="ed-ml dashed" />}
          <line x1={top.x} y1={top.y} x2={knob.x} y2={knob.y} className="ed-ml thin" />
        </svg>
        <HandleDots handles={handles} out={out} />
      </>
    )
  }
  return null
}

/** Painted removal strokes as wide round lines (their real width on the photo). */
function StrokePaths({ strokes, s, className }: { strokes: BrushStroke[]; s: Space; className: string }) {
  return (
    <>
      {strokes.map((st, i) => {
        const pts = st.points.map((p) => s.toPx(p))
        const d = pts.map((p, k) => `${k ? 'L' : 'M'}${p.x} ${p.y}`).join('') + (pts.length === 1 ? 'l0.01 0' : '')
        return <path key={i} d={d} className={className} style={{ strokeWidth: 2 * st.r * s.scale }} />
      })}
    </>
  )
}

function Removals({ areas, pending, selected, s, out }: { areas: RemoveArea[]; pending: BrushStroke[] | null; selected: string | null; s: Space; out: { w: number; h: number } }) {
  const sel = areas.find((a) => a.id === selected)
  return (
    <>
      <svg className="ed-mask-svg" viewBox={`0 0 ${out.w} ${out.h}`} preserveAspectRatio="none" aria-hidden="true">
        {sel && <StrokePaths strokes={sel.strokes} s={s} className="ed-paint selected" />}
        {pending && <StrokePaths strokes={pending} s={s} className="ed-paint pending" />}
      </svg>
      {areas.map((a) => {
        const p = removalPin(a, s)
        return <span key={a.id} className={a.id === selected ? 'ed-pin on' : 'ed-pin'} style={{ left: `${(p.x / out.w) * 100}%`, top: `${(p.y / out.h) * 100}%` }} aria-hidden="true" />
      })}
    </>
  )
}

/** The clicks that shape a Select-object mask: included (+) and left out (−). */
function ObjectPoints({ mask, s, out }: { mask: Extract<Mask, { type: 'ai' }>; s: Space; out: { w: number; h: number } }) {
  return (
    <>
      {(mask.points ?? []).map((pt, i) => {
        const p = s.toPx(pt)
        return (
          <span key={i} className={pt.positive ? 'ed-pt plus' : 'ed-pt minus'} style={{ left: `${(p.x / out.w) * 100}%`, top: `${(p.y / out.h) * 100}%` }} aria-hidden="true">
            {pt.positive ? '+' : '−'}
          </span>
        )
      })}
    </>
  )
}

function Spots({ spots, selected, s, out }: { spots: RetouchSpot[]; selected: string | null; s: Space; out: { w: number; h: number } }) {
  return (
    <svg className="ed-mask-svg" viewBox={`0 0 ${out.w} ${out.h}`} preserveAspectRatio="none" aria-hidden="true">
      {spots.map((sp) => {
        const t = s.toPx({ x: sp.x, y: sp.y }), f = s.toPx({ x: sp.sx, y: sp.sy })
        const r = sp.r * s.scale
        const d = Math.hypot(t.x - f.x, t.y - f.y) || 1
        const ux = (t.x - f.x) / d, uy = (t.y - f.y) / d
        const cls = sp.id === selected ? 'ed-spot on' : 'ed-spot'
        return (
          <g key={sp.id} className={cls}>
            {d > 2 * r && <line x1={f.x + ux * r} y1={f.y + uy * r} x2={t.x - ux * r} y2={t.y - uy * r} className="ed-ml thin" />}
            <circle cx={f.x} cy={f.y} r={r} className="ed-ml dashed" />
            <circle cx={t.x} cy={t.y} r={r} className="ed-ml strong" />
          </g>
        )
      })}
    </svg>
  )
}

/**
 * What the masking and healing tools draw over the photo: the selected mask's
 * lines and handles, the healing spots, and the brush ring. Pointer input
 * comes from the stage (see toolBus), so two fingers still pan and zoom.
 */
export function ToolOverlay() {
  const session = useSession()
  const tool = useView((s) => s.tool)
  const layerId = useView((s) => s.layer)
  const maskId = useView((s) => s.mask)
  const spotId = useView((s) => s.spot)
  const layer = useEditor((s) => s.recipe?.layers.find((l) => l.id === layerId))
  const retouch = useEditor((s) => s.recipe?.retouch)
  const spots = useMemo(() => (retouch ? spotsOf(retouch) : undefined), [retouch])
  const areas = useMemo(() => (retouch ?? []).filter((t): t is RemoveArea => t.mode === 'remove'), [retouch])
  const removeMode = useView((s) => s.heal.mode === 'remove')
  const pending = useView((s) => s.removing)
  const geometry = useEditor((s) => s.recipe?.geometry)
  const ring = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const cursor: CursorFn = (c) => {
      const el = ring.current
      if (!el) return
      el.style.display = c ? 'block' : 'none'
      if (!c) return
      el.style.transform = `translate(${c.x}px, ${c.y}px)`
      el.style.setProperty('--r', `${c.r}px`)
      el.style.setProperty('--inner', `${c.inner}px`)
    }
    if (tool !== 'mask' && tool !== 'heal') return
    toolBus.set(tool === 'mask' ? createMaskTool(session, cursor) : createHealTool(session, cursor))
    return () => {
      toolBus.set(null)
      cursor(null)
    }
  }, [tool, session])

  const recipe = editor.getState().recipe
  if (!geometry || !recipe) return null
  const size = session.engine.outputSize(recipe)
  const out = { w: size.width, h: size.height }
  const s = makeSpace({ width: session.record.width, height: session.record.height }, geometry, out)
  const mask = layer?.masks.find((m) => m.id === maskId) ?? layer?.masks[0]

  return (
    <div className="ed-tool-overlay">
      {tool === 'mask' && mask && layer?.enabled !== false && <MaskShapes mask={mask} s={s} out={out} />}
      {tool === 'mask' && mask?.type === 'ai' && mask.target === 'object' && <ObjectPoints mask={mask} s={s} out={out} />}
      {tool === 'heal' && !removeMode && spots && <Spots spots={spots} selected={spotId} s={s} out={out} />}
      {tool === 'heal' && removeMode && <Removals areas={areas} pending={pending} selected={spotId} s={s} out={out} />}
      <div ref={ring} className="ed-ring" style={{ display: 'none' } as CSSProperties} aria-hidden="true">
        <span />
      </div>
    </div>
  )
}
