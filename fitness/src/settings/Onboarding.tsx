import { useState } from 'react'
import { targetsFor } from '../lib/coach'
import { today } from '../lib/dates'
import { db } from '../lib/db'
import { formulaTdee, SHRED_PROTEIN_PER_KG } from '../lib/energy'
import { defaultSettings, updateSettings } from '../lib/settings'
import type { Settings } from '../lib/types'
import { fmtKcal, kgTo, toKg } from '../lib/units'
import { MACROS } from '../food/MacroSummary'
import { Field, Segmented, UnitInput } from '../ui/controls'
import { Icon } from '../ui/Icon'
import { GoalFields, ProfileFields } from './ProfileFields'
import { InstallSheet, isInstalled } from './SettingsScreen'

const STEPS = 4

export function Onboarding() {
  const [step, setStep] = useState(0)
  const [s, setS] = useState<Settings>(defaultSettings)
  const [weightKg, setWeightKg] = useState<number | undefined>(undefined)
  const [install, setInstall] = useState(false)
  const set = (patch: Partial<Settings>) => setS((cur) => ({ ...cur, ...patch }))

  const kg = weightKg ?? 75
  const tdee = Math.round(formulaTdee(s.profile, kg) / 10) * 10
  const targets = targetsFor(s, tdee, kg)

  const finish = async () => {
    if (weightKg) await db.body.put({ ...(await db.body.get(today())), date: today(), weightKg })
    await updateSettings({ ...s, onboarded: true })
  }

  const metric = s.weightUnit === 'kg'

  return (
    <div className="onboard">
      <div className="body stack loose">
        {step > 0 && (
          <div className="row">
            <button className="icon-btn" onClick={() => setStep(step - 1)} aria-label="Back">
              <Icon name="left" />
            </button>
            <div className="dots grow" aria-label={`Step ${step} of ${STEPS}`}>
              {Array.from({ length: STEPS }, (_, i) => (
                <i key={i} className={i + 1 === step ? 'on' : ''} />
              ))}
            </div>
            <div style={{ width: 40 }} />
          </div>
        )}

        {step === 0 && (
          <div className="stack loose" style={{ paddingTop: '8vh' }}>
            <img src="./icon.svg" width={72} height={72} alt="" style={{ borderRadius: 18 }} />
            <div className="stack tight">
              <h1 style={{ fontSize: 34 }}>Forge</h1>
              <p className="text-2" style={{ fontSize: 18 }}>Your workouts, food and progress in one private app.</p>
            </div>
            <div className="stack">
              {[
                ['dumbbell', 'Log workouts fast', 'Routines, rest timer, PRs, and suggestions for when to add weight.'],
                ['food', 'Track food', 'Barcode scanner, food search, quick add, saved meals.'],
                ['target', 'Targets that learn', 'Your calorie target adjusts every week to your real metabolism.'],
                ['phone', 'Private', 'No account. Your data stays on this phone.'],
              ].map(([icon, title, text]) => (
                <div key={title} className="row" style={{ alignItems: 'flex-start', gap: 14 }}>
                  <span className="icon-btn" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                    <Icon name={icon as 'dumbbell'} />
                  </span>
                  <div>
                    <div className="bold">{title}</div>
                    <div className="small text-2">{text}</div>
                  </div>
                </div>
              ))}
            </div>
            {!isInstalled() && (
              <div className="card tip-card stack tight">
                <div className="row">
                  <Icon name="bulb" />
                  <h3 className="grow">Tip: install it first</h3>
                </div>
                <p className="tip-body">
                  Add Forge to your home screen <b>before</b> setting it up, then open it from the new icon. On iPhone the home-screen app keeps its own data, separate from Safari.
                </p>
                <button className="btn soft sm" style={{ alignSelf: 'flex-start' }} onClick={() => setInstall(true)}>
                  Show me how
                </button>
              </div>
            )}
          </div>
        )}

        {step === 1 && (
          <div className="stack">
            <h1>Units & weight</h1>
            <div className="field">
              <span>Units</span>
              <Segmented
                value={s.weightUnit}
                onChange={(u) =>
                  set(u === 'kg' ? { weightUnit: 'kg', distanceUnit: 'km', lengthUnit: 'cm', barKg: 20 } : { weightUnit: 'lb', distanceUnit: 'mi', lengthUnit: 'in', barKg: toKg(45, 'lb') })
                }
                options={[
                  { value: 'lb', label: 'lb · mi · in' },
                  { value: 'kg', label: 'kg · km · cm' },
                ]}
              />
            </div>
            <Field label="Your weight today" hint="Weigh in each morning for the best results. Your trend, not the daily number, drives everything.">
              <UnitInput
                value={weightKg === undefined ? undefined : Math.round(kgTo(weightKg, s.weightUnit) * 10) / 10}
                onChange={(v) => setWeightKg(v === undefined ? undefined : toKg(v, s.weightUnit))}
                unit={s.weightUnit}
                dp={1}
                placeholder={metric ? '75' : '165'}
                autoFocus
                ariaLabel="Your weight"
              />
            </Field>
          </div>
        )}

        {step === 2 && (
          <div className="stack">
            <h1>About you</h1>
            <p className="text-2">This gives Forge a starting estimate of how much you burn. It gets replaced by your real numbers as you log.</p>
            <ProfileFields profile={s.profile} onChange={(profile) => set({ profile })} lengthUnit={s.lengthUnit} />
          </div>
        )}

        {step === 3 && (
          <div className="stack">
            <h1>Your goal</h1>
            <GoalFields goal={s.goal} onChange={(goal) => set(goal.type === 'shred' ? { goal, proteinPerKg: Math.max(s.proteinPerKg, SHRED_PROTEIN_PER_KG) } : { goal })} weightKg={kg} unit={s.weightUnit} />
          </div>
        )}

        {step === 4 && (
          <div className="stack">
            <h1>Your starting targets</h1>
            <div className="card stack">
              <div className="row between">
                <span className="text-2">Daily calories</span>
                <span className="hero" style={{ fontSize: 40 }}>{fmtKcal(targets.kcal)}</span>
              </div>
              <div className="grid-3">
                {MACROS.map((m) => (
                  <div key={m.key} className="stat">
                    <span className="label row" style={{ gap: 6 }}>
                      <i className="swatch" style={{ background: m.color }} />
                      {m.label}
                    </span>
                    <span className="value">
                      {targets[m.key]}
                      <small>g</small>
                    </span>
                  </div>
                ))}
              </div>
              <p className="small text-2">Estimated maintenance: {fmtKcal(tdee)} kcal a day.</p>
            </div>
            <div className="card stack tight">
              <div className="row">
                <Icon name="target" />
                <h3>How your targets get smarter</h3>
              </div>
              <p className="small text-2">
                Log your food and weigh in most mornings. Every week Forge compares what you ate with how your weight trend moved, works out what you really burn, and updates your targets. Expect it to settle after 2–3 weeks.
              </p>
            </div>
            {!weightKg && <p className="small muted">You skipped your weight, so these use 75 kg as a placeholder. Log your weight on the Today screen.</p>}
            <p className="small text-2">
              Next, the <b>Getting started</b> checklist on the Today screen shows you around. Tap <b>?</b> on any screen for help.
            </p>
          </div>
        )}
      </div>

      <div className="stack tight" style={{ marginTop: 24 }}>
        <button className="btn primary block lg" onClick={() => (step < STEPS ? setStep(step + 1) : void finish())}>
          {step === 0 ? 'Get started' : step < STEPS ? 'Continue' : 'Let’s go'}
        </button>
        {step === 0 && (
          <button className="btn ghost block" onClick={() => void updateSettings({ onboarded: true })}>
            Skip setup
          </button>
        )}
      </div>
      {install && <InstallSheet onClose={() => setInstall(false)} />}
    </div>
  )
}
