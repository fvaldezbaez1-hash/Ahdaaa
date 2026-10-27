import { useMemo, useState } from 'react'
import { EQUIPMENT_LABEL, KIND_LABEL, MUSCLE_LABEL } from '../data/exercises'
import { db } from '../lib/db'
import { uid } from '../lib/id'
import type { Equipment, Exercise, ExerciseKind, Muscle } from '../lib/types'
import { useExercises, useWorkouts } from '../state'
import { Field, SearchBox } from '../ui/controls'
import { Icon } from '../ui/Icon'
import { Sheet } from '../ui/Sheet'
import { toast } from '../ui/toast'

const MUSCLES = Object.keys(MUSCLE_LABEL) as Muscle[]
const EQUIPMENT = Object.keys(EQUIPMENT_LABEL) as Equipment[]

export function matchesQuery(e: Exercise, q: string): boolean {
  const hay = `${e.name} ${MUSCLE_LABEL[e.primary]} ${EQUIPMENT_LABEL[e.equipment]}`.toLowerCase()
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((t) => hay.includes(t))
}

export function ExerciseList({
  exercises,
  selected,
  onTap,
}: {
  exercises: Exercise[]
  selected?: Set<string>
  onTap: (e: Exercise) => void
}) {
  return (
    <div className="list">
      {exercises.map((e) => {
        const on = selected?.has(e.id)
        return (
          <button key={e.id} className="list-row" onClick={() => onTap(e)} aria-pressed={selected ? on : undefined}>
            <div className="grow">
              <div className="ellipsis bold">{e.name}</div>
              <div className="small muted ellipsis">
                {MUSCLE_LABEL[e.primary]} · {EQUIPMENT_LABEL[e.equipment]}
                {e.custom ? ' · Custom' : ''}
              </div>
            </div>
            {selected ? (
              <span className={on ? 'check on' : 'check'} aria-hidden="true">
                <Icon name="check" size={18} />
              </span>
            ) : (
              <Icon name="right" className="chev" />
            )}
          </button>
        )
      })}
    </div>
  )
}

