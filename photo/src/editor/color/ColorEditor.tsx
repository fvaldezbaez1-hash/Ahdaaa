import type { ColorRange } from '../../edit/types'
import { editor, useEditor } from '../../state/editor'
import { Icon } from '../../ui/Icon'
import { formatValue, Slider } from '../../ui/Slider'
import type { SliceHandle } from '../math/colorRange'
import { SubHead } from '../panels/Section'
import { useView, view } from '../view'
import { RangeWheel } from './RangeWheel'

type Key = 'hueWidth' | 'satLow' | 'satHigh' | 'smooth' | 'hueShift' | 'satShift' | 'lightShift'

const SPECS: Record<Key, { label: string; min: number; max: number; def: number; unit?: string; signed?: boolean }> = {
  hueWidth: { label: 'Hue range', min: 1, max: 90, def: 15, unit: '°' },
  satLow: { label: 'Saturation from', min: 0, max: 100, def: 0 },
  satHigh: { label: 'Saturation to', min: 0, max: 100, def: 100 },
  smooth: { label: 'Smoothness', min: 0, max: 100, def: 50 },
  hueShift: { label: 'Hue', min: -30, max: 30, def: 0, unit: '°', signed: true },
  satShift: { label: 'Saturation', min: -100, max: 100, def: 0, signed: true },
  lightShift: { label: 'Lightness', min: -100, max: 100, def: 0, signed: true },
}

const update = (id: string, fn: (r: ColorRange) => ColorRange) => editor.preview((x) => ({ ...x, colorEditor: x.colorEditor.map((r) => (r.id === id ? fn(r) : r)) }))
const swatch = (r: ColorRange) => `hsl(${r.hue} ${Math.max(30, r.sat)}% 55%)`

function RangeSlider({ range, k }: { range: ColorRange; k: Key }) {
  const s = SPECS[k]
  return (
    <Slider
      label={s.label}
      value={range[k]}
      min={s.min}
      max={s.max}
      unit={s.unit}
      signed={s.signed ?? false}
      defaultValue={s.def}
      onChange={(v) =>
        update(range.id, (r) => {
          if (k === 'satLow') return { ...r, satLow: Math.min(v, r.satHigh - 4) }
          if (k === 'satHigh') return { ...r, satHigh: Math.max(v, r.satLow + 4) }
          return { ...r, [k]: v }
        })
      }
      onCommit={(v) => editor.commit(`${range.name}: ${s.label} ${formatValue(v, 0, s.signed ?? false, s.unit)}`)}
    />
  )
}

function UniformitySlider({ range, k, label }: { range: ColorRange; k: 'hue' | 'sat' | 'light'; label: string }) {
  const u = range.uniformity ?? { hue: 0, sat: 0, light: 0 }
  return (
    <Slider
      label={label}
      value={u[k]}
      min={0}
      max={100}
      signed={false}
      defaultValue={0}
      onChange={(v) => update(range.id, (r) => ({ ...r, uniformity: { ...u, ...r.uniformity, [k]: v } }))}
      onCommit={(v) => editor.commit(`${range.name}: ${label.toLowerCase()} ${Math.round(v)}`)}
    />
  )
}

