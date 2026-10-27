import { useEffect, useMemo, useState } from 'react'
import { fmtClock, fmtDuration } from '../lib/dates'
import { uid } from '../lib/id'
import { suggestSets, type Suggestion } from '../lib/progression'
import { bestsOf, e1rm, isWorkingSet, prTypesFor, setVolume, usesDistance, usesReps, usesSeconds, usesWeight, workoutStats, type Bests } from '../lib/strength'
import type { Exercise, SetType, WExercise, WSet } from '../lib/types'
import { fmtNum, fmtWeight, kgTo, mTo, round, toKg, toM } from '../lib/units'
import { goBack, navigate } from '../router'
import { useExercises, useSettings, useWorkouts } from '../state'
import { Field, NumField, TimeField } from '../ui/controls'
import { useNow, useWakeLock } from '../ui/hooks'
import { Icon } from '../ui/Icon'
import { MenuSheet, Sheet, type MenuItem } from '../ui/Sheet'
import { toast } from '../ui/toast'
import { buzz } from '../lib/sound'
import { useActive } from './active'
import { ExercisePicker } from './ExercisePicker'
import { fmtPrev, SET_TYPE_LABEL, SET_TYPE_SHORT } from './format'
import { PlateCalcSheet } from './PlateCalc'

type Vals = Pick<WSet, 'kg' | 'reps' | 'seconds' | 'meters'>

const REST_OPTIONS = [0, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300]

function colsFor(ex: Exercise, rpe: boolean): string {
  const r = rpe && usesReps(ex.kind) ? ' 46px' : ''
  if (usesWeight(ex.kind)) return `34px minmax(0,1fr) 66px 54px${r} 40px`
  if (ex.kind === 'reps') return `34px minmax(0,1fr) 64px${r} 40px`
  if (ex.kind === 'duration') return '34px minmax(0,1fr) 84px 40px'
  return '34px minmax(0,1fr) 64px 76px 40px'
}

function weightHeader(ex: Exercise, unit: string) {
  return ex.kind === 'weighted_bw' ? `+${unit}` : ex.kind === 'assisted_bw' ? `−${unit}` : unit
}

function beats(s: WSet, ex: Exercise, best: Bests | undefined): boolean {
  if (!best || !isWorkingSet(s)) return false
  return prTypesFor(ex.kind).some((t) => {
    const v =
      t === 'kg' ? (s.reps ? s.kg ?? 0 : 0)
      : t === 'e1rm' ? e1rm(s.kg ?? 0, s.reps ?? 0)
      : t === 'volume' ? setVolume(s, ex.kind)
      : t === 'reps' ? s.reps ?? 0
      : t === 'seconds' ? s.seconds ?? 0
      : s.meters ?? 0
    return v > 0 && best[t] !== undefined && v > best[t]! + 1e-9
  })
}

