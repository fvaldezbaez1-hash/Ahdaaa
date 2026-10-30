import { useState } from 'react'
import type { Grading } from '../../edit/types'
import { editor, useEditor } from '../../state/editor'
import { Segmented } from '../../ui/controls'
import { HueSatWheel } from './HueSatWheel'
import { RecipeSlider } from './RecipeSlider'

type Range = 'shadows' | 'midtones' | 'highlights' | 'global'
const RANGES: { value: Range; label: string }[] = [
  { value: 'shadows', label: 'Shadows' },
  { value: 'midtones', label: 'Midtones' },
  { value: 'highlights', label: 'Highlights' },
  { value: 'global', label: 'Global' },
]
const labelOf = (r: Range) => RANGES.find((x) => x.value === r)!.label
function Wheel({ range, size }: { range: Range; size: number }) {
  const w = useEditor((s) => s.recipe?.grading[range])
  if (!w) return null
  const label = labelOf(range)
  return (
    <HueSatWheel
      label={`${label} color`}
      value={w}
      size={size}
      onChange={(hue, sat) => editor.preview((r) => ({ ...r, grading: { ...r.grading, [range]: { ...r.grading[range], hue, sat } } as Grading }))}
      onCommit={() => {
        const cur = editor.getState().recipe?.grading[range]
        editor.commit(cur && cur.sat ? `${label} color ${cur.hue}°, ${cur.sat}` : `${label} color`)
      }}
      onReset={() => editor.apply((r) => ({ ...r, grading: { ...r.grading, [range]: { ...r.grading[range], hue: 0, sat: 0 } } as Grading }), `Reset ${label} color`)}
    />
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
