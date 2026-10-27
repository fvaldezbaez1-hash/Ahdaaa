import { db } from '../lib/db'
import { uid } from '../lib/id'
import type { Routine, RoutineExercise, Workout } from '../lib/types'

/**
 * A routine keeps the structure (exercises, set types, rep ranges, rest);
 * weights and reps come from your history each time, so the progression
 * suggestions always start from what you actually did last.
 */
export function workoutToRoutineExercises(w: Workout): RoutineExercise[] {
  return w.exercises.map((e) => ({
    id: uid(),
    exerciseId: e.exerciseId,
    restSec: e.restSec,
    repMin: e.repMin,
    repMax: e.repMax,
    notes: e.notes || undefined,
    supersetId: e.supersetId,
    sets: e.sets.map((s) => ({ type: s.type })),
  }))
}

export async function nextRoutineOrder(): Promise<number> {
  const last = await db.routines.orderBy('order').last()
  return (last?.order ?? -1) + 1
}

export async function saveWorkoutAsRoutine(w: Workout, name = w.name): Promise<Routine> {
  const r: Routine = { id: uid(), name, order: await nextRoutineOrder(), updatedAt: Date.now(), exercises: workoutToRoutineExercises(w) }
  await db.routines.put(r)
  return r
}

/**
 * Folds what you added during a workout (new exercises, extra sets, changed
 * rep ranges or rest) back into its routine. Never removes anything: skipping
 * an exercise one day shouldn't delete it from the plan. Returns null when
 * there's nothing new.
 */
export function mergeIntoRoutine(r: Routine, w: Workout): RoutineExercise[] | null {
  const out = structuredClone(r.exercises)
  const used = new Set<number>()
  const fromWorkout = workoutToRoutineExercises(w)
  w.exercises.forEach((we, i) => {
    const idx = out.findIndex((e, j) => !used.has(j) && e.exerciseId === we.exerciseId)
    if (idx === -1) {
      out.push(fromWorkout[i])
      used.add(out.length - 1)
      return
    }
    used.add(idx)
    const re = out[idx]
    if (we.sets.length > re.sets.length) re.sets = we.sets.map((s) => ({ type: s.type }))
    if (we.restSec !== undefined) re.restSec = we.restSec
    if (we.repMin !== undefined) re.repMin = we.repMin
    if (we.repMax !== undefined) re.repMax = we.repMax
  })
  return JSON.stringify(out) === JSON.stringify(r.exercises) ? null : out
}

export async function updateRoutineFromWorkout(routineId: string, w: Workout): Promise<void> {
  const r = await db.routines.get(routineId)
  const merged = r && mergeIntoRoutine(r, w)
  if (r && merged) await db.routines.put({ ...r, exercises: merged, updatedAt: Date.now() })
}

export async function duplicateRoutine(r: Routine): Promise<void> {
  await db.routines.put({
    ...structuredClone(r),
    id: uid(),
    name: `${r.name} (copy)`,
    order: await nextRoutineOrder(),
    updatedAt: Date.now(),
  })
}