export function LoggerScreen() {
  const { active, update, finish, discard, startRest, adjustRest, stopRest } = useActive()
  const st = useSettings()
  const { map } = useExercises()
  const workouts = useWorkouts()
  const resting = !!active?.restEndsAt
  const now = useNow(resting ? 250 : 1000)
  useWakeLock(!!active && st.keepAwake)

  const [picker, setPicker] = useState<null | { replace?: string }>(null)
  const [exMenu, setExMenu] = useState<string | null>(null)
  const [setMenu, setSetMenu] = useState<{ ex: string; set: string } | null>(null)
  const [exSettings, setExSettings] = useState<string | null>(null)
  const [plates, setPlates] = useState<{ kg?: number } | null>(null)

  useEffect(() => {
    if (!active) navigate('/workout', { replace: true })
  }, [active])

  // Rest finished a few seconds ago: clear the bar.
  useEffect(() => {
    if (active?.restEndsAt && now > active.restEndsAt + 4000) stopRest()
  }, [now, active?.restEndsAt, stopRest])

  // What you did last time, and your all-time bests, per exercise. When editing
  // an old workout, only workouts before it count.
  const editingId = active?.editingId
  const activeStart = active?.start ?? 0
  const { last, bests } = useMemo(() => {
    const last = new Map<string, WSet[]>()
    const all = new Map<string, WSet[]>()
    for (const w of workouts ?? []) {
      if (w.id === editingId || (editingId && w.start >= activeStart)) continue
      for (const e of w.exercises) {
        if (!last.has(e.exerciseId)) last.set(e.exerciseId, e.sets)
        all.set(e.exerciseId, (all.get(e.exerciseId) ?? []).concat(e.sets))
      }
    }
    const bests = new Map<string, Bests>()
    for (const [id, sets] of all) {
      const ex = map.get(id)
      if (ex) bests.set(id, bestsOf(sets, ex.kind))
    }
    return { last, bests }
  }, [workouts, editingId, activeStart, map])

  if (!active) return null

  const stats = workoutStats({ ...active, end: active.editingId ? active.end : now }, map)
  const editing = !!active.editingId

  const plan = (we: WExercise) => {
    const ex = map.get(we.exerciseId)!
    const prev = last.get(we.exerciseId) ?? []
    const prevWarm = prev.filter((s) => s.type === 'warmup')
    const prevWork = prev.filter((s) => s.type !== 'warmup')
    const workCount = we.sets.filter((s) => s.type !== 'warmup').length
    const sugg = suggestSets(prevWork, workCount, ex, { repMin: we.repMin, repMax: we.repMax, unit: st.weightUnit })
    let wi = 0
    let ki = 0
    // Placeholders: this session's suggestion, else last time's set, else
    // whatever the set above ends up as.
    let above: Vals = {}
    const rows = we.sets.map((s) => {
      const isWarm = s.type === 'warmup'
      const p = isWarm ? prevWarm[wi++] : prevWork[ki]
      const sg: Suggestion | undefined = isWarm ? undefined : sugg[ki]
      if (!isWarm) ki++
      const ph: Vals = sg ?? p ?? above
      above = { kg: s.kg ?? ph.kg, reps: s.reps ?? ph.reps, seconds: s.seconds ?? ph.seconds, meters: s.meters ?? ph.meters }
      return { prev: p, ph, sg }
    })
    return { ex, rows, sugg }
  }

  const complete = (exIdx: number, setIdx: number, ph: Vals) => {
    const we = active.exercises[exIdx]
    const ex = map.get(we.exerciseId)!
    const s = we.sets[setIdx]
    if (s.done) {
      update((d) => {
        d.exercises[exIdx].sets[setIdx].done = false
      })
      return
    }
    const v: Vals = {
      kg: s.kg ?? ph.kg,
      reps: s.reps ?? ph.reps,
      seconds: s.seconds ?? ph.seconds,
      meters: s.meters ?? ph.meters,
    }
    if (usesReps(ex.kind) && !v.reps) return toast('Enter your reps first')
    if (ex.kind === 'weight_reps' && v.kg === undefined) return toast(`Enter the weight first (0 is fine)`)
    if (ex.kind === 'duration' && !v.seconds) return toast('Enter a time first')
    if (ex.kind === 'distance_duration' && !v.seconds && !v.meters) return toast('Enter distance or time first')
    update((d) => {
      Object.assign(d.exercises[exIdx].sets[setIdx], v, { done: true })
    })
    buzz(15)
    const done = { ...s, ...v, done: true }
    if (beats(done, ex, bests.get(ex.id))) toast('🏆 New personal record!')
    const next = active.exercises[exIdx + 1]
    const midSuperset = we.supersetId && next?.supersetId === we.supersetId
    if (!midSuperset && s.type !== 'warmup') startRest(we.restSec ?? st.restSec)
  }

  const onFinish = async () => {
    const doneSets = active.exercises.reduce((n, e) => n + e.sets.filter((s) => s.done).length, 0)
    const total = active.exercises.reduce((n, e) => n + e.sets.length, 0)
    if (doneSets === 0) {
      if (confirm('No completed sets yet. Tick ✓ on the sets you did. Discard this workout instead?')) {
        discard()
        navigate('/workout', { replace: true })
      }
      return
    }
    if (doneSets < total && !confirm(`Finish workout? ${total - doneSets} unticked set${total - doneSets > 1 ? 's' : ''} will be left out.`)) return
    const wasEditing = active.editingId
    const id = await finish()
    if (!id) return
    navigate(wasEditing ? `/history/${id}` : `/summary/${id}`, { replace: true })
  }

  const exMenuItems = (weId: string): MenuItem[] => {
    const idx = active.exercises.findIndex((e) => e.id === weId)
    const we = active.exercises[idx]
    if (!we) return []
    const ex = map.get(we.exerciseId)
    const next = active.exercises[idx + 1]
    const items: MenuItem[] = []
    if (we.notes === undefined) items.push({ label: 'Add note', icon: 'note', onClick: () => update((d) => void (d.exercises[idx].notes = '')) })
    items.push({ label: 'Rest timer & rep range', icon: 'timer', onClick: () => setExSettings(weId) })
    if (we.supersetId) {
      items.push({
        label: 'Remove from superset',
        icon: 'link',
        onClick: () =>
          update((d) => {
            const sid = d.exercises[idx].supersetId
            delete d.exercises[idx].supersetId
            const left = d.exercises.filter((e) => e.supersetId === sid)
            if (left.length === 1) delete left[0].supersetId
          }),
      })
    } else if (next) {
      items.push({
        label: 'Superset with next exercise',
        icon: 'link',
        onClick: () =>
          update((d) => {
            const sid = d.exercises[idx + 1].supersetId ?? uid()
            d.exercises[idx].supersetId = sid
            d.exercises[idx + 1].supersetId = sid
          }),
      })
    }
    if (idx > 0)
      items.push({ label: 'Move up', icon: 'arrowUp', onClick: () => update((d) => void d.exercises.splice(idx - 1, 0, ...d.exercises.splice(idx, 1))) })
    if (next)
      items.push({ label: 'Move down', icon: 'arrowDown', onClick: () => update((d) => void d.exercises.splice(idx + 1, 0, ...d.exercises.splice(idx, 1))) })
    items.push({ label: 'Replace exercise', icon: 'swap', onClick: () => setPicker({ replace: weId }) })
    if (ex && (ex.equipment === 'barbell' || ex.equipment === 'smith'))
      items.push({ label: 'Plate calculator', icon: 'dumbbell', onClick: () => setPlates({ kg: [...we.sets].reverse().find((s) => s.kg)?.kg }) })
    items.push({ label: 'Exercise history & records', icon: 'chart', onClick: () => navigate(`/exercise/${we.exerciseId}`) })
    items.push({
      label: 'Remove exercise',
      icon: 'trash',
      danger: true,
      onClick: () => {
        if (we.sets.some((s) => s.done) && !confirm('Remove this exercise and its completed sets?')) return
        update((d) => void d.exercises.splice(idx, 1))
      },
    })
    return items
  }

  const setMenuItems = (): MenuItem[] => {
    if (!setMenu) return []
    const exIdx = active.exercises.findIndex((e) => e.id === setMenu.ex)
    const setIdx = active.exercises[exIdx]?.sets.findIndex((s) => s.id === setMenu.set) ?? -1
    if (setIdx < 0) return []
    const types: SetType[] = ['warmup', 'normal', 'drop', 'failure']
    return [
      ...types.map<MenuItem>((t) => ({
        label: SET_TYPE_LABEL[t],
        icon: active.exercises[exIdx].sets[setIdx].type === t ? 'check' : undefined,
        onClick: () => update((d) => void (d.exercises[exIdx].sets[setIdx].type = t)),
      })),
      { label: 'Delete set', icon: 'trash', danger: true, onClick: () => update((d) => void d.exercises[exIdx].sets.splice(setIdx, 1)) },
    ]
  }

  const restLeft = active.restEndsAt ? Math.max(0, (active.restEndsAt - now) / 1000) : 0

  return (
    <div className="screen no-tabs" style={resting ? { paddingBottom: 'calc(var(--safe-bottom) + 130px)' } : undefined}>
      <header className="topbar">
        <button className="icon-btn" onClick={() => goBack('/workout')} aria-label="Minimize workout">
          <Icon name="down" />
        </button>
        <div className="title tnum">{editing ? 'Edit workout' : fmtClock((now - active.start) / 1000)}</div>
        <button className="btn primary sm" onClick={onFinish}>
          {editing ? 'Save' : 'Finish'}
        </button>
      </header>

      <div className="stack">
        <input
          className="input"
          style={{ fontSize: 20, fontWeight: 700, background: 'transparent', border: 0, padding: '4px 2px' }}
          value={active.name}
          onChange={(e) => update((d) => void (d.name = e.target.value))}
          aria-label="Workout name"
        />
        <div className="grid-3">
          <div className="stat">
            <span className="label">Duration</span>
            <span className="value tnum">{fmtDuration(stats.durationSec)}</span>
          </div>
          <div className="stat">
            <span className="label">Volume</span>
            <span className="value">{fmtWeight(stats.volume, st.weightUnit)}</span>
          </div>
          <div className="stat">
            <span className="label">Sets</span>
            <span className="value">{stats.sets}</span>
          </div>
        </div>

        {editing && <EditTimes />}

        {active.exercises.length === 0 && (
          <div className="card empty">
            <Icon name="dumbbell" size={32} />
            <p className="bold" style={{ color: 'var(--text)' }}>Let’s get started</p>
            <p className="small">Add your first exercise below.</p>
          </div>
        )}

        {active.exercises.map((we, exIdx) => {
          if (!map.has(we.exerciseId)) return null
          const { ex, rows, sugg } = plan(we)
          const cols = colsFor(ex, st.showRpe)
          const prevSuper = active.exercises[exIdx - 1]?.supersetId
          const inSuper = !!we.supersetId
          const firstOfSuper = inSuper && prevSuper !== we.supersetId
          const best = bests.get(ex.id)
          let n = 0
          const hint =
            sugg.some((s) => s.hint === 'up') ? `↑ Add weight — you hit ${we.repMax} reps on every set last time.`
            : sugg.some((s) => s.hint === 'reps') ? 'Aim for one more rep than last time.'
            : undefined
          return (
            <section key={we.id} className={inSuper ? 'ex-block superset' : 'ex-block'} aria-label={ex.name}>
              {firstOfSuper && <div className="badge" style={{ margin: '0 0 6px 14px' }}><Icon name="link" size={12} /> Superset</div>}
              <div className="ex-head">
                <button className="name" onClick={() => navigate(`/exercise/${ex.id}`)}>
                  {ex.name}
                </button>
                <button className="icon-btn" onClick={() => setExMenu(we.id)} aria-label={`${ex.name} options`}>
                  <Icon name="more" />
                </button>
              </div>
              <div className="row wrap" style={{ margin: '2px 14px 0', gap: 6 }}>
                <button className="badge accent" onClick={() => setExSettings(we.id)}>
                  <Icon name="timer" size={12} /> Rest {fmtClock(we.restSec ?? st.restSec)}
                </button>
                {we.repMin !== undefined && we.repMax !== undefined && (
                  <button className="badge" onClick={() => setExSettings(we.id)}>
                    {we.repMin === we.repMax ? we.repMin : `${we.repMin}–${we.repMax}`} reps
                  </button>
                )}
              </div>
              {hint && <p className="ex-hint">{hint}</p>}
              {we.notes !== undefined && (
                <div className="ex-note">
                  <textarea
                    rows={1}
                    value={we.notes}
                    placeholder="Add a note…"
                    onChange={(e) => update((d) => void (d.exercises[exIdx].notes = e.target.value))}
                    aria-label="Exercise note"
                  />
                </div>
              )}
              {ex.cues && we.sets.length > 0 && !last.has(ex.id) && <p className="ex-hint small muted">{ex.cues}</p>}

              <div className="sets" style={{ ['--set-cols' as string]: cols }}>
                <div className="set-row head" aria-hidden="true">
                  <span>Set</span>
                  <span>Previous</span>
                  {usesWeight(ex.kind) && <span>{weightHeader(ex, st.weightUnit)}</span>}
                  {usesDistance(ex.kind) && <span>{st.distanceUnit}</span>}
                  {usesReps(ex.kind) && <span>Reps</span>}
                  {usesSeconds(ex.kind) && <span>Time</span>}
                  {st.showRpe && usesReps(ex.kind) && <span>RPE</span>}
                  <span>✓</span>
                </div>
                {we.sets.map((s, setIdx) => {
                  const { prev, ph } = rows[setIdx]
                  const label = s.type === 'normal' ? String(++n) : SET_TYPE_SHORT[s.type]
                  const pr = s.done && beats(s, ex, best)
                  const set = (patch: Partial<WSet>) => update((d) => void Object.assign(d.exercises[exIdx].sets[setIdx], patch))
                  return (
                    <div key={s.id} className={s.done ? 'set-row done' : 'set-row'}>
                      <button
                        className={`set-num ${s.type}`}
                        onClick={() => setSetMenu({ ex: we.id, set: s.id })}
                        aria-label={`Set ${label}, ${SET_TYPE_LABEL[s.type]}. Change type or delete`}
                      >
                        {label}
                      </button>
                      {pr ? (
                        <span className="prev" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <span className="badge pr">
                            <Icon name="trophy" size={12} /> PR
                          </span>
                        </span>
                      ) : (
                        <button
                          className="prev"
                          disabled={!prev}
                          onClick={() => prev && set({ kg: prev.kg, reps: prev.reps, seconds: prev.seconds, meters: prev.meters })}
                          aria-label={prev ? `Copy previous: ${fmtPrev(prev, ex.kind, st)}` : 'No previous set'}
                        >
                          {prev ? fmtPrev(prev, ex.kind, st) : '–'}
                        </button>
                      )}
                      {usesWeight(ex.kind) && (
                        <NumField
                          className="set-input"
                          value={s.kg === undefined ? undefined : round(kgTo(s.kg, st.weightUnit), 2)}
                          placeholder={ph.kg !== undefined ? fmtNum(round(kgTo(ph.kg, st.weightUnit), 1)) : ex.kind === 'weight_reps' ? '0' : '–'}
                          onChange={(v) => set({ kg: v === undefined ? undefined : toKg(v, st.weightUnit) })}
                          aria-label={`Weight in ${st.weightUnit}`}
                        />
                      )}
                      {usesDistance(ex.kind) && (
                        <NumField
                          className="set-input"
                          value={s.meters === undefined ? undefined : round(mTo(s.meters, st.distanceUnit), 2)}
                          placeholder={ph.meters !== undefined ? fmtNum(round(mTo(ph.meters, st.distanceUnit), 2)) : '0'}
                          onChange={(v) => set({ meters: v === undefined ? undefined : toM(v, st.distanceUnit) })}
                          aria-label={`Distance in ${st.distanceUnit}`}
                        />
                      )}
                      {usesReps(ex.kind) && (
                        <NumField
                          className="set-input"
                          dp={0}
                          value={s.reps}
                          placeholder={ph.reps !== undefined ? String(ph.reps) : we.repMin !== undefined ? String(we.repMin) : '0'}
                          onChange={(v) => set({ reps: v === undefined ? undefined : Math.round(v) })}
                          aria-label="Reps"
                        />
                      )}
                      {usesSeconds(ex.kind) && (
                        <TimeField
                          className="set-input"
                          value={s.seconds}
                          bareMinutes={ex.kind === 'distance_duration'}
                          placeholder={ph.seconds !== undefined ? fmtClock(ph.seconds) : '0:00'}
                          onChange={(v) => set({ seconds: v })}
                          aria-label="Time (minutes:seconds)"
                        />
                      )}
                      {st.showRpe && usesReps(ex.kind) && (
                        <NumField
                          className="set-input"
                          dp={1}
                          value={s.rpe}
                          placeholder="–"
                          onChange={(v) => set({ rpe: v === undefined ? undefined : Math.min(10, Math.max(1, v)) })}
                          aria-label="RPE (how hard, 1 to 10)"
                        />
                      )}
                      <button
                        className={s.done ? 'check on' : 'check'}
                        onClick={() => complete(exIdx, setIdx, ph)}
                        aria-label={s.done ? 'Mark set not done' : 'Complete set'}
                        aria-pressed={s.done}
                      >
                        <Icon name="check" size={18} />
                      </button>
                    </div>
                  )
                })}
              </div>
              <button
                className="btn sm block add-set"
                onClick={() => update((d) => void d.exercises[exIdx].sets.push({ id: uid(), type: 'normal', done: false }))}
              >
                <Icon name="plus" size={16} /> Add set
              </button>
            </section>
          )
        })}

        <button className="btn soft block lg" onClick={() => setPicker({})}>
          <Icon name="plus" /> Add exercise
        </button>
        <button
          className="btn danger block"
          onClick={() => {
            if (!confirm(editing ? 'Discard your changes?' : 'Discard this workout? Nothing will be saved.')) return
            discard()
            if (editing) goBack('/workout')
            else navigate('/workout', { replace: true })
          }}
        >
          {editing ? 'Discard changes' : 'Discard workout'}
        </button>
      </div>

      {resting && (
        <div className="rest-bar" role="timer" aria-live="off">
          <div className="track">
            <i style={{ width: `${Math.min(100, (restLeft / (active.restTotal || 1)) * 100)}%` }} />
          </div>
          <div className="row between">
            <button className="btn sm" onClick={() => adjustRest(-15)}>
              −15s
            </button>
            <div className="stack tight" style={{ alignItems: 'center', gap: 0 }}>
              <span className="tiny muted bold">{restLeft > 0 ? 'REST' : 'GO!'}</span>
              <span className="time">{fmtClock(Math.ceil(restLeft))}</span>
            </div>
            <button className="btn sm" onClick={() => adjustRest(15)}>
              +15s
            </button>
            <button className="btn sm primary" onClick={stopRest}>
              Skip
            </button>
          </div>
        </div>
      )}

      {picker && (
        <ExercisePicker
          title={picker.replace ? 'Replace exercise' : 'Add exercises'}
          multi={!picker.replace}
          onClose={() => setPicker(null)}
          onPick={(ids) =>
            update((d) => {
              if (picker.replace) {
                const we = d.exercises.find((e) => e.id === picker.replace)
                if (we) {
                  we.exerciseId = ids[0]
                  we.sets = we.sets.map((s) => ({ id: s.id, type: s.type, done: false }))
                }
              } else {
                for (const id of ids)
                  d.exercises.push({ id: uid(), exerciseId: id, sets: [1, 2, 3].map(() => ({ id: uid(), type: 'normal', done: false })) })
              }
            })
          }
        />
      )}
      {exMenu && (
        <MenuSheet
          title={map.get(active.exercises.find((e) => e.id === exMenu)?.exerciseId ?? '')?.name ?? 'Exercise'}
          items={exMenuItems(exMenu)}
          onClose={() => setExMenu(null)}
        />
      )}
      {setMenu && <MenuSheet title="Set" items={setMenuItems()} onClose={() => setSetMenu(null)} />}
      {exSettings && <ExerciseSettingsSheet weId={exSettings} onClose={() => setExSettings(null)} />}
      {plates && <PlateCalcSheet initialKg={plates.kg} onClose={() => setPlates(null)} />}
    </div>
  )
}

