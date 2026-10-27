import { fmtClock } from '../lib/dates'
import type { ExerciseKind, Settings, WSet } from '../lib/types'
import { fmtNum, kgTo, mTo, round } from '../lib/units'

/** "80 kg × 8", "+10 kg × 8", "12 reps", "1:30", "5 km · 25:00" */
export function fmtSet(s: Pick<WSet, 'kg' | 'reps' | 'seconds' | 'meters'>, kind: ExerciseKind, st: Settings): string {
  const w = (kg: number) => fmtNum(round(kgTo(kg, st.weightUnit), 1))
  switch (kind) {
    case 'weight_reps':
      return `${s.kg !== undefined ? `${w(s.kg)} ${st.weightUnit}` : '–'} × ${s.reps ?? '–'}`
    case 'weighted_bw':
      return s.kg ? `+${w(s.kg)} ${st.weightUnit} × ${s.reps ?? '–'}` : `${s.reps ?? '–'} reps`
    case 'assisted_bw':
      return s.kg ? `−${w(s.kg)} ${st.weightUnit} × ${s.reps ?? '–'}` : `${s.reps ?? '–'} reps`
    case 'reps':
      return `${s.reps ?? '–'} reps`
    case 'duration':
      return s.seconds !== undefined ? fmtClock(s.seconds) : '–'
    case 'distance_duration': {
      const d = s.meters !== undefined ? `${fmtNum(round(mTo(s.meters, st.distanceUnit), 2))} ${st.distanceUnit}` : ''
      const t = s.seconds !== undefined ? fmtClock(s.seconds) : ''
      return [d, t].filter(Boolean).join(' · ') || '–'
    }
  }
}

/** Compact version for the "previous" column: "80×8". */
export function fmtPrev(s: Pick<WSet, 'kg' | 'reps' | 'seconds' | 'meters'>, kind: ExerciseKind, st: Settings): string {
  const w = (kg: number) => fmtNum(round(kgTo(kg, st.weightUnit), 1))
  switch (kind) {
    case 'weight_reps':
      return `${s.kg !== undefined ? w(s.kg) : '–'}×${s.reps ?? '–'}`
    case 'weighted_bw':
      return s.kg ? `+${w(s.kg)}×${s.reps ?? '–'}` : `${s.reps ?? '–'}`
    case 'assisted_bw':
      return s.kg ? `−${w(s.kg)}×${s.reps ?? '–'}` : `${s.reps ?? '–'}`
    default:
      return fmtSet(s, kind, st)
  }
}

export const SET_TYPE_LABEL = { normal: 'Normal set', warmup: 'Warm-up', drop: 'Drop set', failure: 'Failure' } as const
export const SET_TYPE_SHORT = { warmup: 'W', drop: 'D', failure: 'F' } as const
