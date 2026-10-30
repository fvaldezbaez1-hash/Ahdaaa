import { useState } from 'react'
import type { Mask, MaskMode } from '../../edit/types'
import { editor, useEditor } from '../../state/editor'
import { Segmented, Toggle } from '../../ui/controls'
import { Icon } from '../../ui/Icon'
import { Slider } from '../../ui/Slider'
import { wheelColor } from '../math/wheel'
import { useSession } from '../session'
import { useView, view } from '../view'
import { ToolIcon } from './icons'
import { KindChooser } from './KindChooser'
import { kindOf, maskLabel, updateMask } from './model'
import { addMaskToLayer, deleteMask } from './modes'

const MODES: { value: MaskMode; label: string }[] = [
  { value: 'add', label: 'Add' },
  { value: 'subtract', label: 'Subtract' },
  { value: 'intersect', label: 'Intersect' },
]

const setMask = (layerId: string, maskId: string, patch: Partial<Mask>, label?: string) =>
  label ? editor.apply((r) => updateMask(r, layerId, maskId, (m) => ({ ...m, ...patch }) as Mask), label) : editor.preview((r) => updateMask(r, layerId, maskId, (m) => ({ ...m, ...patch }) as Mask))

/** A number on the selected mask (feather, range ends…): live while dragging, one undo step on release. */
function MaskSlider({ layerId, mask, field, label, def }: { layerId: string; mask: Mask; field: 'feather' | 'low' | 'high' | 'smooth'; label: string; def: number }) {
  const value = (mask as unknown as Record<string, number>)[field] ?? 0
  return (
    <Slider
      label={label}
      value={value}
      min={0}
      max={100}
      step={1}
      signed={false}
      defaultValue={def}
      onChange={(v) => setMask(layerId, mask.id, { [field]: v } as Partial<Mask>)}
      onCommit={(v) => editor.commit(`${maskLabel(mask)}: ${label} ${Math.round(v)}`)}
    />
  )
}

function BrushSettings() {
  const b = useView((s) => s.brush)
  const set = (patch: Partial<typeof b>) => view.set({ brush: { ...b, ...patch } })
  return (
    <div className="stack tight">
      <Segmented
        label="Brush"
        value={b.erase ? 'erase' : 'paint'}
        onChange={(v) => set({ erase: v === 'erase' })}
        className="ed-seg-full"
        options={[
          { value: 'paint', label: 'Paint' },
          { value: 'erase', label: 'Erase', title: 'Erase (or hold Alt while painting)' },
        ]}
      />
      <Slider label="Size" value={b.size} min={1} max={100} step={1} defaultValue={50} signed={false} onChange={(v) => set({ size: v })} />
      <Slider label="Feather" value={b.feather} min={0} max={100} step={1} defaultValue={50} signed={false} onChange={(v) => set({ feather: v })} />
      <Slider label="Flow" value={b.flow} min={1} max={100} step={1} defaultValue={100} signed={false} unit="%" onChange={(v) => set({ flow: v })} />
    </div>
  )
}

function RangeSettings({ layerId, mask }: { layerId: string; mask: Extract<Mask, { type: 'range' }> }) {
  const picking = useView((s) => s.rangePick)
  const lum = mask.range === 'luminance'
  return (
    <div className="stack tight">
      <div className="row ed-range-pick">
        {!lum && <span className="ed-swatch" style={{ background: wheelColor(mask.hue ?? 0, Math.max(30, mask.sat ?? 0)) }} aria-label={`Picked color: hue ${mask.hue ?? 0}°`} role="img" />}
        <button type="button" className={picking ? 'btn outline sm on grow' : 'btn outline sm grow'} aria-pressed={picking} onClick={() => view.set({ rangePick: !picking })}>
          <Icon name="eyedropper" size={15} />
          {lum ? 'Pick a brightness' : 'Pick a color'}
        </button>
      </div>
      {lum ? (
        <>
          <MaskSlider layerId={layerId} mask={mask} field="low" label="Darkest" def={0} />
          <MaskSlider layerId={layerId} mask={mask} field="high" label="Brightest" def={100} />
        </>
      ) : (
        <MaskSlider layerId={layerId} mask={mask} field="high" label="Range" def={30} />
      )}
      <MaskSlider layerId={layerId} mask={mask} field="smooth" label="Smoothness" def={30} />
    </div>
  )
}

/** Settings of the selected mask: brush, gradient feather or range. */
function SelectedMask({ layerId, mask }: { layerId: string; mask: Mask }) {
  if (mask.type === 'brush') return <BrushSettings />
  if (mask.type === 'range') return <RangeSettings layerId={layerId} mask={mask} />
  if (mask.type === 'ai') return <p className="muted small">AI masks are coming soon.</p>
  return (
    <div className="stack tight">
      {mask.type === 'radial' && <MaskSlider layerId={layerId} mask={mask} field="feather" label="Feather" def={50} />}
      <button type="button" className="btn outline sm" onClick={() => view.set({ placing: mask.type })}>
        Redraw on the photo
      </button>
    </div>
  )
}

