import { describe, expect, it } from 'vitest'
import type { Routine, Workout } from '../lib/types'
import { mergeIntoRoutine } from './routines'

const routine: Routine = {
  id: 'r', name: 'Push', order: 0, updatedAt: 0,
  exercises: [
    { id: 'a', exerciseId: 'bench-press-barbell', sets: [{ type: 'normal' }, { type: 'normal' }, { type: 'normal' }], repMin: 6, repMax: 10, restSec: 120 },
    { id: 'b', exerciseId: 'triceps-pushdown', sets: [{ type: 'normal' }, { type: 'normal' }], repMin: 10, repMax: 15 },
  ],
}

const set = (type: 'normal' | 'warmup' = 'normal') => ({ id: Math.random().toString(), type, kg: 50, reps: 8, done: true })

const workout = (exercises: Workout['exercises']): Workout => ({ id: 'w', name: 'Push', start: 0, end: 1, exercises, routineId: 'r' })

describe('mergeIntoRoutine', () => {
  it('ignores skipped exercises and sets', () => {
    const w = workout([{ id: 'x', exerciseId: 'bench-press-barbell', sets: [set(), set()], repMin: 6, repMax: 10, restSec: 120 }])
    expect(mergeIntoRoutine(routine, w)).toBeNull()
  })

  it('adds new exercises and extra sets without removing anything', () => {
    const w = workout([
      { id: 'x', exerciseId: 'bench-press-barbell', sets: [set('warmup'), set(), set(), set()], repMin: 6, repMax: 10, restSec: 120 },
      { id: 'y', exerciseId: 'lateral-raise-dumbbell', sets: [set(), set()] },
    ])
    const merged = mergeIntoRoutine(routine, w)!
    expect(merged.map((e) => e.exerciseId)).toEqual(['bench-press-barbell', 'triceps-pushdown', 'lateral-raise-dumbbell'])
    expect(merged[0].sets.map((s) => s.type)).toEqual(['warmup', 'normal', 'normal', 'normal'])
    expect(merged[1]).toEqual(routine.exercises[1])
  })

  it('picks up rep-range and rest changes', () => {
    const w = workout([{ id: 'x', exerciseId: 'bench-press-barbell', sets: [set()], repMin: 5, repMax: 8, restSec: 180 }])
    expect(mergeIntoRoutine(routine, w)![0]).toMatchObject({ repMin: 5, repMax: 8, restSec: 180 })
  })
})
