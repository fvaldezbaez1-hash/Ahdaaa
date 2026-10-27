import { EXERCISE_ALIASES } from '../data/exercises'
import { parseCsv, toCsv } from './csv'
import { uid } from './id'
import type { Equipment, Exercise, ExerciseKind, Muscle, SetType, WExercise, WSet, Workout } from './types'
import { KG_PER_LB, type DistanceUnit, type WeightUnit } from './units'

// Import/export of workout history in the CSV formats Hevy and Strong use,
// so switching apps doesn't mean starting over.

export type CsvFormat = 'hevy' | 'strong'

export interface ImportResult {
  format: CsvFormat
  workouts: Workout[]
  newExercises: Exercise[]
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

export function exerciseMatcher(exercises: Exercise[]) {
  const byName = new Map(exercises.map((e) => [norm(e.name), e]))
  const byId = new Map(exercises.map((e) => [e.id, e]))
  return (name: string): Exercise | undefined => {
    const n = norm(name)
    return byName.get(n) ?? byId.get(EXERCISE_ALIASES[n] ?? '')
  }
}

export function detectFormat(header: string[]): CsvFormat | null {
  const h = header.map(norm)
  if (h.includes('exercise_title') && h.includes('start_time')) return 'hevy'
  if (h.includes('exercise name') && h.includes('set order')) return 'strong'
  return null
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
}
const MONTH_NAMES = Object.keys(MONTHS).map((m) => m[0].toUpperCase() + m.slice(1))

/** Hevy: "16 Oct 2026, 18:30" (local time). */
export function parseHevyDate(s: string): number | undefined {
  const m = s.trim().match(/^(\d{1,2}) ([A-Za-z]{3})[a-z]* (\d{4}),? (\d{1,2}):(\d{2})/)
  if (m && MONTHS[m[2].toLowerCase()] !== undefined)
    return new Date(+m[3], MONTHS[m[2].toLowerCase()], +m[1], +m[4], +m[5]).getTime()
  const t = Date.parse(s)
  return Number.isNaN(t) ? undefined : t
}

export function fmtHevyDate(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Strong: "2026-10-16 18:30:00" (local time). */
export function parseStrongDate(s: string): number | undefined {
  const m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)).getTime()
  const t = Date.parse(s)
  return Number.isNaN(t) ? undefined : t
}

/** Strong: "1h 5m", "45m", "50s" → seconds. */
export function parseStrongDuration(s: string): number {
  let sec = 0
  for (const [, n, u] of s.matchAll(/(\d+)\s*([hms])/g)) sec += +n * (u === 'h' ? 3600 : u === 'm' ? 60 : 1)
  return sec
}

const num = (s: string | undefined) => {
  if (s === undefined) return undefined
  const t = s.trim().replace(',', '.')
  if (t === '') return undefined
  const n = Number(t)
  return Number.isFinite(n) ? n : undefined
}

// Best-effort muscle and equipment guesses for exercises we don't know.
const MUSCLE_HINTS: [string, Muscle][] = [
  ['leg curl', 'hamstrings'], ['leg extension', 'quads'], ['calf', 'calves'], ['hip thrust', 'glutes'],
  ['glute', 'glutes'], ['abduct', 'abductors'], ['adduct', 'adductors'], ['romanian', 'hamstrings'],
  ['deadlift', 'lower_back'], ['squat', 'quads'], ['lunge', 'quads'], ['leg press', 'quads'],
  ['bench', 'chest'], ['fly', 'chest'], ['push up', 'chest'], ['chest', 'chest'], ['dip', 'triceps'],
  ['tricep', 'triceps'], ['skull', 'triceps'], ['curl', 'biceps'], ['pulldown', 'lats'], ['pull up', 'lats'],
  ['chin', 'lats'], ['row', 'upper_back'], ['shrug', 'traps'], ['lateral', 'shoulders'], ['shoulder', 'shoulders'],
  ['overhead', 'shoulders'], ['press', 'shoulders'], ['crunch', 'abs'], ['plank', 'abs'], ['sit up', 'abs'],
  ['run', 'cardio'], ['walk', 'cardio'], ['bike', 'cardio'], ['cycl', 'cardio'], ['elliptical', 'cardio'],
  ['stair', 'cardio'], ['swim', 'cardio'],
]
const EQUIP_HINTS: [string, Equipment][] = [
  ['(barbell)', 'barbell'], ['(dumbbell)', 'dumbbell'], ['(machine)', 'machine'], ['(cable)', 'cable'],
  ['(kettlebell)', 'kettlebell'], ['(band)', 'band'], ['(smith machine)', 'smith'], ['(ez bar)', 'ez_bar'],
  ['(bodyweight)', 'bodyweight'], ['(plate)', 'plate'],
]

