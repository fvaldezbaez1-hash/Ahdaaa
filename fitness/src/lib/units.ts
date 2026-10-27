export type WeightUnit = 'kg' | 'lb'
export type DistanceUnit = 'km' | 'mi'
export type LengthUnit = 'cm' | 'in'

export const KG_PER_LB = 0.45359237
const M_PER_MI = 1609.344
const CM_PER_IN = 2.54

/** Round to at most `dp` decimals, dropping float noise like 134.99999. */
export function round(n: number, dp = 2): number {
  const f = 10 ** dp
  return Math.round(n * f) / f
}

const nf = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })
const nf1 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })
const nf0 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })

/** Display number with grouping and up to `dp` decimals. */
export function fmtNum(n: number, dp = 2): string {
  if (!Number.isFinite(n)) return '–'
  return dp === 0 ? nf0.format(n) : dp === 1 ? nf1.format(n) : nf.format(round(n, dp))
}

/** Plain number for an input field (no grouping). */
export function inputNum(n: number | undefined, dp = 2): string {
  if (n === undefined || !Number.isFinite(n)) return ''
  return String(round(n, dp))
}

/** Parse a user-typed number; accepts "," as decimal separator. */
export function parseNum(s: string): number | undefined {
  const t = s.trim().replace(',', '.')
  if (t === '' || t === '.' || t === '-') return undefined
  const n = Number(t)
  return Number.isFinite(n) ? n : undefined
}

export const kgTo = (kg: number, u: WeightUnit) => (u === 'lb' ? kg / KG_PER_LB : kg)
export const toKg = (v: number, u: WeightUnit) => (u === 'lb' ? v * KG_PER_LB : v)

export function fmtWeight(kg: number | undefined, u: WeightUnit, withUnit = true): string {
  if (kg === undefined) return '–'
  const v = round(kgTo(kg, u), u === 'lb' ? 1 : 2)
  return withUnit ? `${fmtNum(v)} ${u}` : fmtNum(v)
}

export const mTo = (m: number, u: DistanceUnit) => (u === 'mi' ? m / M_PER_MI : m / 1000)
export const toM = (v: number, u: DistanceUnit) => (u === 'mi' ? v * M_PER_MI : v * 1000)

export function fmtDistance(m: number | undefined, u: DistanceUnit): string {
  if (m === undefined) return '–'
  return `${fmtNum(round(mTo(m, u), 2))} ${u}`
}

export const cmTo = (cm: number, u: LengthUnit) => (u === 'in' ? cm / CM_PER_IN : cm)
export const toCm = (v: number, u: LengthUnit) => (u === 'in' ? v * CM_PER_IN : v)

export function fmtLength(cm: number | undefined, u: LengthUnit): string {
  if (cm === undefined) return '–'
  return `${fmtNum(round(cmTo(cm, u), 1), 1)} ${u}`
}

export const fmtKcal = (n: number) => fmtNum(Math.round(n), 0)

/** Feet + inches helper for height entry. */
export function cmToFtIn(cm: number): { ft: number; inch: number } {
  const totalIn = cm / CM_PER_IN
  let ft = Math.floor(totalIn / 12)
  let inch = Math.round(totalIn - ft * 12)
  if (inch === 12) {
    ft += 1
    inch = 0
  }
  return { ft, inch }
}

export const ftInToCm = (ft: number, inch: number) => (ft * 12 + inch) * CM_PER_IN
