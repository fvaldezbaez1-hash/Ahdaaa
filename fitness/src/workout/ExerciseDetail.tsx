import { useMemo, useState } from 'react'
import { EQUIPMENT_LABEL, KIND_LABEL, MUSCLE_LABEL } from '../data/exercises'
import { db } from '../lib/db'
import { dayKey, fmtClock, fmtShortDay } from '../lib/dates'
import { bestsOf, e1rm, exerciseSessions, isWorkingSet, PR_LABEL, prTypesFor, repMaxes, setVolume, type PRType } from '../lib/strength'
import type { Exercise, Settings, WSet } from '../lib/types'
import { fmtDistance, fmtNum, fmtWeight, kgTo, mTo, round } from '../lib/units'
import { goBack, navigate } from '../router'
import { useExercises, useSettings, useWorkouts } from '../state'
import { compact, LineChart } from '../ui/charts'
import { Empty, Segmented, Stat } from '../ui/controls'
import { Icon } from '../ui/Icon'
import { Topbar } from '../ui/Topbar'
import { CreateExerciseSheet, useExerciseFilter, ExerciseList } from './ExercisePicker'
import { fmtSet, SET_TYPE_SHORT } from './format'

function fmtPR(t: PRType, v: number, st: Settings): string {
  switch (t) {
    case 'kg':
    case 'e1rm':
    case 'volume':
      return fmtWeight(v, st.weightUnit)
    case 'reps':
      return `${v} reps`
    case 'seconds':
      return fmtClock(v)
    case 'meters':
      return fmtDistance(v, st.distanceUnit)
  }
}

// Chart values are converted to display units up front so the axis gets
// round numbers in lb/mi rather than converted kg/km ticks.
type Metric = { key: string; label: string; unit?: string; of: (sets: WSet[]) => number; fmt: (v: number) => string }

function metricsFor(ex: Exercise, st: Settings): Metric[] {
  const working = (sets: WSet[]) => sets.filter(isWorkingSet)
  const max = (xs: number[]) => (xs.length ? Math.max(...xs) : 0)
  const W = (kg: number) => kgTo(kg, st.weightUnit)
  const w1 = (v: number) => fmtNum(round(v, 1), 1)
  switch (ex.kind) {
    case 'weight_reps':
    case 'weighted_bw':
      return [
        { key: 'e1rm', label: 'Est. 1RM', unit: st.weightUnit, of: (s) => W(max(working(s).map((x) => e1rm(x.kg ?? 0, x.reps ?? 0)))), fmt: w1 },
        { key: 'kg', label: 'Heaviest', unit: st.weightUnit, of: (s) => W(max(working(s).filter((x) => x.reps).map((x) => x.kg ?? 0))), fmt: w1 },
        { key: 'vol', label: 'Volume', unit: st.weightUnit, of: (s) => W(working(s).reduce((a, x) => a + setVolume(x, ex.kind), 0)), fmt: (v) => fmtNum(Math.round(v), 0) },
      ]
    case 'reps':
    case 'assisted_bw':
      return [
        { key: 'reps', label: 'Most reps', of: (s) => max(working(s).map((x) => x.reps ?? 0)), fmt: (v) => String(Math.round(v)) },
        { key: 'total', label: 'Total reps', of: (s) => working(s).reduce((a, x) => a + (x.reps ?? 0), 0), fmt: (v) => String(Math.round(v)) },
      ]
    case 'duration':
      return [{ key: 'sec', label: 'Longest', of: (s) => max(working(s).map((x) => x.seconds ?? 0)), fmt: (v) => fmtClock(v) }]
    case 'distance_duration':
      return [
        { key: 'dist', label: 'Distance', unit: st.distanceUnit, of: (s) => mTo(working(s).reduce((a, x) => a + (x.meters ?? 0), 0), st.distanceUnit), fmt: (v) => fmtNum(round(v, 2)) },
        { key: 'time', label: 'Time', of: (s) => working(s).reduce((a, x) => a + (x.seconds ?? 0), 0), fmt: (v) => fmtClock(v) },
      ]
  }
}

