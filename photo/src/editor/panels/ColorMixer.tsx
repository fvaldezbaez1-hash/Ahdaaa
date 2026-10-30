import { useState, type CSSProperties } from 'react'
import { BANDS } from '../../edit/types'
import { useEditor } from '../../state/editor'
import { Segmented } from '../../ui/controls'
import { RecipeSlider } from './RecipeSlider'
import { BAND_COLORS, bandTrack } from './tracks'

type Mode = 'hue' | 'sat' | 'lum'
const MODES: { value: Mode; label: string; noun: string }[] = [
  { value: 'hue', label: 'Hue', noun: 'hue' },
  { value: 'sat', label: 'Saturation', noun: 'saturation' },
  { value: 'lum', label: 'Luminance', noun: 'luminance' },
]
const name = (b: string) => b[0].toUpperCase() + b.slice(1)

/** Hue / saturation / luminance per color band; in black & white, how bright each color becomes. */
export function ColorMixer() {
  const bw = useEditor((s) => s.recipe?.treatment === 'bw')
  const [mode, setMode] = useState<Mode>('sat')
  const m = bw ? 'bw' : mode
  const noun = bw ? 'B&W' : MODES.find((x) => x.value === mode)!.noun
  return (
    <div className="stack tight">
      {bw ? (
        <p className="muted small">Black & white mix: how light each color turns out.</p>
      ) : (
        <Segmented label="Adjust" value={mode} onChange={setMode} options={MODES} className="ed-seg-full" />
      )}
      {BANDS.map((b) => (
        <div key={b} className="ed-band" style={{ '--dot': BAND_COLORS[b] } as CSSProperties}>
          <RecipeSlider path={`mixer.${m}.${b}`} label={name(b)} history={`${name(b)} ${noun}`} track={bandTrack(b, m)} />
        </div>
      ))}
    </div>
  )
}
