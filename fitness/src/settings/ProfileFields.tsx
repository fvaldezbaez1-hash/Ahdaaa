import { ACTIVITY_LEVELS, GOAL_LABEL, GOAL_RATES, goalDelta, isCut } from '../lib/energy'
import type { Goal, GoalType, Profile, Settings } from '../lib/types'
import { cmToFtIn, fmtNum, ftInToCm, kgTo, round } from '../lib/units'
import { Field, NumField, Segmented } from '../ui/controls'
import { Icon } from '../ui/Icon'

export function HeightField({ cm, onChange, unit }: { cm: number; onChange: (cm: number) => void; unit: Settings['lengthUnit'] }) {
  if (unit === 'cm')
    return (
      <Field label="Height">
        <div className="input-unit">
          <NumField className="input" dp={0} value={Math.round(cm)} onChange={(v) => v && onChange(v)} aria-label="Height in cm" />
          <em>cm</em>
        </div>
      </Field>
    )
  const { ft, inch } = cmToFtIn(cm)
  return (
    <div className="field">
      <span>Height</span>
      <div className="row">
        <div className="input-unit grow">
          <NumField className="input" dp={0} value={ft} onChange={(v) => v !== undefined && onChange(ftInToCm(v, inch))} aria-label="Height, feet" />
          <em>ft</em>
        </div>
        <div className="input-unit grow">
          <NumField className="input" dp={0} value={inch} onChange={(v) => v !== undefined && onChange(ftInToCm(ft, v))} aria-label="Height, inches" />
          <em>in</em>
        </div>
      </div>
    </div>
  )
}

export function ProfileFields({ profile, onChange, lengthUnit }: { profile: Profile; onChange: (p: Profile) => void; lengthUnit: Settings['lengthUnit'] }) {
  const age = new Date().getFullYear() - profile.birthYear
  return (
    <div className="stack">
      <div className="field">
        <span>Sex (for the metabolism estimate)</span>
        <Segmented
          value={profile.sex}
          onChange={(sex) => onChange({ ...profile, sex })}
          options={[
            { value: 'female', label: 'Female' },
            { value: 'male', label: 'Male' },
          ]}
        />
      </div>
      <div className="grid-2">
        <Field label="Age">
          <NumField className="input" dp={0} value={age} onChange={(v) => v && v > 5 && v < 120 && onChange({ ...profile, birthYear: new Date().getFullYear() - v })} />
        </Field>
        <HeightField cm={profile.heightCm} unit={lengthUnit} onChange={(heightCm) => onChange({ ...profile, heightCm })} />
      </div>
      <div className="field">
        <span>How active are you?</span>
        <div className="stack tight">
          {ACTIVITY_LEVELS.map((a) => (
            <button key={a.value} className={profile.activity === a.value ? 'choice on' : 'choice'} onClick={() => onChange({ ...profile, activity: a.value })} aria-pressed={profile.activity === a.value}>
              <div className="grow">
                <div className="bold">{a.label}</div>
                <div className="small text-2">{a.detail}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

const GOALS: { type: GoalType; text: string }[] = [
  { type: 'shred', text: 'Lose fat, keep your muscle' },
  { type: 'lose', text: 'Drop weight at your own pace' },
  { type: 'maintain', text: 'Stay at your current weight' },
  { type: 'gain', text: 'Gain slowly while lifting' },
]

export function GoalFields({ goal, onChange, weightKg, unit }: { goal: Goal; onChange: (g: Goal) => void; weightKg: number; unit: Settings['weightUnit'] }) {
  const pick = (type: GoalType) => onChange({ type, ratePct: GOAL_RATES[type][Math.min(1, GOAL_RATES[type].length - 1)].pct })
  const cut = isCut(goal.type)
  return (
    <div className="stack">
      <div className="grid-2" role="radiogroup" aria-label="Goal">
        {GOALS.map((g) => (
          <button
            key={g.type}
            role="radio"
            aria-checked={goal.type === g.type}
            className={goal.type === g.type ? 'choice on' : 'choice'}
            style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}
            onClick={() => pick(g.type)}
          >
            <span className="bold">{GOAL_LABEL[g.type]}</span>
            <span className="small text-2">{g.text}</span>
          </button>
        ))}
      </div>
      {goal.type !== 'maintain' && (
        <div className="stack tight">
          <div className="field-label">How fast?</div>
          {GOAL_RATES[goal.type].map((r) => {
            const perWeek = round(kgTo((weightKg * r.pct) / 100, unit), 1)
            const kcal = Math.round(Math.abs(goalDelta({ type: goal.type, ratePct: r.pct }, weightKg)))
            const recommended = goal.type === 'shred' && r.pct === 0.5
            return (
              <button key={r.pct} className={goal.ratePct === r.pct ? 'choice on' : 'choice'} onClick={() => onChange({ ...goal, ratePct: r.pct })} aria-pressed={goal.ratePct === r.pct}>
                <div className="grow">
                  <div className="bold row" style={{ gap: 8 }}>
                    {r.label}
                    {recommended && <span className="badge good">Recommended</span>}
                  </div>
                  <div className="small text-2">
                    {cut ? '−' : '+'}
                    {fmtNum(perWeek)} {unit} a week · about {fmtNum(kcal, 0)} kcal/day {cut ? 'below' : 'above'} maintenance
                  </div>
                </div>
                <span className="small muted">{r.pct}%/wk</span>
              </button>
            )
          })}
          {goal.type === 'gain' && <p className="small muted">Slower gains add less fat. “Lean” suits most people who lift.</p>}
          {goal.type === 'lose' && goal.ratePct >= 1 && (
            <p className="small muted">Fast cuts are hard to stick to and cost more muscle. Want to keep your muscle? Choose “Get shredded”.</p>
          )}
        </div>
      )}
      {goal.type === 'shred' && (
        <div className="card tip-card stack tight">
          <div className="row">
            <Icon name="dumbbell" />
            <h3 className="grow">How Forge protects your muscle</h3>
          </div>
          <ul className="tip-body" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <li>
              <b>A muscle-safe pace.</b> Losing about 0.5% of your weight a week keeps the most muscle. Go slower as you get leaner.
            </li>
            <li>
              <b>High protein</b>, set for you: about {unit === 'lb' ? '1 g per lb' : '2.2 g per kg'} of body weight a day.
            </li>
            <li>
              <b>Keep lifting heavy.</b> Keep the same weights and rep ranges, because that’s what tells your body to keep the muscle.
            </li>
            <li>
              <b>Weekly strength check.</b> If your lifts start dropping, Forge tells you to slow down.
            </li>
          </ul>
        </div>
      )}
    </div>
  )
}
