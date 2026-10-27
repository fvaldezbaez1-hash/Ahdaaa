import { Dexie, type EntityTable } from 'dexie'
import type {
  BodyEntry, CheckIn, DayLog, Exercise, Food, FoodEntry, Photo, Routine, SavedMeal, Workout,
} from './types'

export interface KV {
  key: string
  value: unknown
}

// Everything lives in IndexedDB on the phone. Nothing is sent anywhere except
// food searches and barcode lookups, which go to Open Food Facts.
export class ForgeDB extends Dexie {
  workouts!: EntityTable<Workout, 'id'>
  routines!: EntityTable<Routine, 'id'>
  exercises!: EntityTable<Exercise, 'id'>
  foods!: EntityTable<Food, 'id'>
  entries!: EntityTable<FoodEntry, 'id'>
  meals!: EntityTable<SavedMeal, 'id'>
  body!: EntityTable<BodyEntry, 'date'>
  photos!: EntityTable<Photo, 'id'>
  days!: EntityTable<DayLog, 'date'>
  checkins!: EntityTable<CheckIn, 'date'>
  kv!: EntityTable<KV, 'key'>

  constructor(name = 'forge') {
    super(name)
    this.version(1).stores({
      workouts: 'id, start, routineId',
      routines: 'id, order',
      exercises: 'id, name',
      foods: 'id, barcode, lastUsed',
      entries: 'id, date, foodId, createdAt',
      meals: 'id, updatedAt',
      body: 'date',
      photos: 'id, date',
      days: 'date',
      checkins: 'date',
      kv: 'key',
    })
  }
}

export const db = new ForgeDB()

export const TABLES = [
  'workouts', 'routines', 'exercises', 'foods', 'entries', 'meals', 'body', 'photos', 'days', 'checkins', 'kv',
] as const
export type TableName = (typeof TABLES)[number]

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return (await db.kv.get(key))?.value as T | undefined
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await db.kv.put({ key, value })
}

export const KEYS = {
  settings: 'settings',
  active: 'activeWorkout',
} as const
