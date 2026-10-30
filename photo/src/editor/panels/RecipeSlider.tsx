import { SPECS, type SliderSpec } from '../../edit/defaults'
import { getNumber, setPath } from '../../edit/path'
import { editor, useEditor } from '../../state/editor'
import { formatValue, Slider } from '../../ui/Slider'
import { useDefaults } from './parts'

const BIPOLAR: SliderSpec = { min: -100, max: 100, step: 1 }

/**
 * A slider bound to one recipe number. Dragging previews live; releasing
 * records one undo step labeled like "Exposure +0.35".
 */
export function RecipeSlider({ path, label, history, track, spec }: { path: string; label: string; history?: string; track?: string; spec?: SliderSpec }) {
  const s = spec ?? SPECS[path] ?? BIPOLAR
  const value = useEditor((st) => (st.recipe ? getNumber(st.recipe, path) : 0))
  const def = getNumber(useDefaults(), path)
  const signed = s.min < 0
  return (
    <Slider
      label={label}
      value={value}
      min={s.min}
      max={s.max}
      step={s.step}
      dp={s.dp}
      unit={s.unit}
      signed={signed}
      defaultValue={def}
      track={track}
      onChange={(v) => editor.preview((r) => setPath(r, path, v))}
      onCommit={(v) => editor.commit(`${history ?? label} ${formatValue(v, s.dp, signed, s.unit)}`)}
    />
  )
}
