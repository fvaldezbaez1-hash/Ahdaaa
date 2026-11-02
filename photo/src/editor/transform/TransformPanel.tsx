import { useEffect, useState } from 'react'
import { isIdentityPerspective, NO_PERSPECTIVE } from '../../edit/perspective'
import { editor, useEditor } from '../../state/editor'
import { Toggle } from '../../ui/controls'
import { formatValue, Slider } from '../../ui/Slider'
import { useSession } from '../session'
import { useView, view } from '../view'
import { applyUpright, commitGuides, commitSlider, loadUpright, previewSlider, setConstrain, UPRIGHT_MODES, type PerspectiveSlider } from './upright'

const SLIDERS: { key: PerspectiveSlider; label: string; min: number; max: number; step: number; dp?: number; unit?: string; def: number }[] = [
  { key: 'vertical', label: 'Vertical', min: -100, max: 100, step: 1, def: 0 },
  { key: 'horizontal', label: 'Horizontal', min: -100, max: 100, step: 1, def: 0 },
  { key: 'rotate', label: 'Rotate', min: -10, max: 10, step: 0.1, dp: 1, unit: '°', def: 0 },
  { key: 'aspect', label: 'Aspect', min: -100, max: 100, step: 1, def: 0 },
  { key: 'scale', label: 'Scale', min: 50, max: 150, step: 1, unit: '%', def: 100 },
  { key: 'offsetX', label: 'Offset X', min: -100, max: 100, step: 1, def: 0 },
  { key: 'offsetY', label: 'Offset Y', min: -100, max: 100, step: 1, def: 0 },
]

function PerspectiveSliderRow({ s }: { s: (typeof SLIDERS)[number] }) {
  const session = useSession()
  const value = useEditor((st) => st.recipe?.geometry.perspective?.[s.key] ?? NO_PERSPECTIVE[s.key])
  return (
    <Slider
      label={s.label}
      value={value}
      min={s.min}
      max={s.max}
      step={s.step}
      dp={s.dp}
      unit={s.unit}
      signed={s.key !== 'scale'}
      defaultValue={s.def}
      onChange={(v) => previewSlider(session, s.key, v)}
      onCommit={(v) => commitSlider(`Transform: ${s.label} ${formatValue(v, s.dp, s.key !== 'scale', s.unit)}`)}
    />
  )
}

/** Upright modes, the Transform sliders and Constrain crop. */
export function TransformPanel() {
  const session = useSession()
  const mode = useEditor((s) => s.recipe?.geometry.perspective?.mode ?? 'off')
  const guides = useEditor((s) => s.recipe?.geometry.perspective?.guides.length ?? 0)
  const changed = useEditor((s) => !isIdentityPerspective(s.recipe?.geometry.perspective))
  const tool = useView((s) => s.tool)
  const constrain = useView((s) => s.constrain)
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => void loadUpright(), [])

  const choose = async (m: (typeof UPRIGHT_MODES)[number]['mode']) => {
    if (m === 'guided') {
      view.set({ tool: tool === 'guides' ? null : 'guides' })
      return
    }
    if (tool === 'guides') view.set({ tool: null })
    setBusy(m)
    try {
      await applyUpright(session, m)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="stack tight ed-transform">
      <div className="ed-upright" role="group" aria-label="Upright">
        {UPRIGHT_MODES.map((m) => {
          const on = m.mode === 'guided' ? tool === 'guides' || mode === 'guided' : mode === m.mode
          return (
            <button key={m.mode} type="button" className={on ? 'chip on' : 'chip'} aria-pressed={on} title={m.title} disabled={!!busy} onClick={() => void choose(m.mode)}>
              {busy === m.mode ? 'Working…' : m.label}
            </button>
          )
        })}
      </div>
      {tool === 'guides' && (
        <div className="ed-ai-card">
          <p className="small">Draw 2 to 4 lines along edges that should be vertical or horizontal. Drag an end to adjust a line, or drag it off the photo to remove it.</p>
          <div className="row">
            <button type="button" className="btn primary sm" onClick={() => view.set({ tool: null })}>
              Done
            </button>
            {guides > 0 && (
              <button type="button" className="btn ghost sm" onClick={() => commitGuides(session, [])}>
                Clear lines
              </button>
            )}
          </div>
        </div>
      )}
      <div className="row between ed-overlay-row">
        <span>Constrain crop</span>
        <Toggle checked={constrain} onChange={(v) => setConstrain(session, v)} label="Constrain crop: zoom in so no empty corners show" />
      </div>
      {SLIDERS.map((s) => (
        <PerspectiveSliderRow key={s.key} s={s} />
      ))}
      {changed && (
        <button type="button" className="btn ghost sm ed-denoise-remove" onClick={() => editor.apply((r) => ({ ...r, geometry: { ...r.geometry, perspective: undefined } }), 'Reset transform')}>
          Reset transform
        </button>
      )}
    </div>
  )
}
