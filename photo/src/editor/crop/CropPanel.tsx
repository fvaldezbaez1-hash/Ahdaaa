import { useEditor } from '../../state/editor'
import { Icon } from '../../ui/Icon'
import { Slider } from '../../ui/Slider'
import { useView, view } from '../view'
import { cancelCrop, finishCrop, flipCrop, resetCrop, rotateCrop, setAngle, setAspect } from './cropTool'
import { ASPECTS, DEFAULT_GEOMETRY, MAX_ANGLE } from './geometry'

/** A spirit level: the straighten-by-drawing tool. */
function LevelIcon() {
  return (
    <svg className="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M2 9h20v6H2zM10 9v6M14 9v6M6 12h.01M18 12h.01" />
    </svg>
  )
}

export function CropActions() {
  return (
    <div className="row">
      <button type="button" className="btn ghost sm" onClick={cancelCrop}>
        Cancel
      </button>
      <button type="button" className="btn primary sm" onClick={finishCrop}>
        Done
      </button>
    </div>
  )
}

/** Aspect, straighten, quarter turns and flips. `layout` 'side' = desktop column, 'strip' = phone panel. */
export function CropPanel({ layout }: { layout: 'side' | 'strip' }) {
  const g = useEditor((s) => s.recipe?.geometry)
  const leveling = useView((s) => s.leveling)
  if (!g) return null
  const changed = JSON.stringify(g) !== JSON.stringify(DEFAULT_GEOMETRY)
  return (
    <div className={`ed-crop-panel ${layout}`}>
      <div className="ed-aspects" role="radiogroup" aria-label="Aspect ratio">
        {ASPECTS.map((a) => (
          <button key={a.id} type="button" role="radio" aria-checked={g.aspect === a.id} className={g.aspect === a.id ? 'chip on' : 'chip'} onClick={() => setAspect(a.id)}>
            {a.label}
          </button>
        ))}
      </div>
      <div className="ed-straighten">
        <div className="grow">
          <Slider
            label="Straighten"
            value={g.angle}
            min={-MAX_ANGLE}
            max={MAX_ANGLE}
            step={0.1}
            dp={1}
            unit="°"
            onChange={(v) => {
              view.set({ grid: 'fine' })
              setAngle(v)
            }}
            onCommit={() => view.set({ grid: 'none' })}
          />
        </div>
        <button
          type="button"
          className={leveling ? 'icon-btn on' : 'icon-btn'}
          aria-pressed={leveling}
          aria-label="Level: draw a line along the horizon"
          title="Level: draw a line along the horizon or a vertical edge"
          onClick={() => view.set({ leveling: !leveling })}
        >
          <LevelIcon />
        </button>
      </div>
      <div className="ed-crop-tools">
        <button type="button" className="btn outline sm" onClick={() => rotateCrop(-1)} aria-label="Rotate left 90°" title="Rotate left 90°">
          <Icon name="rotate" />
        </button>
        <button type="button" className="btn outline sm" onClick={() => rotateCrop(1)} aria-label="Rotate right 90°" title="Rotate right 90°">
          <Icon name="rotate" className="mirror" />
        </button>
        <button type="button" className="btn outline sm" onClick={() => flipCrop('h')} aria-label="Flip horizontally" title="Flip horizontally">
          <Icon name="flip" />
        </button>
        <button type="button" className="btn outline sm" onClick={() => flipCrop('v')} aria-label="Flip vertically" title="Flip vertically">
          <Icon name="flip" className="turn" />
        </button>
        <button type="button" className="btn ghost sm" onClick={resetCrop} disabled={!changed}>
          Reset
        </button>
      </div>
      <p className="muted small ed-crop-hint">{leveling ? 'Drag along something that should be level or upright.' : layout === 'side' ? 'Drag the corners or edges. Enter applies, Esc cancels.' : 'Drag the corners or edges to crop.'}</p>
    </div>
  )
}