function ExerciseSettingsSheet({ weId, onClose }: { weId: string; onClose: () => void }) {
  const { active, update } = useActive()
  const st = useSettings()
  const we = active?.exercises.find((e) => e.id === weId)
  const [rest, setRest] = useState(we?.restSec ?? st.restSec)
  const [min, setMin] = useState(we?.repMin)
  const [max, setMax] = useState(we?.repMax)
  if (!we) return null
  return (
    <Sheet
      title="Rest timer & rep range"
      onClose={onClose}
      footer={
        <button
          className="btn primary block lg"
          onClick={() => {
            update((d) => {
              const e = d.exercises.find((x) => x.id === weId)
              if (!e) return
              e.restSec = rest
              const lo = min !== undefined && max !== undefined ? Math.min(min, max) : min ?? max
              const hi = min !== undefined && max !== undefined ? Math.max(min, max) : max ?? min
              e.repMin = lo
              e.repMax = hi
            })
            onClose()
          }}
        >
          Done
        </button>
      }
    >
      <div className="stack">
        <Field label="Rest after each set">
          <select value={rest} onChange={(e) => setRest(Number(e.target.value))}>
            {[...new Set([...REST_OPTIONS, rest])].sort((a, b) => a - b).map((r) => (
              <option key={r} value={r}>
                {r === 0 ? 'Off' : fmtClock(r)}
              </option>
            ))}
          </select>
        </Field>
        <div className="field">
          <span>Target reps</span>
          <div className="row">
            <NumField className="input" dp={0} value={min} onChange={setMin} placeholder="Min" aria-label="Minimum reps" />
            <span className="muted">to</span>
            <NumField className="input" dp={0} value={max} onChange={setMax} placeholder="Max" aria-label="Maximum reps" />
          </div>
          <small className="muted small">
            With a rep range, Forge suggests adding a rep each session, then adding weight once you hit the top of the range on every set.
          </small>
        </div>
      </div>
    </Sheet>
  )
}

function EditTimes() {
  const { active, update } = useActive()
  if (!active) return null
  const pad = (n: number) => String(n).padStart(2, '0')
  const d = new Date(active.start)
  const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  const minutes = Math.round((active.end - active.start) / 60000)
  return (
    <div className="grid-2">
      <Field label="Started">
        <input
          type="datetime-local"
          value={local}
          onChange={(e) => {
            const t = new Date(e.target.value).getTime()
            if (!Number.isNaN(t))
              update((w) => {
                const len = w.end - w.start
                w.start = t
                w.end = t + len
              })
          }}
        />
      </Field>
      <Field label="Duration (min)">
        <NumField
          className="input"
          dp={0}
          value={minutes}
          onChange={(v) => v !== undefined && update((w) => void (w.end = w.start + Math.max(1, v) * 60000))}
        />
      </Field>
    </div>
  )
}