/** Searchable exercise list, filters by muscle and equipment. */
export function useExerciseFilter() {
  const { list } = useExercises()
  const [q, setQ] = useState('')
  const [muscle, setMuscle] = useState<Muscle | ''>('')
  const [equip, setEquip] = useState<Equipment | ''>('')
  const filtered = useMemo(
    () =>
      list.filter(
        (e) =>
          (!muscle || e.primary === muscle || e.secondary.includes(muscle)) &&
          (!equip || e.equipment === equip) &&
          (!q || matchesQuery(e, q)),
      ),
    [list, q, muscle, equip],
  )
  const controls = (
    <div className="stack tight">
      <SearchBox value={q} onChange={setQ} placeholder="Search exercises" />
      <div className="row">
        <select className="input" style={{ minHeight: 38, padding: '6px 10px' }} value={muscle} onChange={(e) => setMuscle(e.target.value as Muscle | '')} aria-label="Muscle">
          <option value="">All muscles</option>
          {MUSCLES.map((m) => (
            <option key={m} value={m}>
              {MUSCLE_LABEL[m]}
            </option>
          ))}
        </select>
        <select className="input" style={{ minHeight: 38, padding: '6px 10px' }} value={equip} onChange={(e) => setEquip(e.target.value as Equipment | '')} aria-label="Equipment">
          <option value="">All equipment</option>
          {EQUIPMENT.map((m) => (
            <option key={m} value={m}>
              {EQUIPMENT_LABEL[m]}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
  return { filtered, controls, filtering: !!(q || muscle || equip), query: q }
}

export function ExercisePicker({
  title = 'Add exercises',
  multi = true,
  onPick,
  onClose,
}: {
  title?: string
  multi?: boolean
  onPick: (ids: string[]) => void
  onClose: () => void
}) {
  const { map } = useExercises()
  const workouts = useWorkouts()
  const { filtered, controls, filtering, query } = useExerciseFilter()
  const [selected, setSelected] = useState<string[]>([])
  const [creating, setCreating] = useState(false)

  const recent = useMemo(() => {
    const ids: string[] = []
    for (const w of workouts ?? []) {
      for (const e of w.exercises) if (!ids.includes(e.exerciseId) && map.has(e.exerciseId)) ids.push(e.exerciseId)
      if (ids.length >= 8) break
    }
    return ids.map((id) => map.get(id)!)
  }, [workouts, map])

  const tap = (e: Exercise) => {
    if (!multi) {
      onPick([e.id])
      onClose()
      return
    }
    setSelected((s) => (s.includes(e.id) ? s.filter((x) => x !== e.id) : [...s, e.id]))
  }
  const sel = new Set(selected)

  return (
    <>
      <Sheet
        title={title}
        onClose={onClose}
        full
        footer={
          multi ? (
            <button
              className="btn primary block lg"
              disabled={selected.length === 0}
              onClick={() => {
                onPick(selected)
                onClose()
              }}
            >
              {selected.length ? `Add ${selected.length} exercise${selected.length > 1 ? 's' : ''}` : 'Select exercises'}
            </button>
          ) : undefined
        }
      >
        <div className="stack">
          {controls}
          <button className="btn soft" onClick={() => setCreating(true)}>
            <Icon name="plus" size={18} /> Create {query ? `“${query}”` : 'custom exercise'}
          </button>
          {!filtering && recent.length > 0 && (
            <>
              <div className="field-label">Recent</div>
              <ExerciseList exercises={recent} selected={multi ? sel : undefined} onTap={tap} />
              <div className="field-label">All exercises</div>
            </>
          )}
          {filtered.length ? (
            <ExerciseList exercises={filtered} selected={multi ? sel : undefined} onTap={tap} />
          ) : (
            <div className="empty">No exercises match. Create your own above.</div>
          )}
        </div>
      </Sheet>
      {creating && (
        <CreateExerciseSheet
          initialName={query}
          onClose={() => setCreating(false)}
          onCreated={(e) => {
            if (multi) setSelected((s) => [...s, e.id])
            else {
              onPick([e.id])
              onClose()
            }
          }}
        />
      )}
    </>
  )
}

const KINDS = Object.keys(KIND_LABEL) as ExerciseKind[]

export function CreateExerciseSheet({
  initialName = '',
  existing,
  onClose,
  onCreated,
}: {
  initialName?: string
  existing?: Exercise
  onClose: () => void
  onCreated?: (e: Exercise) => void
}) {
  const [name, setName] = useState(existing?.name ?? initialName)
  const [primary, setPrimary] = useState<Muscle>(existing?.primary ?? 'chest')
  const [equipment, setEquipment] = useState<Equipment>(existing?.equipment ?? 'barbell')
  const [kind, setKind] = useState<ExerciseKind>(existing?.kind ?? 'weight_reps')
  const [cues, setCues] = useState(existing?.cues ?? '')

  const save = async () => {
    const e: Exercise = {
      id: existing?.id ?? `c-${uid()}`,
      name: name.trim(),
      primary,
      secondary: existing?.secondary ?? [],
      equipment,
      kind,
      cues: cues.trim() || undefined,
      custom: true,
    }
    await db.exercises.put(e)
    toast(existing ? 'Exercise updated' : 'Exercise created')
    onCreated?.(e)
    onClose()
  }

  return (
    <Sheet
      title={existing ? 'Edit exercise' : 'New exercise'}
      onClose={onClose}
      footer={
        <button className="btn primary block lg" disabled={!name.trim()} onClick={save}>
          Save
        </button>
      }
    >
      <div className="stack">
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Landmine Press" autoFocus />
        </Field>
        <Field label="Main muscle">
          <select value={primary} onChange={(e) => setPrimary(e.target.value as Muscle)}>
            {MUSCLES.map((m) => (
              <option key={m} value={m}>
                {MUSCLE_LABEL[m]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Equipment">
          <select value={equipment} onChange={(e) => setEquipment(e.target.value as Equipment)}>
            {EQUIPMENT.map((m) => (
              <option key={m} value={m}>
                {EQUIPMENT_LABEL[m]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="What you log" hint={existing ? 'Changing this doesn’t convert sets you already logged.' : undefined}>
          <select value={kind} onChange={(e) => setKind(e.target.value as ExerciseKind)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Notes / form cues (optional)">
          <textarea value={cues} onChange={(e) => setCues(e.target.value)} />
        </Field>
      </div>
    </Sheet>
  )
}