function guessExercise(name: string, sets: WSet[]): Exercise {
  const n = norm(name)
  const primary = MUSCLE_HINTS.find(([k]) => n.includes(k))?.[1] ?? 'full_body'
  const equipment = EQUIP_HINTS.find(([k]) => n.includes(k))?.[1] ?? 'other'
  let kind: ExerciseKind = 'reps'
  if (sets.some((s) => (s.kg ?? 0) > 0)) kind = 'weight_reps'
  else if (sets.some((s) => (s.reps ?? 0) > 0)) kind = 'reps'
  else if (sets.some((s) => (s.meters ?? 0) > 0)) kind = 'distance_duration'
  else if (sets.some((s) => (s.seconds ?? 0) > 0)) kind = 'duration'
  return { id: `c-${uid()}`, name: name.trim(), primary, secondary: [], equipment, kind, custom: true }
}

interface RawSet {
  wkey: string
  title: string
  start: number
  end: number
  notes?: string
  exercise: string
  exNotes?: string
  superset?: string
  set: WSet
}

function hevyRows(rows: string[][]): RawSet[] {
  const h = rows[0].map(norm)
  const col = (r: string[], name: string) => {
    const i = h.indexOf(name)
    return i === -1 ? undefined : r[i]
  }
  const out: RawSet[] = []
  for (const r of rows.slice(1)) {
    const start = parseHevyDate(col(r, 'start_time') ?? '')
    const exercise = col(r, 'exercise_title')
    if (start === undefined || !exercise) continue
    const end = parseHevyDate(col(r, 'end_time') ?? '') ?? start
    const lbs = num(col(r, 'weight_lbs'))
    const kg = num(col(r, 'weight_kg')) ?? (lbs !== undefined ? lbs * KG_PER_LB : undefined)
    const miles = num(col(r, 'distance_miles'))
    const km = num(col(r, 'distance_km'))
    const meters = km !== undefined ? km * 1000 : miles !== undefined ? miles * 1609.344 : undefined
    const t = (col(r, 'set_type') ?? '').toLowerCase()
    const type: SetType = t === 'warmup' ? 'warmup' : t.startsWith('drop') ? 'drop' : t === 'failure' ? 'failure' : 'normal'
    const title = col(r, 'title') || 'Workout'
    out.push({
      wkey: `${title}|${start}`,
      title,
      start,
      end: Math.max(end, start),
      notes: col(r, 'description') || undefined,
      exercise,
      exNotes: col(r, 'exercise_notes') || undefined,
      superset: col(r, 'superset_id') || undefined,
      set: {
        id: uid(),
        type,
        kg: kg || undefined,
        reps: num(col(r, 'reps')) || undefined,
        rpe: num(col(r, 'rpe')) || undefined,
        seconds: num(col(r, 'duration_seconds')) || undefined,
        meters: meters || undefined,
        done: true,
      },
    })
  }
  return out
}

function strongRows(rows: string[][], wu: WeightUnit, du: DistanceUnit): RawSet[] {
  const h = rows[0].map(norm)
  const col = (r: string[], name: string) => {
    const i = h.indexOf(name)
    return i === -1 ? undefined : r[i]
  }
  const out: RawSet[] = []
  for (const r of rows.slice(1)) {
    const start = parseStrongDate(col(r, 'date') ?? '')
    const exercise = col(r, 'exercise name')
    const order = (col(r, 'set order') ?? '').trim().toUpperCase()
    if (start === undefined || !exercise || !/^(\d+|W|D|F)$/.test(order)) continue
    // Older exports carry their own unit columns; newer ones use the app's setting.
    const rowWu = (col(r, 'weight unit') ?? '').toLowerCase().startsWith('lb') ? 'lb' : col(r, 'weight unit') ? 'kg' : wu
    const rowDu = (col(r, 'distance unit') ?? '').toLowerCase().startsWith('mi') ? 'mi' : col(r, 'distance unit') ? 'km' : du
    const w = num(col(r, 'weight'))
    const d = num(col(r, 'distance'))
    const title = col(r, 'workout name') || 'Workout'
    out.push({
      wkey: `${title}|${start}`,
      title,
      start,
      end: start + parseStrongDuration(col(r, 'duration') ?? '') * 1000,
      notes: col(r, 'workout notes') || undefined,
      exercise,
      exNotes: col(r, 'notes') || undefined,
      set: {
        id: uid(),
        type: order === 'W' ? 'warmup' : order === 'D' ? 'drop' : order === 'F' ? 'failure' : 'normal',
        kg: w ? (rowWu === 'lb' ? w * KG_PER_LB : w) : undefined,
        reps: num(col(r, 'reps')) || undefined,
        rpe: num(col(r, 'rpe')) || undefined,
        seconds: num(col(r, 'seconds')) || undefined,
        meters: d ? (rowDu === 'mi' ? d * 1609.344 : d * 1000) : undefined,
        done: true,
      },
    })
  }
  return out
}

