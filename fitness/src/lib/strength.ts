import type { Exercise, ExerciseKind, WSet, Workout } from './types'

/** Estimated one-rep max (Epley). */
export function e1rm(kg: number, reps: number): number {
  if (!(kg > 0) || !(reps > 0)) return 0
  return reps === 1 ? kg : kg * (1 + reps / 30)
}

export const usesWeight = (k: ExerciseKind) => k === 'weight_reps' || k === 'weighted_bw' || k === 'assisted_bw'
export const usesReps = (k: ExerciseKind) => k === 'weight_reps' || k === 'reps' || k === 'weighted_bw' || k === 'assisted_bw'
export const usesSeconds = (k: ExerciseKind) => k === 'duration' || k === 'distance_duration'
export const usesDistance = (k: ExerciseKind) => k === 'distance_duration'

/** Completed sets that count toward progress (warm-ups don't). */
export const isWorkingSet = (s: WSet) => s.done && s.type !== 'warmup'

/** kg × reps; assisted sets and pure bodyweight sets add no volume. */
export function setVolume(s: WSet, kind: ExerciseKind): number {
  if (kind !== 'weight_reps' && kind !== 'weighted_bw') return 0
  return (s.kg ?? 0) * (s.reps ?? 0)
}

export function workoutStats(w: Workout, exercises: Map<string, Exercise>) {
  let volume = 0
  let sets = 0
  let reps = 0
  for (const we of w.exercises) {
    const kind = exercises.get(we.exerciseId)?.kind ?? 'weight_reps'
    for (const s of we.sets) {
      if (!s.done) continue
      sets++
      reps += s.reps ?? 0
      volume += setVolume(s, kind)
    }
  }
  return { volume, sets, reps, durationSec: Math.max(0, (w.end - w.start) / 1000) }
}

export interface Bests {
  kg?: number
  e1rm?: number
  volume?: number
  reps?: number
  seconds?: number
  meters?: number
}

export type PRType = keyof Bests

export const PR_LABEL: Record<PRType, string> = {
  kg: 'Heaviest weight',
  e1rm: 'Best est. 1RM',
  volume: 'Best set volume',
  reps: 'Most reps',
  seconds: 'Longest time',
  meters: 'Longest distance',
}

/** Which records make sense for an exercise type. */
export function prTypesFor(kind: ExerciseKind): PRType[] {
  switch (kind) {
    case 'weight_reps':
    case 'weighted_bw':
      return ['kg', 'e1rm', 'volume']
    case 'reps':
    case 'assisted_bw':
      return ['reps']
    case 'duration':
      return ['seconds']
    case 'distance_duration':
      return ['meters']
  }
}

function setValue(s: WSet, t: PRType, kind: ExerciseKind): number {
  switch (t) {
    case 'kg':
      return s.reps && s.reps > 0 ? s.kg ?? 0 : 0
    case 'e1rm':
      return e1rm(s.kg ?? 0, s.reps ?? 0)
    case 'volume':
      return setVolume(s, kind)
    case 'reps':
      return s.reps ?? 0
    case 'seconds':
      return s.seconds ?? 0
    case 'meters':
      return s.meters ?? 0
  }
}

export function bestsOf(sets: WSet[], kind: ExerciseKind): Bests {
  const b: Bests = {}
  for (const s of sets) {
    if (!isWorkingSet(s)) continue
    for (const t of prTypesFor(kind)) {
      const v = setValue(s, t, kind)
      if (v > 0 && v > (b[t] ?? 0)) b[t] = v
    }
  }
  return b
}

/** Sessions of one exercise, newest first. */
export function exerciseSessions(workouts: Workout[], exerciseId: string): { workout: Workout; sets: WSet[] }[] {
  const out: { workout: Workout; sets: WSet[] }[] = []
  for (const w of workouts) {
    const sets = w.exercises.filter((e) => e.exerciseId === exerciseId).flatMap((e) => e.sets)
    if (sets.some((s) => s.done)) out.push({ workout: w, sets })
  }
  return out.sort((a, b) => b.workout.start - a.workout.start)
}

