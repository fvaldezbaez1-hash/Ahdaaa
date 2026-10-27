import { kcalFromMacros } from '../lib/nutrition'
import type { MacroTargets } from '../lib/types'
import { fmtKcal } from '../lib/units'

export function kcalFromMacrosLabel(t: MacroTargets): string {
  const k = kcalFromMacros(t.protein, t.carbs, t.fat)
  const diff = k - t.kcal
  if (Math.abs(diff) <= 25) return `Your macros add up to ${fmtKcal(k)} kcal. 👍`
  return `Your macros add up to ${fmtKcal(k)} kcal, ${fmtKcal(Math.abs(diff))} ${diff > 0 ? 'more' : 'less'} than your calorie target.`
}
