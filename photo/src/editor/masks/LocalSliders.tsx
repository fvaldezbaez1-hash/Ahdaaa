import { useState } from 'react'
import { LOCAL_SPECS } from '../../edit/defaults'
import type { LocalAdjust } from '../../edit/types'
import { editor, useEditor } from '../../state/editor'
import { formatValue, Slider } from '../../ui/Slider'
import { wheelColor } from '../math/wheel'
import { HueSatWheel } from '../panels/HueSatWheel'
import { TRACK } from '../panels/tracks'
import { setAdjust, updateLayer } from './model'

type Key = keyof typeof LOCAL_SPECS

const GROUPS: { title: string; keys: { key: Key; label: string; track?: string }[] }[] = [
  {
    title: 'Light',
    keys: [
      { key: 'exposure', label: 'Exposure', track: TRACK.exposure },
      { key: 'contrast', label: 'Contrast' },
      { key: 'highlights', label: 'Highlights' },
      { key: 'shadows', label: 'Shadows' },
      { key: 'whites', label: 'Whites' },
      { key: 'blacks', label: 'Blacks' },
    ],
  },
  {
    title: 'Color',
    keys: [
      { key: 'temp', label: 'Temperature', track: TRACK.temp },
      { key: 'tint', label: 'Tint', track: TRACK.tint },
      { key: 'saturation', label: 'Saturation', track: TRACK.saturation },
    ],
  },
  {
    title: 'Presence',
    keys: [
      { key: 'texture', label: 'Texture' },
      { key: 'clarity', label: 'Clarity' },
      { key: 'dehaze', label: 'Dehaze' },
    ],
  },
  {
    title: 'Detail',
    keys: [
      { key: 'sharpness', label: 'Sharpness' },
      { key: 'noise', label: 'Noise reduction' },
    ],
  },
]

const layerName = (id: string) => editor.getState().recipe?.layers.find((l) => l.id === id)?.name ?? 'Mask'

function LocalSlider({ layerId, k, label, track }: { layerId: string; k: Key; label: string; track?: string }) {
  const value = useEditor((s) => (s.recipe?.layers.find((l) => l.id === layerId)?.adjust[k] as number | undefined) ?? 0)
  const spec = LOCAL_SPECS[k]
  const signed = spec.min < 0
  return (
    <Slider
      label={label}
      value={value}
      min={spec.min}
      max={spec.max}
      step={spec.step}
      dp={spec.dp}
      signed={signed}
      track={track}
      onChange={(v) => editor.preview((r) => updateLayer(r, layerId, (l) => ({ ...l, adjust: setAdjust(l.adjust, k, v) })))}
      onCommit={(v) => editor.commit(`${layerName(layerId)}: ${label} ${formatValue(v, spec.dp, signed)}`)}
    />
  )
}

/** Tint the masked area with a color. */
function ColorTint({ layerId }: { layerId: string }) {
  const color = useEditor((s) => s.recipe?.layers.find((l) => l.id === layerId)?.adjust.color)
  const [open, setOpen] = useState(false)
  const set = (c: LocalAdjust['color']) => editor.preview((r) => updateLayer(r, layerId, (l) => ({ ...l, adjust: setAdjust(l.adjust, 'color', c) })))
  const name = layerName(layerId)
  return (
    <div className="ed-tint">
      <div className="row between">
        <span className="ed-tint-label">Color</span>
        <button
          type="button"
          className={color ? 'ed-swatch' : 'ed-swatch none'}
          style={color ? { background: wheelColor(color.hue, color.sat) } : undefined}
          aria-expanded={open}
          aria-label={color ? `Color tint: hue ${color.hue}°, saturation ${color.sat}. Change` : 'Color tint: none. Choose a color'}
          onClick={() => setOpen(!open)}
        />
      </div>
      {open && (
        <div className="ed-tint-wheel">
          <HueSatWheel
            label="Color tint"
            value={color ?? { hue: 0, sat: 0 }}
            size={124}
            onChange={(hue, sat) => set(sat ? { hue, sat } : undefined)}
            onCommit={() => {
              const c = editor.getState().recipe?.layers.find((l) => l.id === layerId)?.adjust.color
              editor.commit(c ? `${name}: Color ${c.hue}°, ${c.sat}` : `${name}: No color`)
            }}
            onReset={() => editor.apply((r) => updateLayer(r, layerId, (l) => ({ ...l, adjust: setAdjust(l.adjust, 'color', undefined) })), `${name}: No color`)}
          />
        </div>
      )}
    </div>
  )
}

/** Every local adjustment of one layer. */
export function LocalSliders({ layerId }: { layerId: string }) {
  return (
    <div className="ed-local">
      {GROUPS.map((g) => (
        <div key={g.title} className="stack tight">
          <h3 className="ed-subhead">{g.title}</h3>
          {g.keys.map((k) => (
            <LocalSlider key={k.key} layerId={layerId} k={k.key} label={k.label} track={k.track} />
          ))}
          {g.title === 'Color' && <ColorTint layerId={layerId} />}
        </div>
      ))}
    </div>
  )
}
