import { BUILTIN_FOODS } from '../data/foods'
import { db } from '../lib/db'
import { uid } from '../lib/id'
import { nutrientsFor, sumNutrients } from '../lib/nutrition'
import type { Food, FoodEntry, Meal, MealItem, SavedMeal } from '../lib/types'

export type NewEntry = Omit<FoodEntry, 'id' | 'createdAt'>

/** Keeps a copy of any food you log so it shows in recents and works offline. */
export async function rememberFood(f: Food): Promise<void> {
  await db.transaction('rw', db.foods, async () => {
    const existing = await db.foods.get(f.id)
    await db.foods.put({ ...f, favorite: existing?.favorite ?? f.favorite, uses: (existing?.uses ?? 0) + 1, lastUsed: Date.now() })
  })
}

export function entryFromFood(food: Food, grams: number, date: string, meal: Meal, serving?: { label: string; qty: number }): NewEntry {
  return {
    date,
    meal,
    foodId: food.id,
    name: food.name,
    brand: food.brand,
    grams,
    qty: serving?.qty,
    servingLabel: serving?.label,
    unit: food.unit,
    n: nutrientsFor(food, grams),
  }
}

export async function addEntry(e: NewEntry, food?: Food): Promise<void> {
  await db.entries.put({ ...e, id: uid(), createdAt: Date.now() })
  if (food) await rememberFood(food)
}

export async function toggleFavorite(f: Food): Promise<boolean> {
  const existing = await db.foods.get(f.id)
  const fav = !existing?.favorite
  await db.foods.put({ ...(existing ?? f), favorite: fav })
  return fav
}

const tokens = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean)

/** Foods on this phone (built-in + ones you've used or made) matching the query. */
export function searchLocal(q: string, saved: Food[]): Food[] {
  const t = tokens(q)
  if (!t.length) return []
  const byId = new Map<string, Food>()
  for (const f of BUILTIN_FOODS) byId.set(f.id, f)
  for (const f of saved) byId.set(f.id, f)
  const hits = [...byId.values()].filter((f) => {
    const hay = `${f.name} ${f.brand ?? ''}`.toLowerCase()
    return t.every((x) => hay.includes(x))
  })
  // Favourites and frequently used first, then shorter (more generic) names.
  return hits
    .sort((a, b) => Number(!!b.favorite) - Number(!!a.favorite) || (b.uses ?? 0) - (a.uses ?? 0) || a.name.length - b.name.length)
    .slice(0, 40)
}

export async function findByBarcode(code: string): Promise<Food | undefined> {
  return db.foods.where('barcode').equals(code).first()
}

export async function getFood(id: string): Promise<Food | undefined> {
  return (await db.foods.get(id)) ?? BUILTIN_FOODS.find((f) => f.id === id)
}

/** A food for editing an entry, even if the original food is gone. */
export function foodFromEntry(e: FoodEntry): Food {
  const grams = e.grams && e.grams > 0 ? e.grams : 100
  const f = 100 / grams
  return {
    id: e.foodId ?? `entry:${e.id}`,
    name: e.name,
    brand: e.brand,
    per100: {
      kcal: e.n.kcal * f, protein: e.n.protein * f, carbs: e.n.carbs * f, fat: e.n.fat * f,
      fiber: e.n.fiber !== undefined ? e.n.fiber * f : undefined,
    },
    servings: e.servingLabel && e.qty ? [{ label: e.servingLabel, grams: grams / e.qty }] : [],
    unit: e.unit ?? 'g',
    source: 'custom',
  }
}

export async function copyMeal(fromDate: string, toDate: string, meal: Meal): Promise<number> {
  const src = (await db.entries.where('date').equals(fromDate).sortBy('createdAt')).filter((e) => e.meal === meal)
  const now = Date.now()
  await db.entries.bulkPut(src.map((e, i) => ({ ...e, id: uid(), date: toDate, createdAt: now + i })))
  return src.length
}

export async function copyDay(fromDate: string, toDate: string): Promise<number> {
  const src = await db.entries.where('date').equals(fromDate).sortBy('createdAt')
  const now = Date.now()
  await db.entries.bulkPut(src.map((e, i) => ({ ...e, id: uid(), date: toDate, createdAt: now + i })))
  return src.length
}

export async function saveMeal(name: string, entries: FoodEntry[]): Promise<void> {
  const items: MealItem[] = entries.map(({ id: _id, date: _d, meal: _m, createdAt: _c, ...rest }) => rest)
  await db.meals.put({ id: uid(), name, items, updatedAt: Date.now() })
}

export async function logSavedMeal(m: SavedMeal, date: string, meal: Meal): Promise<void> {
  const now = Date.now()
  await db.entries.bulkPut(m.items.map((it, i) => ({ ...it, id: uid(), date, meal, createdAt: now + i })))
  await db.meals.put({ ...m, updatedAt: now })
}

export const mealTotals = (m: SavedMeal) => sumNutrients(m.items.map((i) => i.n))

export async function addWater(date: string, ml: number): Promise<void> {
  await db.transaction('rw', db.days, async () => {
    const d = await db.days.get(date)
    await db.days.put({ date, waterMl: Math.max(0, (d?.waterMl ?? 0) + ml) })
  })
}
