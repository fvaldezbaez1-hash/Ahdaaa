import type { MacroTargets, Nutrients } from '../lib/types'
import { fmtKcal } from '../lib/units'
import { Ring } from '../ui/charts'

export const MACROS = [
  { key: 'protein', label: 'Protein', color: 'var(--s1)' },
  { key: 'carbs', label: 'Carbs', color: 'var(--s2)' },
  { key: 'fat', label: 'Fat', color: 'var(--s3)' },
] as const

export function MacroBars({ totals, targets }: { totals: Nutrients; targets: MacroTargets }) {
  return (
    <div className="grid-3">
      {MACROS.map((m) => {
        const v = totals[m.key]
        const t = targets[m.key]
        const pct = t > 0 ? Math.min(100, (v / t) * 100) : 0
        return (
          <div key={m.key} className="macro">
            <div className="head">
              <i className="swatch" style={{ background: m.color }} />
              {m.label}
            </div>
            <div className="meter" role="meter" aria-valuenow={Math.round(v)} aria-valuemax={t} aria-label={`${m.label} ${Math.round(v)} of ${t} grams`}>
              <i style={{ width: `${pct}%`, background: m.color }} />
            </div>
            <div className="nums tnum">
              <b style={{ color: 'var(--text)' }}>{Math.round(v)}</b> / {t} g
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** Calories left today as the headline number, with eaten vs target and macros. */
export function CalorieSummary({ totals, targets }: { totals: Nutrients; targets: MacroTargets }) {
  const left = targets.kcal - totals.kcal
  return (
    <div className="stack">
      <div className="row" style={{ gap: 16 }}>
        <Ring value={totals.kcal} max={targets.kcal}>
          <span className="tiny muted bold">{left >= 0 ? 'LEFT' : 'OVER'}</span>
          <span style={{ fontSize: 28, fontWeight: 750, lineHeight: 1.1 }}>{fmtKcal(Math.abs(left))}</span>
          <span className="tiny muted">kcal</span>
        </Ring>
        <div className="stack tight grow">
          <div className="row between">
            <span className="text-2 small">Target</span>
            <span className="bold tnum">{fmtKcal(targets.kcal)}</span>
          </div>
          <div className="row between">
            <span className="text-2 small">Eaten</span>
            <span className="bold tnum">{fmtKcal(totals.kcal)}</span>
          </div>
          <div className="row between" style={{ borderTop: '1px solid var(--border)', paddingTop: 6 }}>
            <span className="text-2 small">{left >= 0 ? 'Remaining' : 'Over target'}</span>
            <span className={left >= 0 ? 'bold tnum' : 'bold tnum bad'}>{fmtKcal(Math.abs(left))}</span>
          </div>
        </div>
      </div>
      <MacroBars totals={totals} targets={targets} />
    </div>
  )
}
