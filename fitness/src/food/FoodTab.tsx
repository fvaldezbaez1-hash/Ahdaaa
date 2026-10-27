import { useLiveQuery } from 'dexie-react-hooks'
import { useRef, useState } from 'react'
import { db } from '../lib/db'
import { addDays, fmtDay, today } from '../lib/dates'
import { MEAL_LABEL, MEALS, sumNutrients } from '../lib/nutrition'
import type { Food, FoodEntry, Meal } from '../lib/types'
import { fmtKcal, fmtNum } from '../lib/units'
import { navigate } from '../router'
import { useSettings, useTargets } from '../state'
import { Icon } from '../ui/Icon'
import { MenuSheet, Sheet } from '../ui/Sheet'
import { toast } from '../ui/toast'
import { CreateFoodSheet, QuickAddSheet } from './FoodForms'
import { FoodSheet } from './FoodSheet'
import { CalorieSummary } from './MacroSummary'
import { addWater, copyDay, copyMeal, foodFromEntry, getFood, saveMeal } from './repo'

export function amountLabel(e: Pick<FoodEntry, 'qty' | 'servingLabel' | 'grams' | 'unit' | 'name'>): string {
  if (e.qty && e.servingLabel) return e.qty === 1 ? e.servingLabel : `${fmtNum(e.qty)} × ${e.servingLabel}`
  if (e.grams) return `${fmtNum(e.grams, 0)} ${e.unit ?? 'g'}`
  return e.name === 'Quick add' ? '' : 'Quick add'
}

export function WaterCard({ date }: { date: string }) {
  const st = useSettings()
  const day = useLiveQuery(() => db.days.get(date), [date])
  const imperial = st.distanceUnit === 'mi'
  const step = imperial ? 236.6 : 250
  const ml = day?.waterMl ?? 0
  const fmt = (v: number) => (imperial ? `${fmtNum(v / 29.574, 0)} fl oz` : v >= 1000 ? `${fmtNum(v / 1000, 2)} L` : `${fmtNum(v, 0)} ml`)
  const pct = Math.min(100, (ml / st.waterGoalMl) * 100)
  return (
    <div className="card stack tight">
      <div className="row">
        <Icon name="drop" />
        <h3 className="grow">Water</h3>
        <span className="small text-2 tnum">
          {fmt(ml)} / {fmt(st.waterGoalMl)}
        </span>
      </div>
      <div className="meter" role="meter" aria-valuenow={Math.round(ml)} aria-valuemax={st.waterGoalMl} aria-label="Water">
        <i style={{ width: `${pct}%` }} />
      </div>
      <div className="row">
        <button className="btn sm" onClick={() => void addWater(date, -step)} disabled={ml <= 0} aria-label="Remove a glass">
          <Icon name="minus" size={16} />
        </button>
        <button className="btn sm soft grow" onClick={() => void addWater(date, step)}>
          + {imperial ? '8 fl oz' : '250 ml'}
        </button>
        <button className="btn sm soft grow" onClick={() => void addWater(date, step * 2)}>
          + {imperial ? '16 fl oz' : '500 ml'}
        </button>
      </div>
    </div>
  )
}

