import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { db } from '../lib/db'
import { fmtDateTime, fmtDuration } from '../lib/dates'
import { findPRs, PR_LABEL, workoutStats, type PRType } from '../lib/strength'
import type { Workout } from '../lib/types'
import { fmtWeight } from '../lib/units'
import { goBack, navigate } from '../router'
import { useExercises, useSettings, useWorkouts } from '../state'
import { Empty, Stat } from '../ui/controls'
import { Icon } from '../ui/Icon'
import { toast } from '../ui/toast'
import { Topbar } from '../ui/Topbar'
import { useActive } from './active'
import { fmtSet, SET_TYPE_SHORT } from './format'
import { mergeIntoRoutine, saveWorkoutAsRoutine, updateRoutineFromWorkout } from './routines'

const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' })

export function HistoryScreen() {
  const st = useSettings()
  const { map } = useExercises()
  const workouts = useWorkouts()
  const groups = useMemo(() => {
    const g: { month: string; items: Workout[] }[] = []
    for (const w of workouts ?? []) {
      const m = monthFmt.format(new Date(w.start))
      if (g[g.length - 1]?.month !== m) g.push({ month: m, items: [] })
      g[g.length - 1].items.push(w)
    }
    return g
  }, [workouts])

  return (
    <div className="screen no-tabs">
      <Topbar title="History" back="/workout" />
      {workouts && workouts.length === 0 && <Empty icon="clock">No workouts yet.</Empty>}
      <div className="stack">
        {groups.map((g) => (
          <section key={g.month} className="stack tight">
            <div className="field-label" style={{ marginTop: 8 }}>
              {g.month} · {g.items.length} workout{g.items.length > 1 ? 's' : ''}
            </div>
            <div className="list">
              {g.items.map((w) => {
                const s = workoutStats(w, map)
                return (
                  <button key={w.id} className="list-row" onClick={() => navigate(`/history/${w.id}`)}>
                    <div className="grow">
                      <div className="bold ellipsis">{w.name}</div>
                      <div className="small muted ellipsis">
                        {new Date(w.start).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · {fmtDuration(s.durationSec)} · {s.sets} sets · {fmtWeight(s.volume, st.weightUnit)}
                      </div>
                    </div>
                    <Icon name="right" className="chev" />
                  </button>
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

function WorkoutBody({ w, prs }: { w: Workout; prs: Map<string, PRType[]> }) {
  const st = useSettings()
  const { map } = useExercises()
  return (
    <div className="stack">
      {w.notes && <p className="text-2">{w.notes}</p>}
      {w.exercises.map((we) => {
        const ex = map.get(we.exerciseId)
        let n = 0
        return (
          <div key={we.id} className="card stack tight">
            <button className="bold" style={{ color: 'var(--accent)', textAlign: 'left' }} onClick={() => navigate(`/exercise/${we.exerciseId}`)}>
              {ex?.name ?? 'Unknown exercise'}
            </button>
            {we.notes && <p className="small text-2">{we.notes}</p>}
            {we.sets.map((s) => {
              const label = s.type === 'normal' ? String(++n) : SET_TYPE_SHORT[s.type]
              const pr = prs.get(s.id)
              return (
                <div key={s.id} className="row small" style={{ minHeight: 26, alignItems: 'flex-start' }}>
                  <span className={`set-num ${s.type}`} style={{ width: 24, height: 'auto', textAlign: 'center', flex: 'none' }}>
                    {label}
                  </span>
                  <div className="grow stack tight" style={{ gap: 4 }}>
                    <span className="tnum">
                      {ex ? fmtSet(s, ex.kind, st) : ''}
                      {s.rpe ? <span className="muted"> @ RPE {s.rpe}</span> : null}
                    </span>
                    {pr && (
                      <span className="badge pr" style={{ alignSelf: 'flex-start', whiteSpace: 'normal' }}>
                        <Icon name="trophy" size={12} /> {pr.map((t) => PR_LABEL[t]).join(' · ')}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

function useWorkoutWithPRs(id: string) {
  const { map } = useExercises()
  const w = useLiveQuery(() => db.workouts.get(id), [id])
  const all = useWorkouts()
  const prs = useMemo(() => (w && all ? findPRs(w, all, map) : new Map<string, PRType[]>()), [w, all, map])
  return { w, prs, all }
}

export function WorkoutDetail({ id }: { id: string }) {
  const st = useSettings()
  const { map } = useExercises()
  const { active, editSaved } = useActive()
  const { w, prs } = useWorkoutWithPRs(id)
  if (w === undefined) return null
  if (!w) return <Empty>Workout not found.</Empty>
  const s = workoutStats(w, map)

  return (
    <div className="screen no-tabs">
      <Topbar
        title={w.name}
        back="/history"
        right={
          <button
            className="btn ghost sm"
            onClick={() => {
              if (active) return toast('Finish or discard your current workout first')
              editSaved(w)
              navigate('/active')
            }}
          >
            Edit
          </button>
        }
      />
      <div className="stack">
        <p className="small muted">{fmtDateTime(w.start)}</p>
        <div className="grid-2">
          <Stat tile label="Duration" value={fmtDuration(s.durationSec)} />
          <Stat tile label="Volume" value={fmtWeight(s.volume, st.weightUnit)} />
          <Stat tile label="Sets" value={s.sets} />
          <Stat tile label="Records" value={prs.size} />
        </div>
        <WorkoutBody w={w} prs={prs} />
        <button
          className="btn soft block"
          onClick={async () => {
            await saveWorkoutAsRoutine(w)
            toast('Saved as a routine')
          }}
        >
          <Icon name="list" size={18} /> Save as routine
        </button>
        <button
          className="btn danger block"
          onClick={async () => {
            if (!confirm('Delete this workout permanently?')) return
            await db.workouts.delete(w.id)
            goBack('/history')
          }}
        >
          Delete workout
        </button>
      </div>
    </div>
  )
}

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

export function SummaryScreen({ id }: { id: string }) {
  const st = useSettings()
  const { map } = useExercises()
  const { w, prs, all } = useWorkoutWithPRs(id)
  const routine = useLiveQuery(() => (w?.routineId ? db.routines.get(w.routineId) : undefined), [w?.routineId])
  if (!w || !all) return null
  const s = workoutStats(w, map)
  const count = all.filter((x) => x.start <= w.start).length

  return (
    <div className="screen no-tabs">
      <header className="topbar">
        <div className="grow" />
        <button className="btn primary sm" onClick={() => navigate('/', { replace: true })}>
          Done
        </button>
      </header>
      <div className="stack loose">
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 44 }} aria-hidden="true">
            {prs.size ? '🏆' : '💪'}
          </div>
          <h1>Workout complete</h1>
          <p className="text-2">That’s your {ordinal(count)} workout. Nice work.</p>
        </div>
        <div className="grid-2">
          <Stat tile label="Duration" value={fmtDuration(s.durationSec)} />
          <Stat tile label="Volume" value={fmtWeight(s.volume, st.weightUnit)} />
          <Stat tile label="Sets" value={s.sets} />
          <Stat tile label="Personal records" value={prs.size} />
        </div>
        {routine ? (
          mergeIntoRoutine(routine, w) && (
          <button
            className="btn soft block"
            onClick={async () => {
              await updateRoutineFromWorkout(routine.id, w)
              toast(`Updated “${routine.name}”`)
            }}
          >
            <Icon name="list" size={18} /> Add today’s changes to “{routine.name}”
          </button>
          )
        ) : (
          <button
            className="btn soft block"
            onClick={async () => {
              await saveWorkoutAsRoutine(w)
              toast('Saved as a routine')
            }}
          >
            <Icon name="list" size={18} /> Save as routine
          </button>
        )}
        <WorkoutBody w={w} prs={prs} />
      </div>
    </div>
  )
}
