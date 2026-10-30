import { SPECS } from '../../edit/defaults'
import type { WbPreset } from '../../edit/types'
import { editor, useEditor } from '../../state/editor'
import { Icon } from '../../ui/Icon'
import { formatValue, Slider } from '../../ui/Slider'
import { DISPLAY_WB_PRESETS, formatKelvin, kelvinToPos, parseKelvin, posToKelvin, RAW_WB_PRESETS, TEMP_POS_MAX, TEMP_POS_MIN, withTempTint } from '../math/wb'
import { useSession } from '../session'
import { useView, view } from '../view'
import { setWbPreset } from './actions'
import { useDefaults } from './parts'
import { TRACK } from './tracks'

/** White balance: preset menu, eyedropper, Temperature (Kelvin for RAW) and Tint. */
export function WhiteBalance() {
  const { engine } = useSession()
  const kind = useEditor((s) => s.kind)
  const asShot = useEditor((s) => s.asShot)
  const wb = useEditor((s) => s.recipe?.wb)
  const picking = useView((s) => s.eyedropper)
  const def = useDefaults().wb
  if (!wb) return null
  const raw = kind === 'raw'
  const presets = raw ? RAW_WB_PRESETS : DISPLAY_WB_PRESETS

  const preview = (temp: number, tint: number) => editor.preview((r) => ({ ...r, wb: withTempTint(kind, temp, tint, asShot) }))
  const tempSpec = SPECS['wb.temp.display'], tintSpec = SPECS[raw ? 'wb.tint.raw' : 'wb.tint.display']

  return (
    <div className="stack tight">
      <div className="ed-wb-row">
        <label className="field grow ed-compact-field">
          <span className="sr-only">White balance preset</span>
          <select value={wb.preset} onChange={(e) => setWbPreset(engine, e.target.value as WbPreset)}>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={picking ? 'icon-btn on ed-eyedropper' : 'icon-btn ed-eyedropper'}
          aria-pressed={picking}
          title="White balance picker (W): click something that should be neutral gray"
          aria-label="White balance picker"
          onClick={() => view.set({ eyedropper: !picking })}
        >
          <Icon name="eyedropper" />
        </button>
      </div>
      {raw ? (
        <Slider
          label="Temperature"
          value={kelvinToPos(wb.temp)}
          min={TEMP_POS_MIN}
          max={TEMP_POS_MAX}
          step={0.5}
          defaultValue={kelvinToPos(def.temp)}
          track={TRACK.temp}
          format={(p) => formatKelvin(posToKelvin(p))}
          parse={(t) => {
            const k = parseKelvin(t)
            return k === undefined ? undefined : kelvinToPos(k)
          }}
          onChange={(p) => preview(Math.abs(p - kelvinToPos(def.temp)) < 1e-9 ? def.temp : posToKelvin(p), wb.tint)}
          onCommit={() => editor.commit(`Temperature ${formatKelvin(editor.getState().recipe?.wb.temp ?? wb.temp)}`)}
        />
      ) : (
        <Slider
          label="Temperature"
          value={wb.temp}
          min={tempSpec.min}
          max={tempSpec.max}
          step={tempSpec.step}
          defaultValue={def.temp}
          track={TRACK.temp}
          onChange={(v) => preview(v, wb.tint)}
          onCommit={(v) => editor.commit(`Temperature ${formatValue(v, 0, true)}`)}
        />
      )}
      <Slider
        label="Tint"
        value={wb.tint}
        min={tintSpec.min}
        max={tintSpec.max}
        step={tintSpec.step}
        defaultValue={def.tint}
        track={TRACK.tint}
        onChange={(v) => preview(wb.temp, v)}
        onCommit={(v) => editor.commit(`Tint ${formatValue(v, 0, true)}`)}
      />
    </div>
  )
}