export function FoodTab({ date: dateParam }: { date?: string }) {
  const date = dateParam ?? today()
  const entries = useLiveQuery(() => db.entries.where('date').equals(date).sortBy('createdAt'), [date])
  const { targets } = useTargets()
  const [editing, setEditing] = useState<{ entry: FoodEntry; food: Food } | null>(null)
  const [quickEdit, setQuickEdit] = useState<FoodEntry | null>(null)
  const [editFood, setEditFood] = useState<Food | null>(null)
  const [menu, setMenu] = useState<Meal | null>(null)
  const [dayMenu, setDayMenu] = useState(false)
  const [details, setDetails] = useState(false)
  const dateInput = useRef<HTMLInputElement>(null)

  const all = entries ?? []
  const totals = sumNutrients(all.map((e) => e.n))
  const go = (d: string) => navigate(d === today() ? '/food' : `/food?date=${d}`, { replace: true })

  const openEntry = async (e: FoodEntry) => {
    if (!e.grams) return setQuickEdit(e)
    const f = (e.foodId && (await getFood(e.foodId))) || foodFromEntry(e)
    setEditing({ entry: e, food: f })
  }

  const extra = all.reduce(
    (a, e) => ({
      sugar: a.sugar + (e.n.sugar ?? 0),
      satFat: a.satFat + (e.n.satFat ?? 0),
      sodium: a.sodium + (e.n.sodium ?? 0),
    }),
    { sugar: 0, satFat: 0, sodium: 0 },
  )

  return (
    <div className="screen">
      <header className="topbar">
        <button className="icon-btn" onClick={() => go(addDays(date, -1))} aria-label="Previous day">
          <Icon name="left" />
        </button>
        <button
          className="title"
          onClick={() => {
            const el = dateInput.current
            if (!el) return
            if ('showPicker' in el) {
              try {
                el.showPicker()
                return
              } catch {
                // fall back to focusing
              }
            }
            el.focus()
          }}
          aria-label="Pick a date"
        >
          {fmtDay(date)}
        </button>
        <input
          ref={dateInput}
          type="date"
          value={date}
          max={addDays(today(), 7)}
          onChange={(e) => e.target.value && go(e.target.value)}
          style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 1, height: 1 }}
          tabIndex={-1}
          aria-hidden="true"
        />
        <button className="icon-btn" onClick={() => go(addDays(date, 1))} aria-label="Next day">
          <Icon name="right" />
        </button>
        <button className="icon-btn" onClick={() => setDayMenu(true)} aria-label="Day options">
          <Icon name="more" />
        </button>
      </header>

      <div className="stack">
        <div className="card">
          <CalorieSummary totals={totals} targets={targets} />
          <button className="btn ghost sm" style={{ marginTop: 8, padding: 0 }} onClick={() => setDetails(true)}>
            Nutrition details
          </button>
        </div>

        {MEALS.map((m) => {
          const list = all.filter((e) => e.meal === m)
          const kcal = list.reduce((a, e) => a + e.n.kcal, 0)
          return (
            <section key={m} className="card flush" aria-label={MEAL_LABEL[m]}>
              <div className="meal-head">
                <h3>{MEAL_LABEL[m]}</h3>
                <span className="small text-2 tnum">{list.length ? `${fmtKcal(kcal)} kcal` : ''}</span>
                <button className="icon-btn" onClick={() => setMenu(m)} aria-label={`${MEAL_LABEL[m]} options`}>
                  <Icon name="more" />
                </button>
                <button className="icon-btn accent" onClick={() => navigate(`/add?meal=${m}&date=${date}`)} aria-label={`Add food to ${MEAL_LABEL[m]}`}>
                  <Icon name="plus" />
                </button>
              </div>
              {list.map((e) => (
                <button key={e.id} className="food-row" onClick={() => void openEntry(e)}>
                  <div className="grow">
                    <div className="ellipsis">{e.name}</div>
                    <div className="small muted ellipsis">
                      {e.brand ? `${e.brand} · ` : ''}
                      {amountLabel(e)}
                    </div>
                  </div>
                  <span className="kcal">{fmtKcal(e.n.kcal)}</span>
                </button>
              ))}
              {list.length === 0 && (
                <button className="food-row muted small" onClick={() => navigate(`/add?meal=${m}&date=${date}`)}>
                  <Icon name="plus" size={16} /> Add food
                </button>
              )}
            </section>
          )
        })}

        <WaterCard date={date} />
      </div>

      {editing && (
        <FoodSheet
          food={editing.food}
          entry={editing.entry}
          date={date}
          meal={editing.entry.meal}
          onClose={() => setEditing(null)}
          onEditFood={(f) => {
            setEditing(null)
            setEditFood(f)
          }}
        />
      )}
      {quickEdit && <QuickAddSheet date={date} meal={quickEdit.meal} entry={quickEdit} onClose={() => setQuickEdit(null)} />}
      {editFood && <CreateFoodSheet existing={editFood} onClose={() => setEditFood(null)} onSaved={() => {}} />}
      {menu && (
        <MenuSheet
          title={MEAL_LABEL[menu]}
          onClose={() => setMenu(null)}
          items={[
            {
              label: `Copy ${MEAL_LABEL[menu].toLowerCase()} from yesterday`,
              icon: 'copy',
              onClick: async () => {
                const n = await copyMeal(addDays(date, -1), date, menu)
                toast(n ? `Copied ${n} item${n > 1 ? 's' : ''}` : 'Nothing logged for that meal yesterday')
              },
            },
            {
              label: 'Save as a meal',
              icon: 'list',
              onClick: async () => {
                const list = all.filter((e) => e.meal === menu)
                if (!list.length) return toast('Add some food first')
                const name = prompt('Name this meal', `${MEAL_LABEL[menu]} – ${list.map((e) => e.name).slice(0, 2).join(', ')}`)
                if (!name?.trim()) return
                await saveMeal(name.trim(), list)
                toast('Meal saved — find it under Meals when adding food')
              },
            },
            {
              label: 'Clear this meal',
              icon: 'trash',
              danger: true,
              onClick: async () => {
                const ids = all.filter((e) => e.meal === menu).map((e) => e.id)
                if (!ids.length || !confirm(`Remove ${ids.length} item${ids.length > 1 ? 's' : ''} from ${MEAL_LABEL[menu]}?`)) return
                await db.entries.bulkDelete(ids)
              },
            },
          ]}
        />
      )}
      {dayMenu && (
        <MenuSheet
          title={fmtDay(date)}
          onClose={() => setDayMenu(false)}
          items={[
            {
              label: 'Copy all of yesterday',
              icon: 'copy',
              onClick: async () => {
                const n = await copyDay(addDays(date, -1), date)
                toast(n ? `Copied ${n} items` : 'Nothing logged yesterday')
              },
            },
            ...(date !== today() ? [{ label: 'Go to today', icon: 'calendar' as const, onClick: () => go(today()) }] : []),
          ]}
        />
      )}
      {details && (
        <Sheet title={`Nutrition · ${fmtDay(date)}`} onClose={() => setDetails(false)}>
          <div className="list">
            {[
              ['Calories', `${fmtKcal(totals.kcal)} / ${fmtKcal(targets.kcal)} kcal`],
              ['Protein', `${fmtNum(totals.protein, 1)} / ${targets.protein} g`],
              ['Carbs', `${fmtNum(totals.carbs, 1)} / ${targets.carbs} g`],
              ['Fat', `${fmtNum(totals.fat, 1)} / ${targets.fat} g`],
              ['Fiber', `${fmtNum(totals.fiber ?? 0, 1)} g`],
              ['Sugar', `${fmtNum(extra.sugar, 1)} g`],
              ['Saturated fat', `${fmtNum(extra.satFat, 1)} g`],
              ['Sodium', `${fmtNum(extra.sodium, 0)} mg`],
            ].map(([k, v]) => (
              <div key={k} className="list-row">
                <span className="grow">{k}</span>
                <span className="tnum bold">{v}</span>
              </div>
            ))}
          </div>
          <p className="tiny muted" style={{ marginTop: 10 }}>
            Sugar, saturated fat and sodium only count foods that list them (most packaged foods do).
          </p>
        </Sheet>
      )}
    </div>
  )
}
