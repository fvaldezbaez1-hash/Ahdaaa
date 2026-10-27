import { addDays, daysBetween, today } from './dates'
import { db } from './db'
import { computeTargets, estimateExpenditure, formulaTdee } from './energy'
import { trendOn, weightTrend } from './trend'
import type { CheckIn, MacroTargets, Settings } from './types'

// The weekly check-in: every 7 days the app re-estimates your expenditure from
// what you logged and how your weight trended, then sets new targets for the
// week. Targets stay fixed between check-ins so they're predictable.

export const CHECKIN_EVERY_DAYS = 7
const FALLBACK_KG = 75

async function weighIns() {
  const rows = await db.body.toArray()
  return rows.filter((r) => r.weightKg).map((r) => ({ date: r.date, kg: r.weightKg! }))
}

export async function intakeByDay(from: string, to: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  const rows = await db.entries.where('date').between(from, to, true, true).toArray()
  for (const e of rows) out[e.date] = (out[e.date] ?? 0) + e.n.kcal
  return out
}

async function buildCheckIn(s: Settings, date: string, prior?: CheckIn): Promise<CheckIn> {
  const w = await weighIns()
  const series = weightTrend(w)
  const trendKg = trendOn(series, date) ?? w[w.length - 1]?.kg
  const weightKg = trendKg ?? FALLBACK_KG
  const formula = Math.round(formulaTdee(s.profile, weightKg))
  const end = addDays(date, -1)
  const est = estimateExpenditure({
    intake: await intakeByDay(addDays(end, -27), end),
    weighIns: w,
    end,
    formula,
    prior: prior?.expenditure,
  })
  return {
    date,
    expenditure: est.expenditure,
    formula,
    observed: est.observed,
    confidence: est.confidence,
    trendKg,
    targets: targetsFor(s, est.expenditure, weightKg),
    seen: prior === undefined,
  }
}

export function targetsFor(s: Settings, expenditure: number, weightKg: number): MacroTargets {
  return computeTargets({
    expenditure,
    weightKg,
    heightCm: s.profile.heightCm,
    sex: s.profile.sex,
    goal: s.goal,
    proteinPerKg: s.proteinPerKg,
    fatPct: s.fatPct,
  })
}

export async function latestCheckIn(): Promise<CheckIn | undefined> {
  return db.checkins.orderBy('date').last()
}

/** Creates the first check-in, or a new one once a week has passed. */
export async function ensureCheckIn(s: Settings): Promise<CheckIn> {
  const last = await latestCheckIn()
  const t = today()
  if (last && daysBetween(last.date, t) < CHECKIN_EVERY_DAYS) return last
  const next = await buildCheckIn(s, t, last)
  await db.checkins.put(next)
  return next
}

/**
 * Goal or profile changed: keep the current expenditure estimate but redo the
 * targets for it straight away (and refresh the formula estimate if there's
 * no data-driven estimate yet).
 */
export async function refreshTargets(s: Settings): Promise<void> {
  const last = await latestCheckIn()
  if (!last) {
    await ensureCheckIn(s)
    return
  }
  const w = await weighIns()
  const weightKg = trendOn(weightTrend(w), today()) ?? w[w.length - 1]?.kg ?? FALLBACK_KG
  const formula = Math.round(formulaTdee(s.profile, weightKg))
  const expenditure = last.confidence > 0 ? last.expenditure : formula
  await db.checkins.put({ ...last, formula, expenditure, targets: targetsFor(s, expenditure, weightKg) })
}

export function currentTargets(s: Settings, checkIn: CheckIn | undefined): MacroTargets {
  if (s.nutritionMode === 'manual' || !checkIn) return s.manual
  return checkIn.targets
}
