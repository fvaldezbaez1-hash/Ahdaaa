import { describe, expect, it } from 'vitest'
import { BUILTIN_EXERCISES } from '../data/exercises'
import { parseCsv } from './csv'
import { mapOffProduct } from './openfoodfacts'
import type { Exercise } from './types'
import { exportWorkoutCsv, importWorkoutCsv, parseStrongDuration } from './workoutCsv'

const opts = { exercises: BUILTIN_EXERCISES, weightUnit: 'lb' as const, distanceUnit: 'mi' as const }

describe('parseCsv', () => {
  it('handles quotes, embedded commas, newlines and semicolons', () => {
    expect(parseCsv('a,b\n"x, y","say ""hi""\nthere"\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"\nthere']])
    expect(parseCsv('a;b\r\n1;2')).toEqual([['a', 'b'], ['1', '2']])
  })
})

const HEVY = `"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_kg","reps","distance_km","duration_seconds","rpe"
"Push Day","16 Oct 2026, 18:30","16 Oct 2026, 19:35","Felt good","Bench Press (Barbell)","","",0,"warmup",60,10,,,
"Push Day","16 Oct 2026, 18:30","16 Oct 2026, 19:35","Felt good","Bench Press (Barbell)","","",1,"normal",100,5,,,8
"Push Day","16 Oct 2026, 18:30","16 Oct 2026, 19:35","Felt good","Pull Up (Weighted)","0","",0,"normal",10,8,,,
"Push Day","16 Oct 2026, 18:30","16 Oct 2026, 19:35","Felt good","Dumbbell Row","0","",0,"dropset",30,12,,,
"Push Day","16 Oct 2026, 18:30","16 Oct 2026, 19:35","Felt good","Zercher Squat","","",0,"normal",80,6,,,
"Push Day","16 Oct 2026, 18:30","16 Oct 2026, 19:35","Felt good","Running","","",0,"normal",,,5.2,1800,
"Legs","18 Oct 2026, 07:05","18 Oct 2026, 08:00","","Squat (Barbell)","","",0,"normal",140,5,,,
`

describe('Hevy import', () => {
  const r = importWorkoutCsv(HEVY, opts)

  it('groups rows into workouts with local times', () => {
    expect(r.format).toBe('hevy')
    expect(r.workouts.map((w) => w.name)).toEqual(['Push Day', 'Legs'])
    const w = r.workouts[0]
    expect(new Date(w.start)).toEqual(new Date(2026, 9, 16, 18, 30))
    expect((w.end - w.start) / 60_000).toBe(65)
    expect(w.notes).toBe('Felt good')
  })

  it('maps exercises, set types, supersets and units', () => {
    const w = r.workouts[0]
    expect(w.exercises.map((e) => e.exerciseId).slice(0, 3)).toEqual(['bench-press-barbell', 'pull-up', 'one-arm-row-dumbbell'])
    expect(w.exercises[0].sets.map((s) => [s.type, s.kg, s.reps, s.rpe])).toEqual([
      ['warmup', 60, 10, undefined], ['normal', 100, 5, 8],
    ])
    expect(w.exercises[1].supersetId).toBeDefined()
    expect(w.exercises[1].supersetId).toBe(w.exercises[2].supersetId)
    expect(w.exercises[2].sets[0].type).toBe('drop')
    const run = w.exercises[4].sets[0]
    expect(run.meters).toBe(5200)
    expect(run.seconds).toBe(1800)
    expect(run.kg).toBeUndefined()
  })

  it('creates custom exercises for unknown names', () => {
    expect(r.newExercises).toHaveLength(1)
    expect(r.newExercises[0]).toMatchObject({ name: 'Zercher Squat', primary: 'quads', kind: 'weight_reps', custom: true })
    expect(r.workouts[0].exercises[3].exerciseId).toBe(r.newExercises[0].id)
  })

  it('round-trips through the Hevy export', () => {
    const all = new Map<string, Exercise>([...BUILTIN_EXERCISES, ...r.newExercises].map((e) => [e.id, e]))
    const again = importWorkoutCsv(exportWorkoutCsv(r.workouts, all), { ...opts, exercises: [...all.values()] })
    expect(again.newExercises).toHaveLength(0)
    expect(again.workouts.map((w) => [w.name, w.start, w.end])).toEqual(r.workouts.map((w) => [w.name, w.start, w.end]))
    const flat = (ws: typeof r.workouts) =>
      ws.flatMap((w) => w.exercises.flatMap((e) => e.sets.map((s) => [e.exerciseId, s.type, s.kg, s.reps, s.meters, s.seconds])))
    expect(flat(again.workouts)).toEqual(flat(r.workouts))
  })
})

