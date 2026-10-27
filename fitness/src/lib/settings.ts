import { db, KEYS, kvGet, kvSet } from './db'
import type { Settings } from './types'

const usesImperial = () => {
  if (typeof navigator === 'undefined') return false
  const lang = navigator.language || ''
  return /-(US|LR|MM)$/i.test(lang) || lang === 'en'
}

export function defaultSettings(): Settings {
  const imperial = usesImperial()
  return {
    onboarded: false,
    weightUnit: imperial ? 'lb' : 'kg',
    distanceUnit: imperial ? 'mi' : 'km',
    lengthUnit: imperial ? 'in' : 'cm',
    theme: 'system',
    restSec: 90,
    profile: { sex: 'male', birthYear: new Date().getFullYear() - 30, heightCm: 175, activity: 1.375 },
    goal: { type: 'maintain', ratePct: 0 },
    nutritionMode: 'coached',
    manual: { kcal: 2200, protein: 150, carbs: 220, fat: 75 },
    proteinPerKg: 1.8,
    fatPct: 30,
    waterGoalMl: 2500,
    barKg: imperial ? 20.411656 : 20, // 45 lb or 20 kg
    showRpe: false,
    weeklyWorkoutGoal: 3,
    keepAwake: true,
  }
}

export async function loadSettings(): Promise<Settings> {
  const stored = await kvGet<Partial<Settings>>(KEYS.settings)
  const d = defaultSettings()
  return { ...d, ...stored, profile: { ...d.profile, ...stored?.profile }, goal: { ...d.goal, ...stored?.goal } }
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  return db.transaction('rw', db.kv, async () => {
    const next = { ...(await loadSettings()), ...patch }
    await kvSet(KEYS.settings, next)
    return next
  })
}
