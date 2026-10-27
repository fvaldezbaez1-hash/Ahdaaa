import { uid } from '../lib/id'
import type { Routine, RoutineExercise } from '../lib/types'

interface TExercise {
  ex: string
  sets: number
  /** Target rep range; drives the "add weight / add a rep" suggestions. */
  reps?: [number, number]
  /** Target seconds for timed exercises. */
  sec?: number
  rest: number
}

export interface ProgramTemplate {
  id: string
  name: string
  summary: string
  level: 'Beginner' | 'Intermediate'
  daysPerWeek: string
  equipment: 'Gym' | 'Dumbbells' | 'None'
  routines: { name: string; exercises: TExercise[] }[]
}

export const PROGRAMS: ProgramTemplate[] = [
  {
    id: 'full-body-beginner',
    name: 'Full Body Beginner',
    summary: 'Two alternating full-body workouts. Great first program: train 3 days a week (A, B, A then B, A, B).',
    level: 'Beginner',
    daysPerWeek: '3',
    equipment: 'Gym',
    routines: [
      {
        name: 'Full Body A',
        exercises: [
          { ex: 'squat-barbell', sets: 3, reps: [6, 10], rest: 150 },
          { ex: 'bench-press-barbell', sets: 3, reps: [6, 10], rest: 120 },
          { ex: 'seated-row-cable', sets: 3, reps: [8, 12], rest: 90 },
          { ex: 'lateral-raise-dumbbell', sets: 2, reps: [12, 15], rest: 60 },
          { ex: 'plank', sets: 3, sec: 45, rest: 60 },
        ],
      },
      {
        name: 'Full Body B',
        exercises: [
          { ex: 'romanian-deadlift-barbell', sets: 3, reps: [8, 10], rest: 120 },
          { ex: 'shoulder-press-dumbbell', sets: 3, reps: [8, 12], rest: 90 },
          { ex: 'lat-pulldown', sets: 3, reps: [8, 12], rest: 90 },
          { ex: 'leg-press', sets: 2, reps: [10, 15], rest: 90 },
          { ex: 'bicep-curl-dumbbell', sets: 2, reps: [10, 15], rest: 60 },
          { ex: 'triceps-pushdown', sets: 2, reps: [10, 15], rest: 60 },
        ],
      },
    ],
  },
  {
    id: 'ppl',
    name: 'Push / Pull / Legs',
    summary: 'The classic bodybuilding split. Run it 3 days a week, or twice through for 6 days.',
    level: 'Intermediate',
    daysPerWeek: '3–6',
    equipment: 'Gym',
    routines: [
      {
        name: 'Push',
        exercises: [
          { ex: 'bench-press-barbell', sets: 4, reps: [6, 10], rest: 150 },
          { ex: 'incline-bench-press-dumbbell', sets: 3, reps: [8, 12], rest: 120 },
          { ex: 'shoulder-press-dumbbell', sets: 3, reps: [8, 12], rest: 90 },
          { ex: 'lateral-raise-dumbbell', sets: 3, reps: [12, 20], rest: 60 },
          { ex: 'triceps-rope-pushdown', sets: 3, reps: [10, 15], rest: 60 },
          { ex: 'overhead-triceps-extension-cable', sets: 2, reps: [10, 15], rest: 60 },
        ],
      },
      {
        name: 'Pull',
        exercises: [
          { ex: 'pull-up', sets: 3, reps: [6, 10], rest: 120 },
          { ex: 'bent-over-row-barbell', sets: 3, reps: [6, 10], rest: 120 },
          { ex: 'seated-row-cable', sets: 3, reps: [8, 12], rest: 90 },
          { ex: 'face-pull', sets: 3, reps: [12, 15], rest: 60 },
          { ex: 'bicep-curl-barbell', sets: 3, reps: [8, 12], rest: 60 },
          { ex: 'hammer-curl', sets: 2, reps: [10, 15], rest: 60 },
        ],
      },
      {
        name: 'Legs',
        exercises: [
          { ex: 'squat-barbell', sets: 4, reps: [6, 10], rest: 180 },
          { ex: 'romanian-deadlift-barbell', sets: 3, reps: [8, 10], rest: 120 },
          { ex: 'leg-press', sets: 3, reps: [10, 15], rest: 120 },
          { ex: 'lying-leg-curl', sets: 3, reps: [10, 15], rest: 60 },
          { ex: 'standing-calf-raise-machine', sets: 4, reps: [10, 15], rest: 60 },
          { ex: 'hanging-leg-raise', sets: 3, reps: [10, 15], rest: 60 },
        ],
      },
    ],
  },
  {
    id: 'upper-lower',
    name: 'Upper / Lower',
    summary: 'Four days a week, each muscle trained twice. A balance of strength and size.',
    level: 'Intermediate',
    daysPerWeek: '4',
    equipment: 'Gym',
    routines: [
      {
        name: 'Upper A',
        exercises: [
          { ex: 'bench-press-barbell', sets: 4, reps: [5, 8], rest: 150 },
          { ex: 'bent-over-row-barbell', sets: 4, reps: [6, 10], rest: 120 },
          { ex: 'overhead-press-barbell', sets: 3, reps: [6, 10], rest: 120 },
          { ex: 'lat-pulldown', sets: 3, reps: [8, 12], rest: 90 },
          { ex: 'bicep-curl-dumbbell', sets: 2, reps: [10, 15], rest: 60 },
          { ex: 'triceps-pushdown', sets: 2, reps: [10, 15], rest: 60 },
        ],
      },
      {
        name: 'Lower A',
        exercises: [
          { ex: 'squat-barbell', sets: 4, reps: [5, 8], rest: 180 },
          { ex: 'romanian-deadlift-barbell', sets: 3, reps: [8, 10], rest: 120 },
          { ex: 'leg-extension', sets: 3, reps: [10, 15], rest: 60 },
          { ex: 'seated-leg-curl', sets: 3, reps: [10, 15], rest: 60 },
          { ex: 'standing-calf-raise-machine', sets: 3, reps: [10, 15], rest: 60 },
          { ex: 'plank', sets: 3, sec: 45, rest: 60 },
        ],
      },
      {
        name: 'Upper B',
        exercises: [
          { ex: 'incline-bench-press-dumbbell', sets: 3, reps: [8, 12], rest: 120 },
          { ex: 'pull-up', sets: 3, reps: [6, 10], rest: 120 },
          { ex: 'shoulder-press-dumbbell', sets: 3, reps: [8, 12], rest: 90 },
          { ex: 'seated-row-cable', sets: 3, reps: [8, 12], rest: 90 },
          { ex: 'lateral-raise-dumbbell', sets: 3, reps: [12, 20], rest: 60 },
          { ex: 'hammer-curl', sets: 2, reps: [10, 15], rest: 60 },
          { ex: 'overhead-triceps-extension-dumbbell', sets: 2, reps: [10, 15], rest: 60 },
        ],
      },
      {
        name: 'Lower B',
        exercises: [
          { ex: 'deadlift-barbell', sets: 3, reps: [3, 6], rest: 180 },
          { ex: 'bulgarian-split-squat', sets: 3, reps: [8, 12], rest: 90 },
          { ex: 'hip-thrust-barbell', sets: 3, reps: [8, 12], rest: 90 },
          { ex: 'lying-leg-curl', sets: 3, reps: [10, 15], rest: 60 },
          { ex: 'seated-calf-raise', sets: 3, reps: [12, 20], rest: 60 },
          { ex: 'cable-crunch', sets: 3, reps: [10, 15], rest: 60 },
        ],
      },
    ],
  },
  {
    id: 'five-by-five',
    name: '5×5 Strength',
    summary: 'Simple barbell strength: five sets of five, adding weight every session you hit all your reps. Alternate A and B, 3 days a week.',
    level: 'Beginner',
    daysPerWeek: '3',
    equipment: 'Gym',
    routines: [
      {
        name: '5×5 Workout A',
        exercises: [
          { ex: 'squat-barbell', sets: 5, reps: [5, 5], rest: 180 },
          { ex: 'bench-press-barbell', sets: 5, reps: [5, 5], rest: 180 },
          { ex: 'bent-over-row-barbell', sets: 5, reps: [5, 5], rest: 150 },
        ],
      },
      {
        name: '5×5 Workout B',
        exercises: [
          { ex: 'squat-barbell', sets: 5, reps: [5, 5], rest: 180 },
          { ex: 'overhead-press-barbell', sets: 5, reps: [5, 5], rest: 180 },
          { ex: 'deadlift-barbell', sets: 1, reps: [5, 5], rest: 180 },
        ],
      },
    ],
  },
  {
    id: 'dumbbell-home',
    name: 'Dumbbells at Home',
    summary: 'Full-body training with just a pair of dumbbells (a bench helps). Alternate A and B, 3 days a week.',
    level: 'Beginner',
    daysPerWeek: '3',
    equipment: 'Dumbbells',
    routines: [
      {
        name: 'Dumbbell Full Body A',
        exercises: [
          { ex: 'goblet-squat', sets: 3, reps: [10, 15], rest: 90 },
          { ex: 'bench-press-dumbbell', sets: 3, reps: [8, 12], rest: 90 },
          { ex: 'one-arm-row-dumbbell', sets: 3, reps: [8, 12], rest: 60 },
          { ex: 'shoulder-press-dumbbell', sets: 3, reps: [8, 12], rest: 60 },
          { ex: 'romanian-deadlift-dumbbell', sets: 3, reps: [10, 12], rest: 90 },
          { ex: 'bicep-curl-dumbbell', sets: 2, reps: [10, 15], rest: 60 },
        ],
      },
      {
        name: 'Dumbbell Full Body B',
        exercises: [
          { ex: 'bulgarian-split-squat', sets: 3, reps: [8, 12], rest: 90 },
          { ex: 'push-up', sets: 3, reps: [8, 20], rest: 60 },
          { ex: 'reverse-fly-dumbbell', sets: 3, reps: [12, 15], rest: 60 },
          { ex: 'lateral-raise-dumbbell', sets: 3, reps: [12, 20], rest: 60 },
          { ex: 'step-up-dumbbell', sets: 3, reps: [10, 12], rest: 60 },
          { ex: 'hammer-curl', sets: 2, reps: [10, 15], rest: 60 },
          { ex: 'overhead-triceps-extension-dumbbell', sets: 2, reps: [10, 15], rest: 60 },
        ],
      },
    ],
  },
  {
    id: 'bodyweight',
    name: 'No Equipment',
    summary: 'Bodyweight training you can do anywhere. Two routines — strength and a core/cardio finisher.',
    level: 'Beginner',
    daysPerWeek: '3–5',
    equipment: 'None',
    routines: [
      {
        name: 'Bodyweight Full Body',
        exercises: [
          { ex: 'air-squat', sets: 3, reps: [15, 25], rest: 60 },
          { ex: 'push-up', sets: 3, reps: [8, 20], rest: 60 },
          { ex: 'lunge', sets: 3, reps: [10, 20], rest: 60 },
          { ex: 'glute-bridge', sets: 3, reps: [15, 25], rest: 45 },
          { ex: 'superman', sets: 3, reps: [12, 20], rest: 45 },
          { ex: 'plank', sets: 3, sec: 45, rest: 45 },
        ],
      },
      {
        name: 'Core & Cardio',
        exercises: [
          { ex: 'burpee', sets: 3, reps: [8, 15], rest: 60 },
          { ex: 'mountain-climber', sets: 3, reps: [20, 40], rest: 45 },
          { ex: 'bicycle-crunch', sets: 3, reps: [20, 30], rest: 45 },
          { ex: 'lying-leg-raise', sets: 3, reps: [10, 15], rest: 45 },
          { ex: 'side-plank', sets: 2, sec: 30, rest: 30 },
          { ex: 'jumping-jack', sets: 3, reps: [30, 50], rest: 30 },
        ],
      },
    ],
  },
]

export function templateToRoutines(t: ProgramTemplate, startOrder: number): Routine[] {
  return t.routines.map((r, i) => ({
    id: uid(),
    name: r.name,
    order: startOrder + i,
    updatedAt: Date.now(),
    exercises: r.exercises.map<RoutineExercise>((e) => ({
      id: uid(),
      exerciseId: e.ex,
      restSec: e.rest,
      repMin: e.reps?.[0],
      repMax: e.reps?.[1],
      sets: Array.from({ length: e.sets }, () => ({ type: 'normal' as const, seconds: e.sec })),
    })),
  }))
}