const STRONG = `Date;Workout Name;Duration;Exercise Name;Set Order;Weight;Reps;Distance;Seconds;Notes;Workout Notes;RPE
2026-10-20 06:15:00;Morning;1h 5m;Deadlift (Barbell);W;135;5;0;0;;;
2026-10-20 06:15:00;Morning;1h 5m;Deadlift (Barbell);1;315;5;0;0;;;9
2026-10-20 06:15:00;Morning;1h 5m;Deadlift (Barbell);Rest Timer;0;0;0;180;;;
2026-10-20 06:15:00;Morning;1h 5m;Plank;1;0;0;0;60;;;
`

describe('Strong import', () => {
  it('reads semicolon exports in the given units and skips rest-timer rows', () => {
    const r = importWorkoutCsv(STRONG, opts)
    expect(r.format).toBe('strong')
    const w = r.workouts[0]
    expect((w.end - w.start) / 60_000).toBe(65)
    const dl = w.exercises[0]
    expect(dl.exerciseId).toBe('deadlift-barbell')
    expect(dl.sets).toHaveLength(2)
    expect(dl.sets[0].type).toBe('warmup')
    expect(dl.sets[1].kg).toBeCloseTo(142.88, 2)
    expect(dl.sets[1].rpe).toBe(9)
    expect(w.exercises[1].sets[0].seconds).toBe(60)
    expect(w.exercises[1].sets[0].kg).toBeUndefined()
  })

  it('parses durations', () => {
    expect(parseStrongDuration('1h 5m')).toBe(3900)
    expect(parseStrongDuration('45m')).toBe(2700)
    expect(parseStrongDuration('50s')).toBe(50)
  })

  it('rejects other files', () => {
    expect(() => importWorkoutCsv('name,calories\nApple,95\n', opts)).toThrow(/Hevy or Strong/)
  })
})

describe('Open Food Facts mapping', () => {
  it('maps a product with servings and sodium', () => {
    const f = mapOffProduct({
      code: '3017624010701',
      product_name: 'Nutella',
      brands: 'Ferrero, Nutella',
      nutriments: {
        'energy-kcal_100g': 539, proteins_100g: 6.3, carbohydrates_100g: 57.5, fat_100g: 30.9,
        'saturated-fat_100g': 10.6, sugars_100g: 56.3, fiber_100g: '0', sodium_100g: 0.0428,
      },
      serving_size: '15 g',
      serving_quantity: '15',
    })
    expect(f).toMatchObject({
      id: 'off:3017624010701', name: 'Nutella', brand: 'Ferrero', barcode: '3017624010701', unit: 'g', source: 'off',
      per100: { kcal: 539, protein: 6.3, carbs: 57.5, fat: 30.9, satFat: 10.6, sugar: 56.3, fiber: 0, sodium: 43 },
      servings: [{ label: '15 g', grams: 15 }],
    })
  })

  it('converts kJ when kcal is missing and skips unusable products', () => {
    expect(mapOffProduct({ product_name: 'Juice', nutriments: { energy_100g: 184 }, serving_quantity_unit: 'ml' }))
      .toMatchObject({ per100: { kcal: 44 }, unit: 'ml', servings: [] })
    expect(mapOffProduct({ product_name: 'Mystery', nutriments: {} })).toBeNull()
    expect(mapOffProduct({ nutriments: { 'energy-kcal_100g': 100 } })).toBeNull()
  })
})
