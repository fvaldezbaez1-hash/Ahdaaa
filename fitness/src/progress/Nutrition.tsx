import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { MACROS } from '../food/MacroSummary'
import { db } from '../lib/db'
import { addDays, dayRange, fmtShortDay, parseDay, today, dayKey } from '../lib/dates'
import { MIN_LOGGED_KCAL } from '../lib/energy'
import { fmtKcal, fmtNum } from '../lib/units'
import { navigate } from '../router'
import { useCheckIns, useSettings, useTargets } from '../state'
import { BarChart, compact, LineChart } from '../ui/charts'
import { Stat } from '../ui/controls'

type Range = 7 | 30 | 90

export function NutritionSection() {
  const st = useSettings()
  const { targets, checkIn } = useTargets()
  const checkIns = useCheckIns()
  const [range, setRange] = useState<Range>(30)
  const t = today()
  const from = addDays(t, -(range - 1))
  const entries = useLiveQuery(() => db.entries.where('date').between(from, t, true, true).toArray(), [from, t])

  const d = useMemo(() => {
    const byDay = new Map<string, { kcal: number; protein: number; carbs: number; fat: number }>()
    for (const e of entries ?? []) {
      const cur = byDay.get(e.date) ?? { kcal: 0, protein: 0, carbs: 0, fat: 0 }
      cur.kcal += e.n.kcal
      cur.protein += e.n.protein
      cur.carbs += e.n.carbs
      cur.fat += e.n.fat
      byDay.set(e.date, cur)
    }
    const logged = [...byDay.entries()].filter(([, v]) => v.kcal >= MIN_LOGGED_KCAL)
    const avg = (k: 'kcal' | 'protein' | 'carbs' | 'fat') => (logged.length ? logged.reduce((a, [, v]) => a + v[k], 0) / logged.length : 0)
    return {
      days: dayRange(from, t).map((day) => ({ day, kcal: byDay.get(day)?.kcal ?? 0 })),
      logged: logged.length,
      avg: { kcal: avg('kcal'), protein: avg('protein'), carbs: avg('carbs'), fat: avg('fat') },
    }
  }, [entries, from, t])

  const macroKcal = d.avg.protein * 4 + d.avg.carbs * 4 + d.avg.fat * 9
  const ci = checkIns ?? []

  return (
    <div className="stack">
      <div className="chips" role="tablist" aria-label="Time range">
        {([7, 30, 90] as Range[]).map((r) => (
          <button key={r} className={r === range ? 'chip on' : 'chip'} onClick={() => setRange(r)} aria-pressed={r === range}>
            {r} days
          </button>
        ))}
      </div>
      <div className="grid-3">
        <Stat tile label="Avg. calories" value={d.logged ? fmtKcal(d.avg.kcal) : '–'} />
        <Stat tile label="Avg. protein" value={d.logged ? fmtNum(d.avg.protein, 0) : '–'} unit="g" />
        <Stat tile label="Days logged" value={`${d.logged}/${range}`} />
      </div>

      <div className="card stack">
        <h3>
          Daily calories <span className="muted small">(kcal)</span>
        </h3>
        <BarChart
          ariaLabel={`Calories per day, last ${range} days`}
          valueLabel="kcal"
          bars={d.days.map((x) => ({ key: x.day, label: fmtShortDay(x.day), tip: fmtShortDay(x.day), value: x.kcal }))}
          yFormat={fmtKcal}
          tickFormat={compact}
          target={{ y: targets.kcal, label: `Target ${fmtKcal(targets.kcal)}` }}
        />
      </div>

      {d.logged > 0 && (
        <div className="card stack">
          <h3>Average macros</h3>
          <div style={{ display: 'flex', height: 12, gap: 2, borderRadius: 999, overflow: 'hidden' }} aria-hidden="true">
            {MACROS.map((m) => {
              const k = (d.avg[m.key] * (m.key === 'fat' ? 9 : 4)) / (macroKcal || 1)
              return k > 0 ? <i key={m.key} style={{ flex: k, background: m.color }} /> : null
            })}
          </div>
          <div className="grid-3">
            {MACROS.map((m) => (
              <div key={m.key} className="stat">
                <span className="label row" style={{ gap: 6 }}>
                  <i className="swatch" style={{ background: m.color }} />
                  {m.label}
                </span>
                <span className="value">
                  {fmtNum(d.avg[m.key], 0)}
                  <small>/ {targets[m.key]} g</small>
                </span>
                <span className="tiny muted">{Math.round(((d.avg[m.key] * (m.key === 'fat' ? 9 : 4)) / (macroKcal || 1)) * 100)}% of calories</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {st.nutritionMode === 'coached' && (
        <div className="card stack">
          <h3>Expenditure</h3>
          {checkIn && (
            <div className="row" style={{ alignItems: 'baseline', gap: 6 }}>
              <span style={{ fontSize: 28, fontWeight: 750 }}>{fmtKcal(checkIn.expenditure)}</span>
              <span className="text-2 small">kcal / day now</span>
            </div>
          )}
          {ci.length >= 2 ? (
            <LineChart
              ariaLabel="Estimated expenditure and calorie target at each weekly check-in"
              series={[
                { key: 'exp', label: 'Expenditure', color: 'var(--s1)', kind: 'line', points: ci.map((c) => ({ x: parseDay(c.date).getTime(), y: c.expenditure })) },
                { key: 'target', label: 'Calorie target', color: 'var(--s2)', kind: 'line', points: ci.map((c) => ({ x: parseDay(c.date).getTime(), y: c.targets.kcal })) },
              ]}
              xFormat={(x) => fmtShortDay(dayKey(x))}
              yFormat={fmtKcal}
              tickFormat={compact}
            />
          ) : (
            <p className="small muted">A chart appears after your second weekly check-in.</p>
          )}
          <p className="small text-2">
            Each week Forge looks at the last 4 weeks: what you ate, and how your weight trend moved. If you ate 2,300 a day and your weight held steady, you burn about 2,300. That number replaces the formula guess and sets your targets for the week ahead.
          </p>
          <p className="small text-2">For the best estimate, log everything you eat (even rough guesses) and weigh in most mornings. Days with almost nothing logged are ignored.</p>
          <button className="btn soft" onClick={() => navigate('/settings/goals')}>
            Goals & targets
          </button>
        </div>
      )}
    </div>
  )
}
