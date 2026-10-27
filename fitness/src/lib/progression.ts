import { isWorkingSet, usesWeight } from './strength'
import type { Exercise, Muscle, WSet } from './types'
import { kgTo, round, toKg, type WeightUnit } from './units'

export interface Suggestion {
  kg?: number
  reps?: number
  seconds?: number
  meters?: number
  /** 'up' = add weight, 'reps' = add a rep, 'same' = repeat last time. */
  hint: 'up' | 'reps' | 'same'
}

const LOWER: Muscle[] = ['quads', 'hamstrings', 'glutes', 'lower_back', 'adductors', 'abductors', 'calves']

/** Weight jump in the user's unit: bigger for barbell/machine lower-body lifts. */
export function incrementFor(ex: Exercise, unit: WeightUnit): number {
  const lower = LOWER.includes(ex.primary) || ex.primary === 'full_body'
  if (ex.equipment === 'dumbbell' || ex.equipment === 'kettlebell') return unit === 'lb' ? 5 : 2
  if (ex.equipment === 'cable' || ex.equipment === 'band') return unit === 'lb' ? 5 : 2.5
  if (lower && (ex.equipment === 'barbell' || ex.equipment === 'machine' || ex.equipment === 'smith' || ex.equipment === 'other'))
    return unit === 'lb' ? 10 : 5
  return unit === 'lb' ? 5 : 2.5
}

/**
 * Double progression: work up the rep range at a weight; once every working
 * set reaches the top of the range, add weight and drop back to the bottom.
 * Without a rep range, it suggests repeating last session.
 */
export function suggestSets(
  prev: WSet[],
  count: number,
  ex: Exercise,
  opts: { repMin?: number; repMax?: number; unit: WeightUnit },
): Suggestion[] {
  const working = prev.filter((s) => isWorkingSet(s) && s.type !== 'drop')
  if (working.length === 0 || count <= 0) return []
  const pick = (i: number) => working[Math.min(i, working.length - 1)]
  const { repMin, repMax, unit } = opts
  const hasRange = repMin !== undefined && repMax !== undefined && repMax >= repMin
  const weighted = usesWeight(ex.kind) && ex.kind !== 'assisted_bw'

  const out: Suggestion[] = []
  if (weighted && hasRange) {
    const allTop = working.every((s) => (s.reps ?? 0) >= repMax!)
    const inc = incrementFor(ex, unit)
    for (let i = 0; i < count; i++) {
      const p = pick(i)
      if (allTop && p.kg !== undefined) {
        out.push({ kg: toKg(round(kgTo(p.kg, unit) + inc, 2), unit), reps: repMin, hint: 'up' })
      } else {
        const reps = Math.min((p.reps ?? 0) + 1, repMax!)
        out.push({ kg: p.kg, reps: Math.max(reps, repMin!), hint: reps > (p.reps ?? 0) ? 'reps' : 'same' })
      }
    }
    return out
  }

  if (ex.kind === 'reps' && hasRange) {
    for (let i = 0; i < count; i++) {
      const p = pick(i)
      const reps = Math.min((p.reps ?? 0) + 1, repMax!)
      out.push({ reps: Math.max(reps, repMin!), hint: reps > (p.reps ?? 0) ? 'reps' : 'same' })
    }
    return out
  }

  for (let i = 0; i < count; i++) {
    const p = pick(i)
    out.push({ kg: p.kg, reps: p.reps, seconds: p.seconds, meters: p.meters, hint: 'same' })
  }
  return out
}