/** The masks that make up one layer, how they combine, and the selected one's settings. */
export function MaskList({ layerId }: { layerId: string }) {
  const { record } = useSession()
  const layer = useEditor((s) => s.recipe?.layers.find((l) => l.id === layerId))
  const selectedId = useView((s) => s.mask)
  const [adding, setAdding] = useState<MaskMode | null>(null)
  if (!layer) return null
  const selected = layer.masks.find((m) => m.id === selectedId) ?? layer.masks[0]
  const src = { width: record.width, height: record.height }
  return (
    <div className="stack tight">
      <ul className="ed-masklist" aria-label={`Masks in ${layer.name}`}>
        {layer.masks.map((m, i) => (
          <li key={m.id} className={m.id === selected?.id ? 'on' : undefined}>
            <button type="button" className="ed-mask-name" aria-current={m.id === selected?.id ? 'true' : undefined} onClick={() => view.set({ mask: m.id, placing: null, rangePick: false })}>
              <ToolIcon name={kindOf(m) === 'ai' ? 'ai' : (kindOf(m) as 'brush')} size={16} />
              <span className="ellipsis">{maskLabel(m)}</span>
            </button>
            {i === 0 ? (
              <span className="ed-mask-mode muted small">Base</span>
            ) : (
              <label className="ed-mask-mode">
                <span className="sr-only">How {maskLabel(m)} combines</span>
                <select value={m.mode} onChange={(e) => setMask(layerId, m.id, { mode: e.target.value as MaskMode }, `${maskLabel(m)}: ${e.target.value}`)}>
                  {MODES.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              type="button"
              className={m.invert ? 'icon-btn on ed-mask-btn' : 'icon-btn ed-mask-btn'}
              aria-pressed={m.invert}
              aria-label={`Invert ${maskLabel(m)}`}
              title="Invert"
              onClick={() => setMask(layerId, m.id, { invert: !m.invert }, `${m.invert ? 'Uninvert' : 'Invert'} ${maskLabel(m).toLowerCase()}`)}
            >
              <ToolIcon name="invert" size={16} />
            </button>
            <button type="button" className="icon-btn ed-mask-btn" aria-label={`Delete ${maskLabel(m)}`} title="Delete" onClick={() => deleteMask(layerId, m.id)}>
              <Icon name="x" size={15} />
            </button>
          </li>
        ))}
      </ul>
      {adding ? (
        <div className="ed-adding">
          <div className="row between">
            <Segmented label="Combine" value={adding} onChange={setAdding} options={MODES} />
            <button type="button" className="btn ghost sm" onClick={() => setAdding(null)}>
              Cancel
            </button>
          </div>
          <KindChooser
            label={`${adding === 'add' ? 'Add' : adding === 'subtract' ? 'Subtract' : 'Intersect with'} a mask`}
            onPick={(k) => {
              addMaskToLayer(layerId, k, adding, src)
              setAdding(null)
            }}
          />
        </div>
      ) : (
        <div className="row">
          <button type="button" className="btn ghost sm" onClick={() => setAdding('add')}>
            <Icon name="plus" size={15} />
            Add
          </button>
          <button type="button" className="btn ghost sm" onClick={() => setAdding('subtract')}>
            <Icon name="minus" size={15} />
            Subtract
          </button>
        </div>
      )}
      {selected && <SelectedMask layerId={layerId} mask={selected} />}
    </div>
  )
}

/** Overlay toggle and layer opacity. */
export function LayerOptions({ layerId }: { layerId: string }) {
  const overlay = useView((s) => s.overlay)
  const opacity = useEditor((s) => s.recipe?.layers.find((l) => l.id === layerId)?.opacity ?? 1)
  const name = useEditor((s) => s.recipe?.layers.find((l) => l.id === layerId)?.name ?? 'Mask')
  return (
    <div className="stack tight">
      <div className="row between ed-overlay-row">
        <span>Show overlay</span>
        <span className="row">
          <kbd className="ed-kbd">O</kbd>
          <Toggle checked={overlay} onChange={(v) => view.set({ overlay: v })} label="Show mask overlay" />
        </span>
      </div>
      <Slider
        label="Amount"
        value={Math.round(opacity * 100)}
        min={0}
        max={100}
        step={1}
        defaultValue={100}
        signed={false}
        unit="%"
        onChange={(v) => editor.preview((r) => ({ ...r, layers: r.layers.map((l) => (l.id === layerId ? { ...l, opacity: v / 100 } : l)) }))}
        onCommit={(v) => editor.commit(`${name}: Amount ${Math.round(v)}%`)}
      />
    </div>
  )
}
