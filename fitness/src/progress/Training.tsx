import { useMemo, useState } from 'react'
import { MUSCLE_LABEL } from '../data/exercises'
import { addDays, dayKey, fmtDuration, fmtShortDay, startOfWeek, today } from '../lib/dates'
import { findPRs, isWorkingSet, PR_LABEL, workoutStats } from '../lib/strength'
import { weeklyStreak } from '../lib/streaks'
import type { Muscle } from '../lib/types'
import { fmtNum, fmtWeight, kgTo } from '../lib/units'
import { navigate } from '../router'
import { useExercises, useSettings, useWorkouts } from '../state'
import { BarChart, compact, HBars } from '../ui/charts'
import { Empty, Stat } from '../ui/controls'
import { Icon } from '../ui/Icon'
import { fmtSet } from '../workout/format'
import { StrengthCheck } from './StrengthCheck'

const HEAT_WEEKS = 17

export function TrainingSection() {
  const st = useSettings()
  const { map } = useExercises()
  const workouts = useWorkouts()
  const [picked, setPicked] = useState<string | null>(null)
  const t = today()

  const data = useMemo(() => {
    const ws = workouts ?? []
    const stats = new Map(ws.map((w) => [w.id, workoutStats(w, map)]))
    const curWeek = startOfWeek(t)
    const weeks = Array.from({ length: 12 }, (_, i) => addDays(curWeek, -7 * (11 - i)))
    const perWeek = new Map<string, { count: number; volume: number }>()
    const perDay = new Map<string, string[]>()
    for (const w of ws) {
      const d = dayKey(w.start)
      const wk = startOfWeek(d)
      const cur = perWeek.get(wk) ?? { count: 0, volume: 0 }
      cur.count++
      cur.volume += stats.get(w.id)!.volume
      perWeek.set(wk, cur)
      perDay.set(d, [...(perDay.get(d) ?? []), w.name])
    }
    const since30 = Date.now() - 30 * 86_400_000
    const last30 = ws.filter((w) => w.start >= since30)
    const since28 = Date.now() - 28 * 86_400_000
    const muscleSets = new Map<Muscle, number>()
    for (const w of ws.filter((x) => x.start >= since28))
      for (const we of w.exercises) {
        const ex = map.get(we.exerciseId)
        if (!ex || ex.primary === 'cardio') continue
        const n = we.sets.filter(isWorkingSet).length
        muscleSets.set(ex.primary, (muscleSets.get(ex.primary) ?? 0) + n)
        for (const m of ex.secondary) if (m !== 'cardio') muscleSets.set(m, (muscleSets.get(m) ?? 0) + n / 2)
      }
    const recentPRs: { workoutId: string; date: number; exerciseId: string; setId: string; types: string[] }[] = []
    for (const w of ws.slice(0, 25)) {
      const prs = findPRs(w, ws, map)
      for (const we of w.exercises)
        for (const s of we.sets) {
          const types = prs.get(s.id)
          if (types) recentPRs.push({ workoutId: w.id, date: w.start, exerciseId: we.exerciseId, setId: s.id, types: types.map((x) => PR_LABEL[x]) })
        }
    }
    return {
      weeks,
      perWeek,
      perDay,
      last30,
      vol30: last30.reduce((a, w) => a + stats.get(w.id)!.volume, 0),
      avgDur: last30.length ? last30.reduce((a, w) => a + stats.get(w.id)!.durationSec, 0) / last30.length : 0,
      // Average per week over the last 4 weeks.
      muscles: [...muscleSets.entries()].sort((a, b) => b[1] - a[1]).map(([m, v]) => ({ label: MUSCLE_LABEL[m], value: Math.round(v / 4) })),
      recentPRs: recentPRs.slice(0, 12),
      streak: weeklyStreak(ws.map((w) => w.start), st.weeklyWorkoutGoal, t).streak,
    }
  }, [workouts, map, t, st.weeklyWorkoutGoal])

  if (workouts && workouts.length === 0)
    return (
      <div className="card">
        <Empty icon="dumbbell">Finish your first workout to see your training stats.</Empty>
        <button className="btn primary block" onClick={() => navigate('/workout')}>
          Go to workouts
        </button>
      </div>
    )

  const heatStart = addDays(startOfWeek(t), -7 * (HEAT_WEEKS - 1))
  const heatDays = Array.from({ length: HEAT_WEEKS * 7 }, (_, i) => addDays(heatStart, i))
  const wf = (v: number) => compact(kgTo(v, st.weightUnit))

  return (
    <div className="stack">
      <div className="grid-2">
        <Stat tile label="Workouts (30 days)" value={data.last30.length} />
        <Stat tile label="Avg. duration" value={data.avgDur ? fmtDuration(data.avgDur) : '–'} />
        <Stat tile label="Volume (30 days)" value={fmtWeight(data.vol30, st.weightUnit)} />
        <Stat tile label="Weekly streak" value={data.streak ? `🔥 ${data.streak}` : '0'} unit={data.streak === 1 ? 'week' : 'weeks'} />
      </div>

      <StrengthCheck always />

      <div className="card stack">
        <h3>
          Workouts per week <span className="muted small">(goal {st.weeklyWorkoutGoal})</span>
        </h3>
        <BarChart
          ariaLabel="Workouts per week, last 12 weeks"
          valueLabel="workouts"
          bars={data.weeks.map((w) => ({ key: w, label: fmtShortDay(w).replace(/ /, ' '), tip: `Week of ${fmtShortDay(w)}`, value: data.perWeek.get(w)?.count ?? 0 }))}
          yFormat={(v) => fmtNum(v, 0)}
          target={{ y: st.weeklyWorkoutGoal, label: 'Goal' }}
        />
      </div>

      <div className="card stack">
        <h3>
          Volume per week <span className="muted small">({st.weightUnit})</span>
        </h3>
        <BarChart
          ariaLabel="Training volume per week, last 12 weeks"
          valueLabel={st.weightUnit}
          bars={data.weeks.map((w) => ({ key: w, label: fmtShortDay(w), tip: `Week of ${fmtShortDay(w)}`, value: data.perWeek.get(w)?.volume ?? 0 }))}
          yFormat={(v) => fmtNum(Math.round(kgTo(v, st.weightUnit)), 0)}
          tickFormat={wf}
        />
      </div>

      <div className="card stack">
        <h3>Consistency</h3>
        <div className="heatmap" role="grid" aria-label={`Workout calendar, last ${HEAT_WEEKS} weeks`}>
          {heatDays.map((d) => {
            const names = data.perDay.get(d)
            const future = d > t
            const cls = future ? 'future' : names ? (names.length > 1 ? 'l3' : 'l2') : ''
            return (
              <i
                key={d}
                className={cls}
                role="gridcell"
                tabIndex={names ? 0 : -1}
                aria-label={`${fmtShortDay(d)}: ${names ? names.join(', ') : 'rest'}`}
                onClick={() => setPicked(d)}
                onFocus={() => setPicked(d)}
                style={picked === d ? { outline: '2px solid var(--text)', outlineOffset: 1 } : undefined}
              />
            )
          })}
        </div>
        <p className="small text-2">
          {picked ? `${fmtShortDay(picked)}: ${data.perDay.get(picked)?.join(', ') ?? 'rest day'}` : 'Each square is a day (Mon at the top). Tap one for details.'}
        </p>
      </div>

      <div className="card stack">
        <h3>
          Sets per muscle per week <span className="muted small">(4-week average)</span>
        </h3>
        {data.muscles.length ? (
          <HBars rows={data.muscles.slice(0, 12)} />
        ) : (
          <p className="small muted">No strength sets in the last 4 weeks.</p>
        )}
        <p className="tiny muted">Secondary muscles count as half a set. 10–20 hard sets a week per muscle is a common target for growth.</p>
      </div>

      <div className="card stack">
        <h3>Recent personal records</h3>
        {data.recentPRs.length === 0 ? (
          <p className="small muted">Beat a previous best weight, rep count or estimated 1RM and it shows up here.</p>
        ) : (
          <div className="list">
            {data.recentPRs.map((p) => {
              const ex = map.get(p.exerciseId)
              const s = workouts?.find((w) => w.id === p.workoutId)?.exercises.flatMap((e) => e.sets).find((x) => x.id === p.setId)
              return (
                <button key={p.setId} className="list-row" onClick={() => navigate(`/exercise/${p.exerciseId}`)}>
                  <Icon name="trophy" />
                  <div className="grow">
                    <div className="bold ellipsis">{ex?.name}</div>
                    <div className="small muted ellipsis">
                      {s && ex ? fmtSet(s, ex.kind, st) : ''} · {p.types.join(', ')}
                    </div>
                  </div>
                  <span className="small muted">{fmtShortDay(dayKey(p.date))}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className="list">
        <button className="list-row" onClick={() => navigate('/history')}>
          <Icon name="clock" />
          <span className="grow">Workout history</span>
          <Icon name="right" className="chev" />
        </button>
        <button className="list-row" onClick={() => navigate('/exercises')}>
          <Icon name="chart" />
          <span className="grow">Progress by exercise</span>
          <Icon name="right" className="chev" />
        </button>
      </div>
    </div>
  )
}
