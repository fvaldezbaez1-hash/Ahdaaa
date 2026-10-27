export const PLATES_KG = [25, 20, 15, 10, 5, 2.5, 1.25]
export const PLATES_LB = [45, 35, 25, 10, 5, 2.5]

export interface PlateResult {
  perSide: number[]
  /** Total the listed plates actually make, bar included. */
  achieved: number
  /** Weight that couldn't be matched with the available plates. */
  remainder: number
}

/** Greedy plate loading for a barbell. All values are in the same unit. */
export function platesPerSide(total: number, bar: number, plates: number[]): PlateResult {
  const sorted = [...plates].sort((a, b) => b - a)
  let side = (total - bar) / 2
  const perSide: number[] = []
  if (side > 0) {
    for (const p of sorted) {
      while (side + 1e-9 >= p) {
        perSide.push(p)
        side -= p
      }
    }
  }
  const loaded = perSide.reduce((a, b) => a + b, 0)
  const achieved = Math.max(bar, bar + loaded * 2)
  return { perSide, achieved, remainder: Math.round((total - achieved) * 100) / 100 }
}
