import { addDays, daysBetween } from './dates'
import { slope } from './trend'
import type { Goal, MacroTargets, Profile } from './types'

/** Energy in one kg of body-weight change (mixed fat and lean tissue). */
export const KCAL_PER_KG = 7700

/** Days with less than this logged are treated as incomplete and ignored. */
export const MIN_LOGGED_KCAL = 500

export const ACTIVITY_LEVELS = [
  { value: 1.2, label: 'Mostly sitting', detail: 'Desk job, little exercise' },
  { value: 1.375, label: 'Lightly active', detail: 'On your feet some, or 1–3 workouts a week' },
  { value: 1.55, label: 'Active', detail: '3–5 workouts a week or an active job' },
  { value: 1.725, label: 'Very active', detail: 'Hard training most days or a physical job' },
]

export const GOAL_RATES: Record<Goal['type'], { pct: number; label: string }[]> = {
  lose: [
    { pct: 0.25, label: 'Gentle' },
    { pct: 0.5, label: 'Moderate' },
    { pct: 0.75, label: 'Fast' },
    { pct: 1, label: 'Aggressive' },
  ],
  maintain: [{ pct: 0, label: 'Maintain' }],
  gain: [
    { pct: 0.1, label: 'Lean' },
    { pct: 0.25, label: 'Moderate' },
    { pct: 0.5, label: 'Fast' },
  ],
}

export const ageOn = (birthYear: number, now = new Date()) => now.getFullYear() - birthYear

/** Mifflin-St Jeor resting energy. */
export function bmr(p: Profile, weightKg: number, now = new Date()): number {
  const base = 10 * weightKg + 6.25 * p.heightCm - 5 * ageOn(p.birthYear, now)
  return p.sex === 'male' ? base + 5 : base - 161
}

export const formulaTdee = (p: Profile, weightKg: number, now = new Date()) => bmr(p, weightKg, now) * p.activity

const round10 = (n: number) => Math.round(n / 10) * 10

export interface ExpenditureResult {
  expenditure: number
  observed?: number
  /** 0–1: share of the estimate that comes from your own data. */
  confidence: number
  loggedDays: number
  weighIns: number
}

/**
 * Data-driven expenditure, MacroFactor style: what you ate on average minus the
 * energy that went into (or came out of) your body, judged from how your weight
 * moved over the same window. Blended with the previous estimate in proportion
 * to how much data there is, and limited in how far it can move per check-in so
 * one odd week can't swing your targets.
 */
export function estimateExpenditure(args: {
  intake: Record<string, number>
  weighIns: { date: string; kg: number }[]
  /** Last complete day included in the window (usually yesterday). */
  end: string
  formula: number
  prior?: number
  windowDays?: number
  maxStep?: number
}): ExpenditureResult {
  const windowDays = args.windowDays ?? 28
  const start = addDays(args.end, -(windowDays - 1))
  const prior = args.prior ?? args.formula

  const logged = Object.entries(args.intake).filter(([d, k]) => d >= start && d <= args.end && k >= MIN_LOGGED_KCAL)
  const weighs = args.weighIns.filter((w) => w.date >= start && w.date <= args.end && w.kg > 0)
  const loggedDays = logged.length
  const span = weighs.length > 1 ? daysBetween(weighs[0].date, weighs[weighs.length - 1].date) : 0

  let observed: number | undefined
  let confidence = 0
  if (loggedDays >= 7 && weighs.length >= 3 && span >= 10) {
    const avgIntake = logged.reduce((a, [, k]) => a + k, 0) / loggedDays
    const kgPerDay = slope(weighs.map((w) => ({ x: daysBetween(start, w.date), y: w.kg })))
    observed = avgIntake - kgPerDay * KCAL_PER_KG
    confidence = Math.max(0, Math.min(1, loggedDays / 21, weighs.length / 8))
  }

  let est = observed === undefined ? prior : prior + confidence * (observed - prior)
  if (args.prior !== undefined) {
    const step = args.maxStep ?? 300
    est = Math.max(args.prior - step, Math.min(args.prior + step, est))
  }
  est = Math.max(1000, Math.min(6000, est))
  return {
    expenditure: round10(est),
    observed: observed === undefined ? undefined : Math.round(observed),
    confidence,
    loggedDays,
    weighIns: weighs.length,
  }
}

/** Daily calorie surplus (+) or deficit (−) for a goal. */
export function goalDelta(goal: Goal, weightKg: number): number {
  if (goal.type === 'maintain') return 0
  const kgPerWeek = (weightKg * goal.ratePct) / 100
  const perDay = (kgPerWeek * KCAL_PER_KG) / 7
  return goal.type === 'lose' ? -perDay : perDay
}

export function computeTargets(args: {
  expenditure: number
  weightKg: number
  heightCm?: number
  sex: Profile['sex']
  goal: Goal
  proteinPerKg: number
  fatPct: number
}): MacroTargets {
  const floor = args.sex === 'female' ? 1200 : 1500
  const kcal = Math.max(floor, round10(args.expenditure + goalDelta(args.goal, args.weightKg)))
  // Protein scales with body weight, capped at a BMI-27 reference weight so
  // larger bodies don't get unrealistic protein targets.
  const ref = args.heightCm ? Math.min(args.weightKg, 27 * (args.heightCm / 100) ** 2) : args.weightKg
  const protein = Math.round(Math.min(args.proteinPerKg * ref, 300))
  let fat = Math.round(Math.max((kcal * args.fatPct) / 100 / 9, 0.5 * ref))
  if (protein * 4 + fat * 9 > kcal) fat = Math.max(0, Math.floor((kcal - protein * 4) / 9))
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4))
  return { kcal, protein, carbs, fat }
}
