import type { Food, Meal, Nutrients } from './types'

export const MEALS: Meal[] = ['breakfast', 'lunch', 'dinner', 'snacks']

export const MEAL_LABEL: Record<Meal, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snacks: 'Snacks',
}

/** A sensible meal for "now", used as the default when adding food. */
export function mealForHour(h: number): Meal {
  if (h < 11) return 'breakfast'
  if (h < 15) return 'lunch'
  if (h < 21) return 'dinner'
  return 'snacks'
}

export const ZERO: Nutrients = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }

const r1 = (n: number) => Math.round(n * 10) / 10

export function scaleNutrients(n: Nutrients, factor: number): Nutrients {
  const out: Nutrients = {
    kcal: Math.round(n.kcal * factor),
    protein: r1(n.protein * factor),
    carbs: r1(n.carbs * factor),
    fat: r1(n.fat * factor),
  }
  if (n.fiber !== undefined) out.fiber = r1(n.fiber * factor)
  if (n.sugar !== undefined) out.sugar = r1(n.sugar * factor)
  if (n.satFat !== undefined) out.satFat = r1(n.satFat * factor)
  if (n.sodium !== undefined) out.sodium = Math.round(n.sodium * factor)
  return out
}

export const nutrientsFor = (food: Pick<Food, 'per100'>, grams: number) => scaleNutrients(food.per100, grams / 100)

export function sumNutrients(list: Nutrients[]): Nutrients {
  const t = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }
  for (const n of list) {
    t.kcal += n.kcal
    t.protein += n.protein
    t.carbs += n.carbs
    t.fat += n.fat
    t.fiber += n.fiber ?? 0
  }
  return { kcal: Math.round(t.kcal), protein: r1(t.protein), carbs: r1(t.carbs), fat: r1(t.fat), fiber: r1(t.fiber) }
}

/** Calories implied by macros; used to sanity-check quick adds and custom foods. */
export const kcalFromMacros = (p: number, c: number, f: number) => Math.round(p * 4 + c * 4 + f * 9)