/**
 * Personal records set in `w`, compared with everything before it.
 * An exercise needs earlier history before a set can count as a PR, so a
 * first-ever workout doesn't light up every set.
 */
export function findPRs(w: Workout, history: Workout[], exercises: Map<string, Exercise>): Map<string, PRType[]> {
  const prs = new Map<string, PRType[]>()
  const earlier = history.filter((h) => h.start < w.start && h.id !== w.id)
  for (const we of w.exercises) {
    const kind = exercises.get(we.exerciseId)?.kind ?? 'weight_reps'
    const prevSets = earlier.flatMap((h) => h.exercises.filter((e) => e.exerciseId === we.exerciseId).flatMap((e) => e.sets))
    if (!prevSets.some(isWorkingSet)) continue
    const best = bestsOf(prevSets, kind)
    for (const s of we.sets) {
      if (!isWorkingSet(s)) continue
      const hit: PRType[] = []
      for (const t of prTypesFor(kind)) {
        const v = setValue(s, t, kind)
        if (v > 0 && v > (best[t] ?? 0) + 1e-9) {
          hit.push(t)
          best[t] = v
        }
      }
      if (hit.length) prs.set(s.id, hit)
    }
  }
  return prs
}

/** Heaviest weight lifted for each rep count from 1 to 12. */
export function repMaxes(sets: WSet[]): { reps: number; kg: number }[] {
  const best = new Map<number, number>()
  for (const s of sets) {
    if (!isWorkingSet(s) || !s.reps || !s.kg) continue
    if (s.reps > 12) continue
    if (s.kg > (best.get(s.reps) ?? 0)) best.set(s.reps, s.kg)
  }
  return [...best.entries()].sort((a, b) => a[0] - b[0]).map(([reps, kg]) => ({ reps, kg }))
}

export interface StrengthTrend {
  /** Lifts compared (done in both windows). */
  lifts: number
  /** Average change in best estimated 1RM, in percent. */
  changePct: number
  /** Exercise ids that dropped more than 5%. */
  down: string[]
}

/**
 * Strength check for a cut: best estimated 1RM per weighted lift over the last
 * two weeks versus the four weeks before. Holding strength while losing weight
 * is the practical sign that muscle is being kept; a clear drop is an early
 * warning to slow down. Needs at least two lifts done in both windows.
 */
export function strengthTrend(workouts: Workout[], exercises: Map<string, Exercise>, now = Date.now()): StrengthTrend | undefined {
  const DAY = 86_400_000
  const recentFrom = now - 14 * DAY
  const baseFrom = now - 42 * DAY
  const recent = new Map<string, number>()
  const base = new Map<string, number>()
  for (const w of workouts) {
    if (w.start < baseFrom || w.start > now) continue
    const into = w.start >= recentFrom ? recent : base
    for (const we of w.exercises) {
      const kind = exercises.get(we.exerciseId)?.kind
      if (kind !== 'weight_reps' && kind !== 'weighted_bw') continue
      for (const s of we.sets) {
        if (!isWorkingSet(s) || !s.reps || s.reps > 15) continue
        const v = e1rm(s.kg ?? 0, s.reps)
        if (v > (into.get(we.exerciseId) ?? 0)) into.set(we.exerciseId, v)
      }
    }
  }
  const changes: [string, number][] = []
  for (const [id, b] of base) {
    const r = recent.get(id)
    if (r !== undefined && b > 0) changes.push([id, r / b - 1])
  }
  if (changes.length < 2) return undefined
  const mean = changes.reduce((a, [, c]) => a + c, 0) / changes.length
  return {
    lifts: changes.length,
    changePct: Math.round(mean * 1000) / 10,
    down: changes.filter(([, c]) => c < -0.05).map(([id]) => id),
  }
}
