import { describe, expect, it } from 'vitest'
import { BUILTIN_EXERCISES } from '../data/exercises'
import { platesPerSide, PLATES_KG, PLATES_LB } from './plates'
import { incrementFor, suggestSets } from './progression'
import { e1rm, findPRs, repMaxes, workoutStats } from './strength'
import type { Exercise, WSet, Workout } from './types'
import { KG_PER_LB, kgTo } from './units'

const exMap = new Map<string, Exercise>(BUILTIN_EXERCISES.map((e) => [e.id, e]))
const bench = exMap.get('bench-press-barbell')!
const squat = exMap.get('squat-barbell')!

let n = 0
const set = (kg: number | undefined, reps: number, extra: Partial<WSet> = {}): WSet => ({
  id: `s${n++}`, type: 'normal', kg, reps, done: true, ...extra,
})

const workout = (start: number, exerciseId: string, sets: WSet[]): Workout => ({
  id: `w${start}`, name: 'W', start, end: start + 3_600_000, exercises: [{ id: `e${start}`, exerciseId, sets }],
})

describe('e1rm', () => {
  it('uses Epley and treats singles as the 1RM', () => {
    expect(e1rm(100, 1)).toBe(100)
    expect(e1rm(100, 5)).toBeCloseTo(116.67, 1)
    expect(e1rm(0, 5)).toBe(0)
  })
})

describe('workoutStats', () => {
  it('counts only completed sets', () => {
    const w = workout(1, 'bench-press-barbell', [set(100, 5), set(100, 5), set(100, 5, { done: false })])
    expect(workoutStats(w, exMap)).toMatchObject({ volume: 1000, sets: 2, reps: 10 })
  })
})

describe('findPRs', () => {
  it('flags sets that beat earlier history', () => {
    const old = workout(1, 'bench-press-barbell', [set(100, 5)])
    const now = workout(2, 'bench-press-barbell', [set(100, 5), set(105, 3), set(95, 8)])
    const prs = findPRs(now, [old, now], exMap)
    expect(prs.get(now.exercises[0].sets[0].id)).toBeUndefined()
    expect(prs.get(now.exercises[0].sets[1].id)).toEqual(['kg'])
    // 95×8 beats 105×3 on estimated 1RM and on set volume.
    expect(prs.get(now.exercises[0].sets[2].id)).toEqual(['e1rm', 'volume'])
  })

  it('needs earlier history, and ignores warm-ups', () => {
    const first = workout(1, 'bench-press-barbell', [set(60, 10, { type: 'warmup' }), set(100, 5)])
    expect(findPRs(first, [first], exMap).size).toBe(0)
    const next = workout(2, 'bench-press-barbell', [set(200, 1, { type: 'warmup' })])
    expect(findPRs(next, [first, next], exMap).size).toBe(0)
  })
})

describe('repMaxes', () => {
  it('keeps the heaviest weight per rep count', () => {
    expect(repMaxes([set(100, 5), set(110, 5), set(90, 8), set(50, 20)])).toEqual([
      { reps: 5, kg: 110 }, { reps: 8, kg: 90 },
    ])
  })
})

describe('suggestSets (double progression)', () => {
  it('adds a rep while working up the range', () => {
    const s = suggestSets([set(80, 8), set(80, 7), set(80, 6)], 3, bench, { repMin: 6, repMax: 10, unit: 'kg' })
    expect(s.map((x) => [x.kg, x.reps, x.hint])).toEqual([[80, 9, 'reps'], [80, 8, 'reps'], [80, 7, 'reps']])
  })

  it('adds weight once every set hits the top of the range', () => {
    const s = suggestSets([set(80, 10), set(80, 10)], 2, bench, { repMin: 6, repMax: 10, unit: 'kg' })
    expect(s.map((x) => [x.kg, x.reps, x.hint])).toEqual([[82.5, 6, 'up'], [82.5, 6, 'up']])
  })

  it('jumps more on lower-body barbell lifts and works in pounds', () => {
    expect(incrementFor(squat, 'kg')).toBe(5)
    expect(incrementFor(squat, 'lb')).toBe(10)
    const s = suggestSets([set(135 * KG_PER_LB, 5)], 1, bench, { repMin: 5, repMax: 5, unit: 'lb' })
    expect(kgTo(s[0].kg!, 'lb')).toBeCloseTo(140, 6)
  })

  it('repeats last time without a rep range and skips warm-ups', () => {
    const s = suggestSets([set(40, 12, { type: 'warmup' }), set(80, 8)], 2, bench, { unit: 'kg' })
    expect(s.map((x) => [x.kg, x.reps, x.hint])).toEqual([[80, 8, 'same'], [80, 8, 'same']])
  })
})

describe('platesPerSide', () => {
  it('loads a kg bar', () => {
    expect(platesPerSide(100, 20, PLATES_KG)).toEqual({ perSide: [25, 15], achieved: 100, remainder: 0 })
    expect(platesPerSide(62.5, 20, PLATES_KG).perSide).toEqual([20, 1.25])
  })

  it('loads a lb bar and reports what it can’t match', () => {
    expect(platesPerSide(225, 45, PLATES_LB).perSide).toEqual([45, 45])
    expect(platesPerSide(138, 45, PLATES_LB)).toEqual({ perSide: [45], achieved: 135, remainder: 3 })
    expect(platesPerSide(30, 45, PLATES_LB)).toMatchObject({ perSide: [], achieved: 45 })
  })
})
