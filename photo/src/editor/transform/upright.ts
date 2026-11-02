import { NO_PERSPECTIVE, isIdentityPerspective } from '../../edit/perspective'
import type { EditRecipe, Perspective, UprightGuide } from '../../edit/types'
import { frameSize } from '../../engine/geometry'
import { editor } from '../../state/editor'
import { toast } from '../../ui/toast'
import type { Session } from '../session'
import { view } from '../view'

// Upright and Transform: perspective values from the solver (src/upright,
// loaded on first use) or the sliders, each change one undo step.

type UprightModule = typeof import('../../upright')
let mod: UprightModule | null = null
let loading: Promise<UprightModule> | null = null

export function loadUpright(): Promise<UprightModule> {
  loading ??= import('../../upright').then((m) => (mod = m))
  return loading
}

export type UprightChoice = Perspective['mode']

export const UPRIGHT_MODES: { mode: Exclude<UprightChoice, 'manual'>; label: string; title: string }[] = [
  { mode: 'off', label: 'Off', title: 'No perspective correction' },
  { mode: 'auto', label: 'Auto', title: 'Balanced: level, and verticals made less steep' },
  { mode: 'level', label: 'Level', title: 'Level the horizon only' },
  { mode: 'vertical', label: 'Vertical', title: 'Level and make verticals upright' },
  { mode: 'full', label: 'Full', title: 'Level, verticals and horizontals' },
  { mode: 'guided', label: 'Guided', title: 'Draw lines that should be vertical or horizontal (Shift+T)' },
]

export const perspectiveOf = (r: Pick<EditRecipe, 'geometry'>): Perspective => r.geometry.perspective ?? NO_PERSPECTIVE

const frameOf = (session: Session, r: EditRecipe) => frameSize({ width: session.record.width, height: session.record.height }, r.geometry)

/** Scale so no empty corners show, when "Constrain crop" is on (100 otherwise). */
function constrained(session: Session, r: EditRecipe, p: Perspective): Perspective {
  if (!view.get().constrain || !mod) return p
  return isIdentityPerspective({ ...p, scale: 100 }) ? { ...p, scale: 100 } : { ...p, scale: mod.constrainScale({ ...p, scale: 100 }, frameOf(session, r)) }
}

/** Upright resets straighten, like Lightroom: its rotation lives in the perspective. */
const withPerspective = (r: EditRecipe, p: Perspective | undefined): EditRecipe => ({ ...r, geometry: { ...r.geometry, angle: p ? 0 : r.geometry.angle, perspective: p } })

export async function applyUpright(session: Session, mode: Exclude<UprightChoice, 'manual' | 'guided'>) {
  const r = editor.getState().recipe
  if (!r) return
  if (mode === 'off') {
    editor.apply((x) => ({ ...x, geometry: { ...x.geometry, perspective: undefined } }), 'Upright off')
    return
  }
  const m = await loadUpright()
  const guides = perspectiveOf(r).guides
  const p = m.solveUpright(session.photo.image, session.photo.color, mode, r.geometry, { constrain: view.get().constrain })
  const label = UPRIGHT_MODES.find((x) => x.mode === mode)!.label
  if (isIdentityPerspective(p)) toast(`Upright ${label}: this photo already looks straight`)
  editor.apply((x) => withPerspective(x, { ...p, guides }), `Upright: ${label}`)
}

/** Guided: solve from the lines (needs the module loaded, see loadUpright). */
export function solveGuides(session: Session, r: EditRecipe, guides: UprightGuide[]): Perspective {
  if (!mod || !guides.length) return { ...perspectiveOf(r), guides, mode: 'guided' }
  return mod.solveGuided(guides, r.geometry, { width: session.record.width, height: session.record.height }, { constrain: view.get().constrain })
}

export function commitGuides(session: Session, guides: UprightGuide[]) {
  editor.preview((r) => withPerspective(r, solveGuides(session, r, guides)))
  editor.commit(guides.length ? 'Guided Upright' : 'Clear guides')
}

export type PerspectiveSlider = 'vertical' | 'horizontal' | 'rotate' | 'aspect' | 'scale' | 'offsetX' | 'offsetY'

/** Live while dragging a Transform slider (the grid shows meanwhile). */
export function previewSlider(session: Session, key: PerspectiveSlider, v: number) {
  view.set({ guideGrid: true })
  editor.preview((r) => {
    const p = { ...perspectiveOf(r), [key]: v, mode: 'manual' as const }
    return { ...r, geometry: { ...r.geometry, perspective: key === 'scale' ? p : constrained(session, r, p) } }
  })
}

export function commitSlider(label: string) {
  view.set({ guideGrid: false })
  editor.commit(label)
}

/** Turn "Constrain crop" on or off; the scale follows. */
export function setConstrain(session: Session, on: boolean) {
  view.set({ constrain: on })
  const r = editor.getState().recipe
  if (!r?.geometry.perspective) return
  editor.apply((x) => {
    const p = perspectiveOf(x)
    return { ...x, geometry: { ...x.geometry, perspective: on ? constrained(session, x, p) : { ...p, scale: 100 } } }
  }, on ? 'Constrain crop' : 'Unconstrain crop')
}
