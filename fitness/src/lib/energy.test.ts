import { describe, expect, it } from 'vitest'
import { addDays } from './dates'
import { bmr, computeTargets, estimateExpenditure, goalDelta, KCAL_PER_KG } from './energy'
import type { Profile } from './types'

const profile: Profile = { sex: 'male', birthYear: 1996, heightCm: 180, activity: 1.55 }

describe('bmr', () => {
  it('matches Mifflin-St Jeor', () => {
    // 10*80 + 6.25*180 - 5*30 + 5 = 1780
    expect(bmr(profile, 80, new Date(2026, 5, 1))).toBe(1780)
    expect(bmr({ ...profile, sex: 'female' }, 80, new Date(2026, 5, 1))).toBe(1614)
  })
})

/** Someone whose true expenditure is `tdee`, eating `eat` every day. */
function simulate(tdee: number, eat: number, days: number, end: string, startKg = 90) {
  const intake: Record<string, number> = {}
  const weighIns: { date: string; kg: number }[] = []
  for (let i = 0; i < days; i++) {
    const date = addDays(end, -(days - 1) + i)
    intake[date] = eat
    weighIns.push({ date, kg: startKg - ((tdee - eat) * i) / KCAL_PER_KG })
  }
  return { intake, weighIns }
}

describe('estimateExpenditure', () => {
  const end = '2026-10-26'

  it('recovers true expenditure from clean data', () => {
    const { intake, weighIns } = simulate(2600, 2100, 28, end)
    const r = estimateExpenditure({ intake, weighIns, end, formula: 2600 })
    expect(r.observed).toBe(2600)
    expect(r.confidence).toBe(1)
    expect(r.expenditure).toBe(2600)
  })

  it('moves a wrong formula guess toward the data, limited per check-in', () => {
    const { intake, weighIns } = simulate(2300, 2300, 28, end)
    const r = estimateExpenditure({ intake, weighIns, end, formula: 2800, prior: 2800 })
    expect(r.observed).toBe(2300)
    expect(r.expenditure).toBe(2500) // 300 kcal max step
  })

  it('falls back to the formula with too little data', () => {
    const { intake, weighIns } = simulate(2300, 2000, 5, end)
    const r = estimateExpenditure({ intake, weighIns, end, formula: 2450 })
    expect(r.observed).toBeUndefined()
    expect(r.confidence).toBe(0)
    expect(r.expenditure).toBe(2450)
  })

  it('ignores barely-logged days', () => {
    const { intake, weighIns } = simulate(2500, 2000, 28, end)
    for (const d of Object.keys(intake).slice(0, 10)) intake[d] = 300
    const r = estimateExpenditure({ intake, weighIns, end, formula: 2500 })
    expect(r.loggedDays).toBe(18)
    // Only the 18 real days count; their average is still 2000.
    expect(r.observed).toBe(2500)
  })

  it('weights the estimate by how much data there is', () => {
    const { intake, weighIns } = simulate(3000, 2500, 28, end)
    const sparse = weighIns.filter((_, i) => i % 7 === 0) // 4 weigh-ins → half confidence
    const r = estimateExpenditure({ intake, weighIns: sparse, end, formula: 2600 })
    expect(r.confidence).toBeCloseTo(0.5)
    expect(r.expenditure).toBe(2800)
  })
})

describe('targets', () => {
  it('turns a goal rate into a daily deficit', () => {
    expect(goalDelta({ type: 'lose', ratePct: 0.5 }, 80)).toBeCloseTo(-440)
    expect(goalDelta({ type: 'gain', ratePct: 0.25 }, 80)).toBeCloseTo(220)
    expect(goalDelta({ type: 'maintain', ratePct: 0 }, 80)).toBe(0)
  })

  it('splits calories into macros that add up', () => {
    const t = computeTargets({
      expenditure: 2600, weightKg: 80, heightCm: 180, sex: 'male',
      goal: { type: 'lose', ratePct: 0.5 }, proteinPerKg: 1.8, fatPct: 30,
    })
    expect(t.kcal).toBe(2160)
    expect(t.protein).toBe(144)
    expect(t.fat).toBe(72)
    expect(Math.abs(t.protein * 4 + t.carbs * 4 + t.fat * 9 - t.kcal)).toBeLessThanOrEqual(4)
  })

  it('never goes below a safe calorie floor', () => {
    const t = computeTargets({
      expenditure: 1500, weightKg: 55, heightCm: 160, sex: 'female',
      goal: { type: 'lose', ratePct: 1 }, proteinPerKg: 1.8, fatPct: 30,
    })
    expect(t.kcal).toBe(1200)
  })

  it('caps protein for larger bodies at a BMI-27 reference weight', () => {
    const t = computeTargets({
      expenditure: 3200, weightKg: 140, heightCm: 175, sex: 'male',
      goal: { type: 'lose', ratePct: 0.5 }, proteinPerKg: 2, fatPct: 30,
    })
    expect(t.protein).toBe(Math.round(2 * 27 * 1.75 ** 2))
  })
})

describe('Get shredded', () => {
  it('runs a deficit like a cut', () => {
    expect(goalDelta({ type: 'shred', ratePct: 0.5 }, 80)).toBeCloseTo(-440)
  })

  it('raises protein to at least 2.2 g/kg', () => {
    const base = { expenditure: 2600, weightKg: 80, heightCm: 180, sex: 'male' as const, fatPct: 30 }
    expect(computeTargets({ ...base, goal: { type: 'shred', ratePct: 0.5 }, proteinPerKg: 1.8 }).protein).toBe(176)
    expect(computeTargets({ ...base, goal: { type: 'lose', ratePct: 0.5 }, proteinPerKg: 1.8 }).protein).toBe(144)
    // A higher personal setting is kept.
    expect(computeTargets({ ...base, goal: { type: 'shred', ratePct: 0.5 }, proteinPerKg: 2.5 }).protein).toBe(200)
  })
})
