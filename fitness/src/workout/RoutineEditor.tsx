import { useEffect, useState } from 'react'
import { PROGRAMS, templateToRoutines } from '../data/templates'
import { db } from '../lib/db'
import { fmtClock } from '../lib/dates'
import { uid } from '../lib/id'
import type { Routine } from '../lib/types'
import { goBack, navigate } from '../router'
import { useExercises } from '../state'
import { Field, NumField } from '../ui/controls'
import { Icon } from '../ui/Icon'
import { MenuSheet } from '../ui/Sheet'
import { toast } from '../ui/toast'
import { Topbar } from '../ui/Topbar'
import { ExercisePicker } from './ExercisePicker'
import { nextRoutineOrder } from './routines'

const REST = [0, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300]

export function RoutineEditor({ id }: { id: string }) {
  const { map } = useExercises()
  const [r, setR] = useState<Routine | null>(null)
  const [picker, setPicker] = useState(false)
  const [menu, setMenu] = useState<number | null>(null)
  const isNew = id === 'new'

  useEffect(() => {
    if (isNew) setR({ id: uid(), name: '', exercises: [], order: 0, updatedAt: Date.now() })
    else
      db.routines.get(id).then((x) => {
        if (x) setR(x)
        else navigate('/workout', { replace: true })
      })
  }, [id, isNew])

  if (!r) return null
  const edit = (fn: (d: Routine) => void) =>
    setR((cur) => {
      if (!cur) return cur
      const d = structuredClone(cur)
      fn(d)
      return d
    })

  const save = async () => {
    const order = isNew ? await nextRoutineOrder() : r.order
    await db.routines.put({ ...r, name: r.name.trim() || 'My routine', order, updatedAt: Date.now() })
    toast(isNew ? 'Routine created' : 'Routine saved')
    goBack('/workout')
  }

  return (
    <div className="screen no-tabs">
      <Topbar
        title={isNew ? 'New routine' : 'Edit routine'}
        back="/workout"
        right={
          <button className="btn primary sm" onClick={save} disabled={r.exercises.length === 0}>
            Save
          </button>
        }
      />
      <div className="stack">
        <Field label="Routine name">
          <input value={r.name} placeholder="e.g. Push Day" onChange={(e) => edit((d) => void (d.name = e.target.value))} autoFocus={isNew} />
        </Field>

        {r.exercises.map((re, i) => {
          const ex = map.get(re.exerciseId)
          const working = re.sets.filter((s) => s.type !== 'warmup').length
          const warm = re.sets.length - working
          return (
            <div key={re.id} className={re.supersetId ? 'card stack ex-block superset' : 'card stack'} style={{ padding: 14 }}>
              <div className="row">
                <div className="grow">
                  <div className="bold ellipsis">{ex?.name ?? 'Unknown exercise'}</div>
                  {re.supersetId && <span className="badge"><Icon name="link" size={12} /> Superset</span>}
                </div>
                <button className="icon-btn" onClick={() => setMenu(i)} aria-label="Exercise options">
                  <Icon name="more" />
                </button>
              </div>
              <div className="row between">
                <span className="small text-2">
                  Sets{warm ? ` (+${warm} warm-up)` : ''}
                </span>
                <div className="row">
                  <button
                    className="icon-btn"
                    style={{ background: 'var(--surface-2)' }}
                    disabled={working <= 1}
                    onClick={() =>
                      edit((d) => {
                        const sets = d.exercises[i].sets
                        const lastWork = sets.map((s) => s.type !== 'warmup').lastIndexOf(true)
                        if (lastWork >= 0) sets.splice(lastWork, 1)
                      })
                    }
                    aria-label="Fewer sets"
                  >
                    <Icon name="minus" size={18} />
                  </button>
                  <span className="bold tnum" style={{ minWidth: 24, textAlign: 'center' }}>{working}</span>
                  <button
                    className="icon-btn"
                    style={{ background: 'var(--surface-2)' }}
                    onClick={() => edit((d) => void d.exercises[i].sets.push({ type: 'normal' }))}
                    aria-label="More sets"
                  >
                    <Icon name="plus" size={18} />
                  </button>
                </div>
              </div>
              {ex && ex.kind !== 'duration' && ex.kind !== 'distance_duration' && (
                <div className="row between">
                  <span className="small text-2">Target reps</span>
                  <div className="row" style={{ width: 170 }}>
                    <NumField className="input" dp={0} style={{ minHeight: 38, textAlign: 'center' }} value={re.repMin} placeholder="min" onChange={(v) => edit((d) => void (d.exercises[i].repMin = v))} aria-label="Minimum reps" />
                    <span className="muted">–</span>
                    <NumField className="input" dp={0} style={{ minHeight: 38, textAlign: 'center' }} value={re.repMax} placeholder="max" onChange={(v) => edit((d) => void (d.exercises[i].repMax = v))} aria-label="Maximum reps" />
                  </div>
                </div>
              )}
              <div className="row between">
                <span className="small text-2">Rest</span>
                <select
                  className="input"
                  style={{ width: 170, minHeight: 38, padding: '6px 10px' }}
                  value={re.restSec ?? ''}
                  onChange={(e) => edit((d) => void (d.exercises[i].restSec = e.target.value === '' ? undefined : Number(e.target.value)))}
                  aria-label="Rest time"
                >
                  <option value="">Default</option>
                  {REST.map((s) => (
                    <option key={s} value={s}>
                      {s === 0 ? 'Off' : fmtClock(s)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )
        })}

        <button className="btn soft block lg" onClick={() => setPicker(true)}>
          <Icon name="plus" /> Add exercises
        </button>
        {!isNew && (
          <button
            className="btn danger block"
            onClick={async () => {
              if (!confirm('Delete this routine? Your past workouts stay.')) return
              await db.routines.delete(r.id)
              navigate('/workout', { replace: true })
            }}
          >
            Delete routine
          </button>
        )}
      </div>

      {picker && (
        <ExercisePicker
          onClose={() => setPicker(false)}
          onPick={(ids) =>
            edit((d) => {
              for (const exerciseId of ids) {
                const ex = map.get(exerciseId)
                const timed = ex?.kind === 'duration' || ex?.kind === 'distance_duration'
                d.exercises.push({
                  id: uid(),
                  exerciseId,
                  sets: [{ type: 'normal' }, { type: 'normal' }, { type: 'normal' }],
                  repMin: timed ? undefined : 8,
                  repMax: timed ? undefined : 12,
                })
              }
            })
          }
        />
      )}
      {menu !== null && (
        <MenuSheet
          title={map.get(r.exercises[menu]?.exerciseId)?.name ?? 'Exercise'}
          onClose={() => setMenu(null)}
          items={[
            ...(menu > 0 ? [{ label: 'Move up', icon: 'arrowUp' as const, onClick: () => edit((d) => void d.exercises.splice(menu - 1, 0, ...d.exercises.splice(menu, 1))) }] : []),
            ...(menu < r.exercises.length - 1 ? [{ label: 'Move down', icon: 'arrowDown' as const, onClick: () => edit((d) => void d.exercises.splice(menu + 1, 0, ...d.exercises.splice(menu, 1))) }] : []),
            r.exercises[menu].supersetId
              ? { label: 'Remove from superset', icon: 'link' as const, onClick: () => edit((d) => {
                  const sid = d.exercises[menu].supersetId
                  delete d.exercises[menu].supersetId
                  const left = d.exercises.filter((e) => e.supersetId === sid)
                  if (left.length === 1) delete left[0].supersetId
                }) }
              : menu < r.exercises.length - 1
                ? { label: 'Superset with next', icon: 'link' as const, onClick: () => edit((d) => {
                    const sid = d.exercises[menu + 1].supersetId ?? uid()
                    d.exercises[menu].supersetId = sid
                    d.exercises[menu + 1].supersetId = sid
                  }) }
                : null,
            { label: 'Add warm-up set', icon: 'plus' as const, onClick: () => edit((d) => void d.exercises[menu].sets.unshift({ type: 'warmup' })) },
            ...(r.exercises[menu].sets.some((s) => s.type === 'warmup')
              ? [{ label: 'Remove warm-up set', icon: 'minus' as const, onClick: () => edit((d) => {
                  const i = d.exercises[menu].sets.findIndex((s) => s.type === 'warmup')
                  if (i >= 0) d.exercises[menu].sets.splice(i, 1)
                }) }]
              : []),
            { label: 'Remove exercise', icon: 'trash' as const, danger: true, onClick: () => edit((d) => void d.exercises.splice(menu, 1)) },
          ].filter((x): x is NonNullable<typeof x> => x !== null)}
        />
      )}
    </div>
  )
}

export function ProgramsScreen() {
  const { map } = useExercises()
  return (
    <div className="screen no-tabs">
      <Topbar title="Programs" back="/workout" />
      <div className="stack">
        <p className="text-2 small">
          Ready-made plans. Adding one copies its workouts into your routines, where you can change anything. Each lift has a rep range, so Forge tells you when to add reps and when to add weight.
        </p>
        {PROGRAMS.map((p) => (
          <div key={p.id} className="card stack">
            <div>
              <h2>{p.name}</h2>
              <div className="row wrap" style={{ marginTop: 6 }}>
                <span className="badge accent">{p.level}</span>
                <span className="badge">{p.daysPerWeek} days/week</span>
                <span className="badge">{p.equipment === 'None' ? 'No equipment' : p.equipment}</span>
              </div>
            </div>
            <p className="small text-2">{p.summary}</p>
            {p.routines.map((r) => (
              <details key={r.name}>
                <summary className="bold small">{r.name} · {r.exercises.length} exercises</summary>
                <ul className="small text-2" style={{ margin: '6px 0 0', paddingLeft: 20 }}>
                  {r.exercises.map((e) => (
                    <li key={e.ex}>
                      {map.get(e.ex)?.name} — {e.sets} × {e.reps ? (e.reps[0] === e.reps[1] ? e.reps[0] : `${e.reps[0]}–${e.reps[1]}`) : `${e.sec}s`}
                    </li>
                  ))}
                </ul>
              </details>
            ))}
            <button
              className="btn primary block"
              onClick={async () => {
                const routines = templateToRoutines(p, await nextRoutineOrder())
                await db.routines.bulkPut(routines)
                toast(`Added ${routines.length} routines`)
                navigate('/workout')
              }}
            >
              <Icon name="plus" size={18} /> Add to my routines
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