function Selected({ range, wheel }: { range: ColorRange; wheel: number }) {
  const pick = useView((s) => s.pick)
  return (
    <div className="stack tight">
      <div className="ed-rwheel-row">
        <RangeWheel range={range} size={wheel} onChange={(r) => update(range.id, () => r)} onDone={(h: SliceHandle) => editor.commit(`${range.name}: ${h === 'center' ? 'color' : h.startsWith('hue') ? 'hue range' : 'saturation range'}`)} />
        <div className="stack tight ed-rwheel-side">
          <span className="ed-swatch big" style={{ background: swatch(range) }} role="img" aria-label={`Picked color: hue ${range.hue}°, saturation ${range.sat}`} />
          <span className="small tnum muted">{`${range.hue}° ± ${range.hueWidth}°`}</span>
          <span className="small tnum muted">{`Sat ${range.satLow}–${range.satHigh}`}</span>
          <button type="button" className={pick === 'colorAgain' ? 'btn outline sm on' : 'btn outline sm'} aria-pressed={pick === 'colorAgain'} onClick={() => view.set({ pick: pick === 'colorAgain' ? null : 'colorAgain' })} title="Pick the color again on the photo">
            <Icon name="eyedropper" size={14} />
            Re-pick
          </button>
        </div>
      </div>
      <RangeSlider range={range} k="hueWidth" />
      <RangeSlider range={range} k="satLow" />
      <RangeSlider range={range} k="satHigh" />
      <RangeSlider range={range} k="smooth" />
      <SubHead>Adjust</SubHead>
      <RangeSlider range={range} k="hueShift" />
      <RangeSlider range={range} k="satShift" />
      <RangeSlider range={range} k="lightShift" />
      {range.uniformity && (
        <>
          <SubHead>Skin tone</SubHead>
          <UniformitySlider range={range} k="hue" label="Hue uniformity" />
          <UniformitySlider range={range} k="sat" label="Saturation uniformity" />
          <UniformitySlider range={range} k="light" label="Lightness uniformity" />
        </>
      )}
    </div>
  )
}

/** Advanced color editor (Capture One style): pick a color, shape its slice on the wheel, shift it; Skin Tone evens it out. */
export function ColorEditor({ wheel = 156 }: { wheel?: number }) {
  const ranges = useEditor((s) => s.recipe?.colorEditor)
  const selectedId = useView((s) => s.colorRange)
  const pick = useView((s) => s.pick)
  if (!ranges) return null
  const selected = ranges.find((r) => r.id === selectedId) ?? ranges[ranges.length - 1]
  const pickBtn = (kind: 'color' | 'skin', label: string, title: string) => (
    <button type="button" className={pick === kind ? 'btn outline sm on grow' : 'btn outline sm grow'} aria-pressed={pick === kind} title={title} onClick={() => view.set({ pick: pick === kind ? null : kind })}>
      <Icon name="eyedropper" size={14} />
      {label}
    </button>
  )
  return (
    <div className="stack tight ed-coloreditor">
      <div className="row">
        {pickBtn('color', 'Pick a color', 'Click a color on the photo to adjust it')}
        {pickBtn('skin', 'Skin tone', 'Click a typical skin tone: even out skin colors')}
      </div>
      {ranges.length === 0 ? (
        <p className="muted small">Pick a color on the photo to adjust just that color, or a skin tone to even out skin.</p>
      ) : (
        <ul className="ed-removals ed-ranges" aria-label="Color ranges">
          {ranges.map((r) => (
            <li key={r.id} className={r.id === selected?.id ? 'on' : undefined}>
              <input
                type="checkbox"
                className="ed-range-on"
                checked={r.enabled}
                aria-label={`${r.enabled ? 'Turn off' : 'Turn on'} ${r.name}`}
                onChange={() => editor.apply((x) => ({ ...x, colorEditor: x.colorEditor.map((c) => (c.id === r.id ? { ...c, enabled: !c.enabled } : c)) }), `${r.enabled ? 'Turn off' : 'Turn on'} ${r.name}`)}
              />
              <button type="button" className="ed-removal-name" aria-current={r.id === selected?.id ? 'true' : undefined} onClick={() => view.set({ colorRange: r.id })}>
                <span className="ed-swatch" style={{ background: swatch(r) }} aria-hidden="true" />
                {r.name}
              </button>
              <button
                type="button"
                className="icon-btn ed-mask-btn"
                aria-label={`Delete ${r.name}`}
                onClick={() => editor.apply((x) => ({ ...x, colorEditor: x.colorEditor.filter((c) => c.id !== r.id) }), `Delete ${r.name}`)}
              >
                <Icon name="x" size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected && <Selected range={selected} wheel={wheel} />}
    </div>
  )
}
