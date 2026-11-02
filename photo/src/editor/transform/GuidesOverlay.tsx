import { useEffect } from 'react'
import type { UprightGuide } from '../../edit/types'
import { editor, useEditor } from '../../state/editor'
import { makeSpace, type Pt, type Space } from '../masks/space'
import { useSession, type Session } from '../session'
import { toolBus, type StageTool, type ToolPointer } from '../stage/toolBus'
import { addGuide, guideDirection, hitGuide, MIN_LENGTH, moveGuide, removeGuide, type GuideHit } from './guides'
import { commitGuides, loadUpright, perspectiveOf } from './upright'

const srcOf = (session: Session) => ({ width: session.record.width, height: session.record.height })
const setGuides = (guides: UprightGuide[]) => editor.preview((r) => ({ ...r, geometry: { ...r.geometry, perspective: { ...perspectiveOf(r), guides } } }))
const inside = (p: ToolPointer) => p.x >= 0 && p.y >= 0 && p.x <= p.box.w && p.y <= p.box.h

/**
 * Guided Upright on the photo: drag to draw a line along something that should
 * be vertical or horizontal; drag an end to adjust it, the middle to move it;
 * drop either off the photo to remove the line. The perspective is solved when you let go.
 */
function createGuidesTool(session: Session): StageTool {
  const src = srcOf(session)
  let drag: { base: UprightGuide[]; s: Space; hit: GuideHit | null; from: Pt; start: Pt } | null = null
  return {
    down(p) {
      const r = editor.getState().recipe
      if (!r || !inside(p)) return false
      const s = makeSpace(src, r.geometry, p.box)
      const base = perspectiveOf(r).guides
      drag = { base, s, hit: hitGuide(base, s, p, p.touch ? 22 : 10), from: s.toMask(p), start: p }
      return true
    },
    move(p) {
      const d = drag
      if (!d) return
      const to = d.s.toMask(p)
      if (d.hit) setGuides(moveGuide(d.base, d.hit, d.from, to))
      else if (Math.hypot(p.x - d.start.x, p.y - d.start.y) >= MIN_LENGTH) setGuides(addGuide(d.base, { x1: d.from.x, y1: d.from.y, x2: to.x, y2: to.y }))
    },
    up(p) {
      const d = drag
      drag = null
      if (!d) return
      const r = editor.getState().recipe
      let guides = r ? perspectiveOf(r).guides : d.base
      if (d.hit && !inside(p)) guides = removeGuide(d.base, d.hit.i)
      else if (!d.hit && Math.hypot(p.x - d.start.x, p.y - d.start.y) < MIN_LENGTH) guides = d.base
      commitGuides(session, guides)
    },
    cancel() {
      const d = drag
      drag = null
      if (!d) return
      setGuides(d.base)
      editor.commit('')
    },
    hover() {},
  }
}

export function GuidesOverlay() {
  const session = useSession()
  const guides = useEditor((s) => s.recipe?.geometry.perspective?.guides)
  const geometry = useEditor((s) => s.recipe?.geometry)

  useEffect(() => {
    void loadUpright()
    toolBus.set(createGuidesTool(session))
    return () => toolBus.set(null)
  }, [session])

  const recipe = editor.getState().recipe
  if (!geometry || !recipe) return null
  const size = session.engine.outputSize(recipe)
  const out = { w: size.width, h: size.height }
  const s = makeSpace(srcOf(session), geometry, out)
  const pct = (p: Pt) => ({ left: `${(p.x / out.w) * 100}%`, top: `${(p.y / out.h) * 100}%` })
  return (
    <div className="ed-tool-overlay">
      <svg className="ed-mask-svg" viewBox={`0 0 ${out.w} ${out.h}`} preserveAspectRatio="none" aria-hidden="true">
        {(guides ?? []).map((g, i) => {
          const a = s.toPx({ x: g.x1, y: g.y1 }), b = s.toPx({ x: g.x2, y: g.y2 })
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={`ed-guide ${guideDirection(g, s)}`} />
        })}
      </svg>
      {(guides ?? []).flatMap((g, i) => [
        <span key={`${i}a`} className="ed-mh ed-guide-end" style={pct(s.toPx({ x: g.x1, y: g.y1 }))} aria-hidden="true" />,
        <span key={`${i}b`} className="ed-mh ed-guide-end" style={pct(s.toPx({ x: g.x2, y: g.y2 }))} aria-hidden="true" />,
      ])}
    </div>
  )
}
