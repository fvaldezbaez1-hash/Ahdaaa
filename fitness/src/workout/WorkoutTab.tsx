import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { db } from '../lib/db'
import { dayKey, fmtDay, fmtDuration } from '../lib/dates'
import { workoutStats } from '../lib/strength'
import type { Routine } from '../lib/types'
import { fmtWeight } from '../lib/units'
import { navigate } from '../router'
import { useExercises, useSettings, useWorkouts } from '../state'
import { Empty } from '../ui/controls'
import { Icon } from '../ui/Icon'
import { MenuSheet } from '../ui/Sheet'
import { toast } from '../ui/toast'
import { Topbar } from '../ui/Topbar'
import { HelpButton, Tip } from '../help/Tip'
import { useActive } from './active'
import { PlateCalcSheet } from './PlateCalc'
import { duplicateRoutine } from './routines'

function relDay(ms: number) {
  const d = fmtDay(dayKey(ms))
  return d === 'Today' || d === 'Yesterday' ? d.toLowerCase() : d
}

export function useBeginWorkout() {
  const { active, start } = useActive()
  return (routine?: Routine) => {
    if (active) {
      toast('Finish or discard your current workout first')
      navigate('/active')
      return
    }
    start({ routine })
    navigate('/active')
  }
}

export function WorkoutTab() {
  const st = useSettings()
  const { map } = useExercises()
  const routines = useLiveQuery(() => db.routines.orderBy('order').toArray(), [])
  const workouts = useWorkouts()
  const begin = useBeginWorkout()
  const [menu, setMenu] = useState<Routine | null>(null)
  const [plates, setPlates] = useState(false)

  const lastDone = useMemo(() => {
    const m = new Map<string, number>()
    for (const w of workouts ?? []) if (w.routineId && !m.has(w.routineId)) m.set(w.routineId, w.start)
    return m
  }, [workouts])

  return (
    <div className="screen">
      <Topbar title="Workout" right={<HelpButton section="workout" />} />
      <div className="stack">
        <Tip id="workout-tab" title="How workouts work" learnMore="workout">
          <ol>
            <li>
              Pick a <b>routine</b> below and tap <b>Start</b>, or start an empty workout. No routines yet? Tap <b>Programs</b> for a ready-made plan.
            </li>
            <li>
              Do a set, then tap <b>✓</b>. The rest timer starts by itself.
            </li>
            <li>
              Tap <b>Finish</b> when you’re done. Next time, Forge shows what you lifted and what to aim for.
            </li>
          </ol>
        </Tip>
        <button className="btn primary block lg" onClick={() => begin()}>
          <Icon name="plus" /> Start empty workout
        </button>

        <div className="section-title">
          <h2>My routines</h2>
          <button className="btn ghost sm" onClick={() => navigate('/routine/new')}>
            <Icon name="plus" size={18} /> New
          </button>
        </div>
        {routines && routines.length === 0 && (
          <div className="card">
            <Empty icon="list">
              <p className="bold" style={{ color: 'var(--text)' }}>No routines yet</p>
              <p className="small">Pick a ready-made program or build your own.</p>
            </Empty>
            <div className="grid-2">
              <button className="btn soft" onClick={() => navigate('/programs')}>
                <Icon name="book" size={18} /> Programs
              </button>
              <button className="btn" onClick={() => navigate('/routine/new')}>
                <Icon name="plus" size={18} /> Create
              </button>
            </div>
          </div>
        )}
        {routines?.map((r) => {
          const names = r.exercises.map((e) => map.get(e.exerciseId)?.name ?? '?')
          const done = lastDone.get(r.id)
          return (
            <div key={r.id} className="card stack tight">
              <div className="row">
                <h3 className="grow ellipsis">{r.name}</h3>
                <button className="icon-btn" onClick={() => setMenu(r)} aria-label={`${r.name} options`}>
                  <Icon name="more" />
                </button>
              </div>
              <p className="small text-2" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {names.join(', ') || 'No exercises yet'}
              </p>
              <div className="row between">
                <span className="small muted">{done ? `Last done ${relDay(done)}` : 'Not done yet'}</span>
                <button className="btn primary sm" onClick={() => begin(r)} disabled={r.exercises.length === 0}>
                  <Icon name="play" size={14} /> Start
                </button>
              </div>
            </div>
          )
        })}
        {routines && routines.length > 0 && (
          <button className="btn soft block" onClick={() => navigate('/programs')}>
            <Icon name="book" size={18} /> Browse ready-made programs
          </button>
        )}

        <div className="section-title">
          <h2>Recent workouts</h2>
          {workouts && workouts.length > 0 && (
            <button className="btn ghost sm" onClick={() => navigate('/history')}>
              See all
            </button>
          )}
        </div>
        {workouts && workouts.length === 0 && (
          <div className="card">
            <Empty icon="clock">Your finished workouts will show up here.</Empty>
          </div>
        )}
        {workouts && workouts.length > 0 && (
          <div className="list">
            {workouts.slice(0, 4).map((w) => {
              const s = workoutStats(w, map)
              return (
                <button key={w.id} className="list-row" onClick={() => navigate(`/history/${w.id}`)}>
                  <div className="grow">
                    <div className="bold ellipsis">{w.name}</div>
                    <div className="small muted">
                      {new Date(w.start).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · {fmtDuration(s.durationSec)} · {fmtWeight(s.volume, st.weightUnit)}
                    </div>
                  </div>
                  <Icon name="right" className="chev" />
                </button>
              )
            })}
          </div>
        )}

        <div className="section-title">
          <h2>Tools</h2>
        </div>
        <div className="list">
          <button className="list-row" onClick={() => navigate('/exercises')}>
            <Icon name="search" />
            <span className="grow">Exercise library</span>
            <Icon name="right" className="chev" />
          </button>
          <button className="list-row" onClick={() => setPlates(true)}>
            <Icon name="dumbbell" />
            <span className="grow">Plate calculator</span>
            <Icon name="right" className="chev" />
          </button>
          <button className="list-row" onClick={() => navigate('/settings/data')}>
            <Icon name="upload" />
            <span className="grow">Import from Hevy or Strong</span>
            <Icon name="right" className="chev" />
          </button>
        </div>
      </div>

      {menu && (
        <MenuSheet
          title={menu.name}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Start', icon: 'play', onClick: () => begin(menu) },
            { label: 'Edit routine', icon: 'edit', onClick: () => navigate(`/routine/${menu.id}`) },
            { label: 'Duplicate', icon: 'copy', onClick: () => void duplicateRoutine(menu).then(() => toast('Routine duplicated')) },
            {
              label: 'Delete routine',
              icon: 'trash',
              danger: true,
              onClick: () => {
                if (confirm(`Delete “${menu.name}”? Your past workouts stay.`)) void db.routines.delete(menu.id)
              },
            },
          ]}
        />
      )}
      {plates && <PlateCalcSheet onClose={() => setPlates(false)} />}
    </div>
  )
}