export function importWorkoutCsv(
  text: string,
  opts: { exercises: Exercise[]; weightUnit: WeightUnit; distanceUnit: DistanceUnit },
): ImportResult {
  const rows = parseCsv(text)
  if (rows.length < 2) throw new Error('That file is empty.')
  const format = detectFormat(rows[0])
  if (!format) throw new Error('This doesn’t look like a Hevy or Strong workout export.')
  const raw = format === 'hevy' ? hevyRows(rows) : strongRows(rows, opts.weightUnit, opts.distanceUnit)

  const match = exerciseMatcher(opts.exercises)
  const created = new Map<string, Exercise>()
  const setsByName = new Map<string, WSet[]>()
  for (const r of raw) {
    if (match(r.exercise)) continue
    const k = norm(r.exercise)
    setsByName.set(k, [...(setsByName.get(k) ?? []), r.set])
  }
  for (const r of raw) {
    const k = norm(r.exercise)
    if (!match(r.exercise) && !created.has(k)) created.set(k, guessExercise(r.exercise, setsByName.get(k) ?? []))
  }
  const resolve = (name: string) => match(name) ?? created.get(norm(name))!

  const workouts = new Map<string, Workout>()
  const lastExName = new Map<string, string>()
  for (const r of raw) {
    let w = workouts.get(r.wkey)
    if (!w) {
      w = { id: uid(), name: r.title, start: r.start, end: r.end, exercises: [], notes: r.notes }
      workouts.set(r.wkey, w)
    }
    const ex = resolve(r.exercise)
    if (ex.kind === 'reps' || ex.kind === 'duration' || ex.kind === 'distance_duration') delete r.set.kg
    let we: WExercise | undefined = w.exercises[w.exercises.length - 1]
    if (!we || lastExName.get(r.wkey) !== norm(r.exercise)) {
      we = { id: uid(), exerciseId: ex.id, sets: [], notes: r.exNotes }
      if (r.superset) we.supersetId = `${w.id}-${r.superset}`
      w.exercises.push(we)
      lastExName.set(r.wkey, norm(r.exercise))
    }
    we.sets.push(r.set)
  }

  return {
    format,
    workouts: [...workouts.values()].sort((a, b) => a.start - b.start),
    newExercises: [...created.values()],
  }
}

/** Hevy-format CSV, so your history can go back into Hevy (or come back here). */
export function exportWorkoutCsv(workouts: Workout[], exercises: Map<string, Exercise>): string {
  const rows: unknown[][] = [[
    'title', 'start_time', 'end_time', 'description', 'exercise_title', 'superset_id', 'exercise_notes',
    'set_index', 'set_type', 'weight_kg', 'reps', 'distance_km', 'duration_seconds', 'rpe',
  ]]
  const r3 = (n: number | undefined) => (n === undefined ? '' : Math.round(n * 1000) / 1000)
  for (const w of [...workouts].sort((a, b) => a.start - b.start)) {
    const supersets = new Map<string, number>()
    for (const we of w.exercises) {
      if (we.supersetId && !supersets.has(we.supersetId)) supersets.set(we.supersetId, supersets.size)
      we.sets.forEach((s, i) => {
        rows.push([
          w.name, fmtHevyDate(w.start), fmtHevyDate(w.end), w.notes ?? '',
          exercises.get(we.exerciseId)?.name ?? 'Unknown exercise',
          we.supersetId ? supersets.get(we.supersetId) : '', we.notes ?? '', i,
          s.type === 'drop' ? 'dropset' : s.type, r3(s.kg), s.reps ?? '',
          s.meters === undefined ? '' : r3(s.meters / 1000), s.seconds ?? '', s.rpe ?? '',
        ])
      })
    }
  }
  return toCsv(rows)
}
