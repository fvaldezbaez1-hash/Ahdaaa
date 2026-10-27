import { useState } from 'react'
import { refreshTargets } from '../lib/coach'
import { today } from '../lib/dates'
import { updateSettings } from '../lib/settings'
import { trendOn } from '../lib/trend'
import type { MacroTargets, Settings } from '../lib/types'
import { fmtKcal, KG_PER_LB } from '../lib/units'
import { kcalFromMacrosLabel } from './targetsText'
import { goBack } from '../router'
import { useSettings, useTargets, useWeightTrend } from '../state'
import { Field, NumField, Segmented, UnitInput } from '../ui/controls'
import { toast } from '../ui/toast'
import { Topbar } from '../ui/Topbar'
import { GoalFields, ProfileFields } from './ProfileFields'

export function GoalsScreen() {
  const st = useSettings()
  const { checkIn } = useTargets()
  const { trend, body } = useWeightTrend()
  const [s, setS] = useState<Settings>(st)
  const set = (patch: Partial<Settings>) => setS((cur) => ({ ...cur, ...patch }))
  const lb = st.weightUnit === 'lb'
  const lastKg = body?.filter((b) => b.weightKg).at(-1)?.weightKg
  const kg = trendOn(trend, today()) ?? lastKg ?? 75
  const setManual = (k: keyof MacroTargets, v: number | undefined) => set({ manual: { ...s.manual, [k]: v ?? 0 } })

  const save = async () => {
    await updateSettings({ profile: s.profile, goal: s.goal, nutritionMode: s.nutritionMode, manual: s.manual, proteinPerKg: s.proteinPerKg, fatPct: s.fatPct })
    await refreshTargets(s)
    toast('Targets updated')
    goBack('/settings')
  }

  return (
    <div className="screen no-tabs">
      <Topbar
        title="Goals & targets"
        back="/settings"
        right={
          <button className="btn primary sm" onClick={save}>
            Save
          </button>
        }
      />
      <div className="stack loose">
        <section className="stack">
          <h2>Goal</h2>
          <GoalFields goal={s.goal} onChange={(goal) => set({ goal })} weightKg={kg} unit={st.weightUnit} />
        </section>

        <section className="stack">
          <h2>Targets</h2>
          <Segmented
            value={s.nutritionMode}
            onChange={(nutritionMode) => set({ nutritionMode })}
            options={[
              { value: 'coached', label: 'Smart (adapts weekly)' },
              { value: 'manual', label: 'Set my own' },
            ]}
          />
          {s.nutritionMode === 'coached' ? (
            <>
              <p className="small text-2">
                Forge sets calories from your goal and your estimated expenditure
                {checkIn ? ` (currently ${fmtKcal(checkIn.expenditure)} kcal a day)` : ''}, then re-checks every week.
              </p>
              <div className="grid-2">
                <Field
                  label={`Protein per ${lb ? 'lb' : 'kg'} of body weight`}
                  hint={lb ? '0.7–1 g/lb is ideal for building or keeping muscle.' : '1.6–2.2 g/kg is ideal for building or keeping muscle.'}
                >
                  <div className="input-unit">
                    <NumField
                      className="input"
                      dp={2}
                      value={Math.round((lb ? s.proteinPerKg * KG_PER_LB : s.proteinPerKg) * 100) / 100}
                      onChange={(v) => v && set({ proteinPerKg: Math.min(3.3, Math.max(0.8, lb ? v / KG_PER_LB : v)) })}
                    />
                    <em>{lb ? 'g/lb' : 'g/kg'}</em>
                  </div>
                </Field>
                <Field label="Fat share of calories" hint="25–35% is typical.">
                  <div className="input-unit">
                    <NumField className="input" dp={0} value={s.fatPct} onChange={(v) => v && set({ fatPct: Math.min(60, Math.max(15, v)) })} />
                    <em>%</em>
                  </div>
                </Field>
              </div>
            </>
          ) : (
            <>
              <Field label="Calories">
                <UnitInput value={s.manual.kcal} onChange={(v) => setManual('kcal', v)} unit="kcal" dp={0} />
              </Field>
              <div className="grid-3">
                <Field label="Protein">
                  <UnitInput value={s.manual.protein} onChange={(v) => setManual('protein', v)} unit="g" dp={0} />
                </Field>
                <Field label="Carbs">
                  <UnitInput value={s.manual.carbs} onChange={(v) => setManual('carbs', v)} unit="g" dp={0} />
                </Field>
                <Field label="Fat">
                  <UnitInput value={s.manual.fat} onChange={(v) => setManual('fat', v)} unit="g" dp={0} />
                </Field>
              </div>
              <p className="small muted">{kcalFromMacrosLabel(s.manual)}</p>
            </>
          )}
        </section>

        <section className="stack">
          <h2>About you</h2>
          <ProfileFields profile={s.profile} onChange={(profile) => set({ profile })} lengthUnit={st.lengthUnit} />
        </section>
      </div>
    </div>
  )
}