export function ExerciseDetail({ id }: { id: string }) {
  const st = useSettings()
  const { map } = useExercises()
  const workouts = useWorkouts()
  const ex = map.get(id)
  const [tab, setTab] = useState<'summary' | 'history' | 'records' | 'howto'>('summary')
  const [metricKey, setMetricKey] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)

  const sessions = useMemo(() => (workouts ? exerciseSessions(workouts, id) : []), [workouts, id])
  if (!ex) return <div className="screen"><Topbar title="Exercise" back="/workout" /><Empty>Exercise not found.</Empty></div>

  const allSets = sessions.flatMap((s) => s.sets)
  const bests = bestsOf(allSets, ex.kind)
  const metrics = metricsFor(ex, st)
  const metric = metrics.find((m) => m.key === metricKey) ?? metrics[0]
  const points = [...sessions].reverse().map((s) => ({ x: s.workout.start, y: metric.of(s.sets) })).filter((p) => p.y > 0)

  // When each record was set.
  const recordDates = new Map<PRType, number>()
  for (const t of prTypesFor(ex.kind)) {
    const v = bests[t]
    if (v === undefined) continue
    const hit = [...sessions].reverse().find((s) => (bestsOf(s.sets, ex.kind)[t] ?? 0) >= v - 1e-9)
    if (hit) recordDates.set(t, hit.workout.start)
  }

  return (
    <div className="screen no-tabs">
      <Topbar
        title={ex.name}
        back="/workout"
        right={
          ex.custom ? (
            <button className="icon-btn" onClick={() => setEditing(true)} aria-label="Edit exercise">
              <Icon name="edit" />
            </button>
          ) : undefined
        }
      />
      <div className="stack">
        <Segmented
          value={tab}
          onChange={setTab}
          label="Exercise sections"
          options={[
            { value: 'summary', label: 'Summary' },
            { value: 'history', label: 'History' },
            { value: 'records', label: 'Records' },
            { value: 'howto', label: 'About' },
          ]}
        />

        {tab === 'summary' &&
          (sessions.length === 0 ? (
            <Empty icon="chart">No sets logged yet. Your progress chart appears after your first session.</Empty>
          ) : (
            <>
              <div className="grid-2">
                {prTypesFor(ex.kind).map((t) => (
                  <Stat key={t} tile label={PR_LABEL[t]} value={bests[t] !== undefined ? fmtPR(t, bests[t]!, st) : '–'} />
                ))}
                <Stat tile label="Sessions" value={sessions.length} />
              </div>
              <div className="card stack">
                {metrics.length > 1 && (
                  <Segmented value={metric.key} onChange={setMetricKey} options={metrics.map((m) => ({ value: m.key, label: m.label }))} label="Chart metric" />
                )}
                <h3>
                  {metric.label}
                  <span className="muted small"> per session{metric.unit ? ` (${metric.unit})` : ''}</span>
                </h3>
                <LineChart
                  ariaLabel={`${metric.label} over time`}
                  series={[{ key: metric.key, label: metric.label, color: 'var(--s1)', points, kind: 'line' }]}
                  xFormat={(x) => fmtShortDay(dayKey(x))}
                  yFormat={metric.fmt}
                  tickFormat={metric.key === 'vol' ? compact : metric.fmt}
                />
              </div>
            </>
          ))}

        {tab === 'history' &&
          (sessions.length === 0 ? (
            <Empty icon="clock">No history yet.</Empty>
          ) : (
            sessions.map(({ workout, sets }) => {
              let n = 0
              return (
                <button key={workout.id} className="card tap stack tight" onClick={() => navigate(`/history/${workout.id}`)}>
                  <div className="row between">
                    <span className="bold ellipsis">{workout.name}</span>
                    <span className="small muted">{fmtShortDay(dayKey(workout.start))}</span>
                  </div>
                  {sets.filter((s) => s.done).map((s) => (
                    <div key={s.id} className="row small">
                      <span className={`set-num ${s.type}`} style={{ width: 24, height: 'auto', textAlign: 'center' }}>
                        {s.type === 'normal' ? ++n : SET_TYPE_SHORT[s.type]}
                      </span>
                      <span className="tnum">{fmtSet(s, ex.kind, st)}</span>
                      {(ex.kind === 'weight_reps' || ex.kind === 'weighted_bw') && s.kg && s.reps && s.type !== 'warmup' ? (
                        <span className="muted small">· 1RM ≈ {fmtWeight(e1rm(s.kg, s.reps), st.weightUnit)}</span>
                      ) : null}
                    </div>
                  ))}
                </button>
              )
            })
          ))}

        {tab === 'records' && (
          <>
            <div className="list">
              {prTypesFor(ex.kind).map((t) => (
                <div key={t} className="list-row">
                  <span className="grow">{PR_LABEL[t]}</span>
                  <span className="stack tight" style={{ alignItems: 'flex-end', gap: 0 }}>
                    <span className="bold">{bests[t] !== undefined ? fmtPR(t, bests[t]!, st) : '–'}</span>
                    {recordDates.has(t) && <span className="tiny muted">{fmtShortDay(dayKey(recordDates.get(t)!))}</span>}
                  </span>
                </div>
              ))}
            </div>
            {(ex.kind === 'weight_reps' || ex.kind === 'weighted_bw') && (
              <>
                <div className="section-title">
                  <h2>Best weight for each rep count</h2>
                </div>
                {repMaxes(allSets).length === 0 ? (
                  <Empty>No sets yet.</Empty>
                ) : (
                  <div className="list">
                    {repMaxes(allSets).map((r) => (
                      <div key={r.reps} className="list-row">
                        <span className="grow">{r.reps} rep{r.reps > 1 ? 's' : ''}</span>
                        <span className="bold tnum">{fmtWeight(r.kg, st.weightUnit)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {tab === 'howto' && (
          <div className="card stack">
            {ex.cues && <p>{ex.cues}</p>}
            <div className="stack tight small">
              <div><span className="muted">Main muscle:</span> {MUSCLE_LABEL[ex.primary]}</div>
              {ex.secondary.length > 0 && (
                <div><span className="muted">Also works:</span> {ex.secondary.map((m) => MUSCLE_LABEL[m]).join(', ')}</div>
              )}
              <div><span className="muted">Equipment:</span> {EQUIPMENT_LABEL[ex.equipment]}</div>
              <div><span className="muted">Logged as:</span> {KIND_LABEL[ex.kind]}</div>
            </div>
            {ex.custom && sessions.length === 0 && (
              <button
                className="btn danger"
                onClick={async () => {
                  if (!confirm('Delete this custom exercise?')) return
                  await db.exercises.delete(ex.id)
                  goBack('/exercises')
                }}
              >
                Delete exercise
              </button>
            )}
          </div>
        )}
      </div>
      {editing && <CreateExerciseSheet existing={ex} onClose={() => setEditing(false)} />}
    </div>
  )
}

export function ExercisesScreen() {
  const { filtered, controls } = useExerciseFilter()
  const [creating, setCreating] = useState(false)
  return (
    <div className="screen no-tabs">
      <Topbar
        title="Exercises"
        back="/workout"
        right={
          <button className="icon-btn accent" onClick={() => setCreating(true)} aria-label="Create exercise">
            <Icon name="plus" />
          </button>
        }
      />
      <div className="stack">
        {controls}
        <p className="small muted">{filtered.length} exercises</p>
        <ExerciseList exercises={filtered} onTap={(e) => navigate(`/exercise/${e.id}`)} />
      </div>
      {creating && <CreateExerciseSheet onClose={() => setCreating(false)} onCreated={(e) => navigate(`/exercise/${e.id}`)} />}
    </div>
  )
}
