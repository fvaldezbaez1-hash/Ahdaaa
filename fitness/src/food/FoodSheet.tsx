import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db } from '../lib/db'
import { MEAL_LABEL, MEALS, nutrientsFor } from '../lib/nutrition'
import type { Food, FoodEntry, Meal } from '../lib/types'
import { fmtKcal, fmtNum } from '../lib/units'
import { NumField } from '../ui/controls'
import { Icon } from '../ui/Icon'
import { Sheet } from '../ui/Sheet'
import { toast } from '../ui/toast'
import { MACROS } from './MacroSummary'
import { addEntry, entryFromFood, rememberFood, toggleFavorite } from './repo'

/** Pick an amount of a food and log it (or edit an existing diary entry). */
export function FoodSheet({
  food,
  date,
  meal: initialMeal,
  entry,
  onClose,
  onLogged,
  onEditFood,
}: {
  food: Food
  date: string
  meal: Meal
  entry?: FoodEntry
  onClose: () => void
  onLogged?: (food: Food) => void
  onEditFood?: (food: Food) => void
}) {
  const saved = useLiveQuery(() => db.foods.get(food.id), [food.id])
  const fav = !!saved?.favorite
  const unitLabel = food.unit
  const units = [...food.servings.map((s) => s.label), unitLabel]
  const startUnit = entry ? (entry.servingLabel && food.servings.some((s) => s.label === entry.servingLabel) ? entry.servingLabel : unitLabel) : food.servings[0]?.label ?? unitLabel
  const [unit, setUnit] = useState(startUnit)
  const [qty, setQty] = useState<number | undefined>(entry ? (startUnit === unitLabel ? entry.grams : entry.qty) : startUnit === unitLabel ? 100 : 1)
  const [meal, setMeal] = useState<Meal>(entry?.meal ?? initialMeal)

  const serving = food.servings.find((s) => s.label === unit)
  const grams = qty === undefined ? 0 : serving ? serving.grams * qty : qty
  const n = nutrientsFor(food, grams)
  const macroKcal = n.protein * 4 + n.carbs * 4 + n.fat * 9

  const submit = async () => {
    if (!qty || qty <= 0) return
    const e = entryFromFood(food, grams, entry?.date ?? date, meal, serving ? { label: serving.label, qty } : undefined)
    if (entry) {
      await db.entries.put({ ...entry, ...e })
      if (!food.id.startsWith('entry:')) await rememberFood(food)
      toast('Updated')
    } else {
      await addEntry(e, food)
      toast(`Added ${food.name}`)
      onLogged?.(food)
    }
    onClose()
  }

  return (
    <Sheet
      title={food.name}
      onClose={onClose}
      headerExtra={
        !food.id.startsWith('entry:') && (
          <button
            className="icon-btn"
            style={{ color: fav ? 'var(--gold)' : undefined }}
            onClick={async () => toast((await toggleFavorite(food)) ? 'Added to favorites' : 'Removed from favorites')}
            aria-label={fav ? 'Remove from favorites' : 'Add to favorites'}
            aria-pressed={fav}
          >
            <Icon name={fav ? 'starFill' : 'star'} />
          </button>
        )
      }
      footer={
        <div className="row">
          {entry && (
            <button
              className="btn danger"
              onClick={async () => {
                await db.entries.delete(entry.id)
                toast('Removed')
                onClose()
              }}
            >
              Delete
            </button>
          )}
          <button className="btn primary lg grow" disabled={!qty || qty <= 0} onClick={submit}>
            {entry ? 'Update' : `Add to ${MEAL_LABEL[meal]}`}
          </button>
        </div>
      }
    >
      <div className="stack">
        {food.brand && <p className="text-2 small" style={{ marginTop: -6 }}>{food.brand}</p>}
        <div className="row">
          <NumField
            className="input"
            style={{ width: 110, fontSize: 20, fontWeight: 700, textAlign: 'center' }}
            value={qty}
            onChange={setQty}
            aria-label="Amount"
            dp={2}
          />
          <select className="input grow" value={unit} onChange={(e) => {
            const next = e.target.value
            // Keep roughly the same amount when switching between servings and grams.
            const nextServing = food.servings.find((s) => s.label === next)
            if (qty) setQty(nextServing ? Math.round((grams / nextServing.grams) * 100) / 100 : Math.round(grams))
            setUnit(next)
          }} aria-label="Unit">
            {units.map((u) => {
              const s = food.servings.find((x) => x.label === u)
              return (
                <option key={u} value={u}>
                  {s ? (/\d\s*(g|ml)\b/i.test(u) ? u : `${u} (${fmtNum(s.grams)} ${unitLabel})`) : unitLabel === 'g' ? 'grams' : 'ml'}
                </option>
              )
            })}
          </select>
        </div>

        <div className="card stack">
          <div className="row between">
            <span className="text-2">Calories</span>
            <span style={{ fontSize: 28, fontWeight: 750 }}>{fmtKcal(n.kcal)}</span>
          </div>
          {macroKcal > 0 && (
            <div style={{ display: 'flex', height: 10, gap: 2, borderRadius: 999, overflow: 'hidden' }} aria-hidden="true">
              {MACROS.map((m) => {
                const k = (n[m.key] * (m.key === 'fat' ? 9 : 4)) / macroKcal
                return k > 0 ? <i key={m.key} style={{ flex: k, background: m.color }} /> : null
              })}
            </div>
          )}
          <div className="grid-3">
            {MACROS.map((m) => (
              <div key={m.key} className="stat">
                <span className="label row" style={{ gap: 6 }}>
                  <i className="swatch" style={{ background: m.color }} />
                  {m.label}
                </span>
                <span className="value">
                  {fmtNum(n[m.key], 1)}
                  <small>g</small>
                </span>
              </div>
            ))}
          </div>
          <div className="small text-2 row wrap" style={{ gap: 14 }}>
            {n.fiber !== undefined && <span>Fiber {fmtNum(n.fiber, 1)} g</span>}
            {n.sugar !== undefined && <span>Sugar {fmtNum(n.sugar, 1)} g</span>}
            {n.satFat !== undefined && <span>Sat. fat {fmtNum(n.satFat, 1)} g</span>}
            {n.sodium !== undefined && <span>Sodium {fmtNum(n.sodium, 0)} mg</span>}
          </div>
        </div>

        <label className="field">
          <span>Meal</span>
          <select value={meal} onChange={(e) => setMeal(e.target.value as Meal)}>
            {MEALS.map((m) => (
              <option key={m} value={m}>
                {MEAL_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
        <p className="tiny muted">
          {food.source === 'off'
            ? 'Nutrition from Open Food Facts (community data). Check it against the label if something looks off.'
            : food.source === 'builtin'
              ? 'Nutrition from USDA FoodData Central.'
              : 'Your own food.'}
          {food.source === 'custom' && onEditFood && !food.id.startsWith('entry:') && (
            <>
              {' '}
              <button className="btn ghost sm" style={{ padding: 0, minHeight: 0 }} onClick={() => onEditFood(food)}>
                Edit food
              </button>
            </>
          )}
        </p>
      </div>
    </Sheet>
  )
}
