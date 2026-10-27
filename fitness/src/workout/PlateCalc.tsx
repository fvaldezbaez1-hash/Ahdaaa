import { useState } from 'react'
import { PLATES_KG, PLATES_LB, platesPerSide } from '../lib/plates'
import { updateSettings } from '../lib/settings'
import { fmtNum, kgTo, round, toKg } from '../lib/units'
import { useSettings } from '../state'
import { Field, UnitInput } from '../ui/controls'
import { Sheet } from '../ui/Sheet'

// Bumper-plate style colors, heaviest first (matches PLATES_KG / PLATES_LB order).
const KG_COLORS = ['#d03b3b', '#2a78d6', '#eda100', '#1baf7a', '#f0efec', '#52514e', '#898781']
const LB_COLORS = ['#2a78d6', '#eda100', '#1baf7a', '#f0efec', '#52514e', '#898781']

export function PlateCalcSheet({ initialKg, onClose }: { initialKg?: number; onClose: () => void }) {
  const st = useSettings()
  const u = st.weightUnit
  const [target, setTarget] = useState<number | undefined>(initialKg ? round(kgTo(initialKg, u), 1) : u === 'lb' ? 135 : 60)
  const bar = round(kgTo(st.barKg, u), 1)
  const plates = u === 'lb' ? PLATES_LB : PLATES_KG
  const r = target !== undefined ? platesPerSide(target, bar, plates) : null
  const barOptions = u === 'lb' ? [45, 35, 25, 15] : [20, 15, 10, 7]

  return (
    <Sheet title="Plate calculator" onClose={onClose}>
      <div className="stack">
        <div className="grid-2">
          <Field label="Total weight">
            <UnitInput value={target} onChange={setTarget} unit={u} dp={1} autoFocus />
          </Field>
          <Field label="Bar">
            <select value={bar} onChange={(e) => void updateSettings({ barKg: toKg(Number(e.target.value), u) })}>
              {barOptions.map((b) => (
                <option key={b} value={b}>
                  {b} {u}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {r && (
          <div className="card stack" aria-live="polite">
            <div className="field-label">Each side</div>
            {r.perSide.length === 0 ? (
              <p className="muted">Just the bar.</p>
            ) : (
              <>
                <div className="row wrap" style={{ alignItems: 'flex-end', minHeight: 90 }}>
                  {r.perSide.map((p, i) => {
                    const big = plates[0]
                    const color = (u === 'lb' ? LB_COLORS : KG_COLORS)[plates.indexOf(p)] ?? 'var(--s1)'
                    return (
                      <div
                        key={i}
                        title={`${p} ${u}`}
                        style={{
                          width: 18,
                          height: 30 + 60 * (p / big),
                          borderRadius: 4,
                          background: color,
                          border: '1px solid var(--border)',
                        }}
                      />
                    )
                  })}
                </div>
                <p className="bold">{r.perSide.map((p) => fmtNum(p)).join(' + ')} {u}</p>
              </>
            )}
            {r.remainder !== 0 && target !== undefined && target > bar && (
              <p className="small muted">
                Closest you can load is {fmtNum(r.achieved)} {u} ({fmtNum(Math.abs(r.remainder))} {u} {r.remainder > 0 ? 'short' : 'over'}).
              </p>
            )}
          </div>
        )}
      </div>
    </Sheet>
  )
}
