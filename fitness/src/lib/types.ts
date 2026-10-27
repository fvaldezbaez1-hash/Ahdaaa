// Shared data model. Weights are stored in kg, lengths in cm, distances in
// metres and durations in seconds; screens convert to the user's units.

export type Muscle =
  | 'chest' | 'shoulders' | 'triceps' | 'biceps' | 'forearms'
  | 'lats' | 'upper_back' | 'traps' | 'lower_back'
  | 'abs' | 'obliques'
  | 'quads' | 'hamstrings' | 'glutes' | 'adductors' | 'abductors' | 'calves'
  | 'neck' | 'cardio' | 'full_body'

export type Equipment =
  | 'barbell' | 'dumbbell' | 'machine' | 'cable' | 'bodyweight' | 'kettlebell'
  | 'band' | 'smith' | 'ez_bar' | 'plate' | 'other'

/** What a set of this exercise records (same idea as Hevy's exercise types). */
export type ExerciseKind =
  | 'weight_reps'       // kg × reps
  | 'reps'              // bodyweight reps
  | 'weighted_bw'       // bodyweight + added kg × reps
  | 'assisted_bw'       // bodyweight − assistance kg × reps
  | 'duration'          // seconds
  | 'distance_duration' // metres + seconds

export interface Exercise {
  id: string
  name: string
  primary: Muscle
  secondary: Muscle[]
  equipment: Equipment
  kind: ExerciseKind
  cues?: string
  custom?: boolean
}

export type SetType = 'normal' | 'warmup' | 'drop' | 'failure'

export interface WSet {
  id: string
  type: SetType
  kg?: number
  reps?: number
  rpe?: number
  seconds?: number
  meters?: number
  done: boolean
}

export interface WExercise {
  id: string
  exerciseId: string
  sets: WSet[]
  notes?: string
  supersetId?: string
  restSec?: number
  repMin?: number
  repMax?: number
}

export interface Workout {
  id: string
  name: string
  start: number
  end: number
  exercises: WExercise[]
  notes?: string
  routineId?: string
}

export interface ActiveWorkout extends Workout {
  /** Set when an already-saved workout is being edited. */
  editingId?: string
  restEndsAt?: number
  restTotal?: number
}

export interface RoutineSet {
  type: SetType
  kg?: number
  reps?: number
  seconds?: number
  meters?: number
}

export interface RoutineExercise {
  id: string
  exerciseId: string
  sets: RoutineSet[]
  restSec?: number
  repMin?: number
  repMax?: number
  notes?: string
  supersetId?: string
}

export interface Routine {
  id: string
  name: string
  exercises: RoutineExercise[]
  notes?: string
  order: number
  updatedAt: number
}

// ---- Food ----

export interface Nutrients {
  kcal: number
  protein: number
  carbs: number
  fat: number
  fiber?: number
  sugar?: number
  satFat?: number
  /** milligrams */
  sodium?: number
}

export interface Serving {
  label: string
  grams: number
}

export type FoodSource = 'builtin' | 'off' | 'custom'

export interface Food {
  id: string
  name: string
  brand?: string
  barcode?: string
  /** Nutrients per 100 g (or 100 ml when unit is ml). */
  per100: Nutrients
  servings: Serving[]
  unit: 'g' | 'ml'
  source: FoodSource
  favorite?: boolean
  lastUsed?: number
  uses?: number
}

export type Meal = 'breakfast' | 'lunch' | 'dinner' | 'snacks'

export interface FoodEntry {
  id: string
  /** Local day, YYYY-MM-DD */
  date: string
  meal: Meal
  foodId?: string
  name: string
  brand?: string
  /** Total grams eaten (absent for quick-add calories). */
  grams?: number
  /** Number of `servingLabel` servings, when logged by serving. */
  qty?: number
  servingLabel?: string
  unit?: 'g' | 'ml'
  /** Nutrients for the whole entry, snapshotted at log time. */
  n: Nutrients
  createdAt: number
}

export type MealItem = Omit<FoodEntry, 'id' | 'date' | 'meal' | 'createdAt'>

export interface SavedMeal {
  id: string
  name: string
  items: MealItem[]
  updatedAt: number
}

// ---- Body ----

export interface BodyEntry {
  date: string
  weightKg?: number
  bodyFat?: number
  waist?: number
  chest?: number
  hips?: number
  arms?: number
  thighs?: number
  neck?: number
}

export type Pose = 'front' | 'side' | 'back'

export interface Photo {
  id: string
  date: string
  pose: Pose
  blob: Blob
  createdAt: number
}

export interface DayLog {
  date: string
  waterMl: number
}

// ---- Coaching ----

export interface MacroTargets {
  kcal: number
  protein: number
  carbs: number
  fat: number
}

export interface CheckIn {
  date: string
  /** Estimated total daily energy expenditure used for these targets. */
  expenditure: number
  /** Formula (Mifflin-St Jeor × activity) estimate at the time. */
  formula: number
  /** Raw data-driven estimate, when there was enough data. */
  observed?: number
  /** 0–1: how much the estimate leans on your own data vs the formula. */
  confidence: number
  trendKg?: number
  targets: MacroTargets
  seen?: boolean
}

export type GoalType = 'lose' | 'maintain' | 'gain'

export interface Profile {
  sex: 'male' | 'female'
  birthYear: number
  heightCm: number
  /** Activity multiplier for the starting estimate, 1.2–1.9. */
  activity: number
}

export interface Goal {
  type: GoalType
  /** Percent of body weight per week (always positive). */
  ratePct: number
}

export interface Settings {
  onboarded: boolean
  weightUnit: 'kg' | 'lb'
  distanceUnit: 'km' | 'mi'
  lengthUnit: 'cm' | 'in'
  theme: 'system' | 'dark' | 'light'
  restSec: number
  profile: Profile
  goal: Goal
  nutritionMode: 'coached' | 'manual'
  manual: MacroTargets
  proteinPerKg: number
  fatPct: number
  waterGoalMl: number
  barKg: number
  showRpe: boolean
  weeklyWorkoutGoal: number
  keepAwake: boolean
  lastBackupAt?: number
}
