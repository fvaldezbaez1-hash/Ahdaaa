import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useRef, useState } from 'react'
import { BUILTIN_FOODS } from '../data/foods'
import { db } from '../lib/db'
import { fmtDay, today } from '../lib/dates'
import { MEAL_LABEL, MEALS, mealForHour } from '../lib/nutrition'
import { lookupBarcode, searchOff } from '../lib/openfoodfacts'
import type { Food, Meal, SavedMeal } from '../lib/types'
import { fmtKcal } from '../lib/units'
import { goBack } from '../router'
import { Empty, SearchBox, Segmented } from '../ui/controls'
import { Icon } from '../ui/Icon'
import { Sheet } from '../ui/Sheet'
import { toast } from '../ui/toast'
import { CreateFoodSheet, QuickAddSheet } from './FoodForms'
import { FoodSheet } from './FoodSheet'
import { amountLabel } from './FoodTab'
import { findByBarcode, logSavedMeal, mealTotals, searchLocal } from './repo'
import { ScannerSheet } from './Scanner'

type Tab = 'recent' | 'favorites' | 'mine' | 'meals'

function servingHint(f: Food): string {
  const s = f.servings[0]
  if (s) return `${s.label} · ${fmtKcal((f.per100.kcal * s.grams) / 100)} kcal`
  return `100 ${f.unit} · ${fmtKcal(f.per100.kcal)} kcal`
}

export function FoodList({ foods, onPick }: { foods: Food[]; onPick: (f: Food) => void }) {
  return (
    <div className="list">
      {foods.map((f) => (
        <button key={f.id} className="list-row" onClick={() => onPick(f)}>
          <div className="grow">
            <div className="ellipsis bold">
              {f.favorite && <Icon name="starFill" size={13} />} {f.name}
            </div>
            <div className="small muted ellipsis">
              {f.brand ? `${f.brand} · ` : ''}
              {servingHint(f)}
            </div>
          </div>
          <Icon name="plus" className="chev" />
        </button>
      ))}
    </div>
  )
}

export function AddFoodScreen({ meal: mealParam, date: dateParam }: { meal?: string; date?: string }) {
  const date = dateParam ?? today()
  const [meal, setMeal] = useState<Meal>((MEALS as string[]).includes(mealParam ?? '') ? (mealParam as Meal) : mealForHour(new Date().getHours()))
  const [q, setQ] = useState('')
  const [tab, setTab] = useState<Tab>('recent')
  const [picked, setPicked] = useState<Food | null>(null)
  const [quick, setQuick] = useState(false)
  const [create, setCreate] = useState<{ barcode?: string; name?: string; existing?: Food } | null>(null)
  const [scan, setScan] = useState(false)
  const [lookingUp, setLookingUp] = useState(false)
  const [online, setOnline] = useState<{ q: string; status: 'loading' | 'done' | 'error'; results: Food[] } | null>(null)
  const [mealOpen, setMealOpen] = useState<SavedMeal | null>(null)
  const [added, setAdded] = useState(0)
  const abort = useRef<AbortController | null>(null)

  const saved = useLiveQuery(() => db.foods.toArray(), [])
  const recentEntries = useLiveQuery(() => db.entries.orderBy('createdAt').reverse().limit(300).toArray(), [])
  const meals = useLiveQuery(() => db.meals.orderBy('updatedAt').reverse().toArray(), [])

  const local = useMemo(() => searchLocal(q, saved ?? []), [q, saved])

  const recent = useMemo(() => {
    const byId = new Map<string, Food>([...BUILTIN_FOODS, ...(saved ?? [])].map((f) => [f.id, f]))
    const out: Food[] = []
    const seen = new Set<string>()
    for (const e of recentEntries ?? []) {
      if (!e.foodId || seen.has(e.foodId)) continue
      seen.add(e.foodId)
      const f = byId.get(e.foodId)
      if (f) out.push(f)
      if (out.length >= 30) break
    }
    return out
  }, [recentEntries, saved])

  const favorites = useMemo(() => (saved ?? []).filter((f) => f.favorite).sort((a, b) => a.name.localeCompare(b.name)), [saved])
  const mine = useMemo(() => (saved ?? []).filter((f) => f.source === 'custom').sort((a, b) => a.name.localeCompare(b.name)), [saved])

  const searchOnline = async () => {
    const term = q.trim()
    if (term.length < 2) return
    abort.current?.abort()
    const ctrl = new AbortController()
    abort.current = ctrl
    setOnline({ q: term, status: 'loading', results: [] })
    try {
      const results = await searchOff(term, ctrl.signal)
      if (!ctrl.signal.aborted) setOnline({ q: term, status: 'done', results })
    } catch {
      if (!ctrl.signal.aborted) setOnline({ q: term, status: 'error', results: [] })
    }
  }

  const onBarcode = async (code: string) => {
    setScan(false)
    const mine = await findByBarcode(code)
    if (mine) return setPicked(mine)
    setLookingUp(true)
    try {
      const f = await lookupBarcode(code)
      if (f) setPicked(f)
      else {
        toast('Not in the database yet — add it once and it’s saved')
        setCreate({ barcode: code })
      }
    } catch {
      toast('No connection. You can add it as your own food.')
      setCreate({ barcode: code })
    } finally {
      setLookingUp(false)
    }
  }

  const tabList: Food[] = tab === 'recent' ? recent : tab === 'favorites' ? favorites : mine

  return (
    <div className="screen no-tabs">
      <header className="topbar">
        <button className="icon-btn" onClick={() => goBack('/food')} aria-label="Back">
          <Icon name="left" />
        </button>
        <div className="grow" style={{ textAlign: 'center' }}>
          <select
            value={meal}
            onChange={(e) => setMeal(e.target.value as Meal)}
            aria-label="Meal"
            style={{ border: 0, background: 'transparent', fontWeight: 650, fontSize: 17, textAlign: 'center' }}
          >
            {MEALS.map((m) => (
              <option key={m} value={m}>
                {MEAL_LABEL[m]}
              </option>
            ))}
          </select>
          <div className="tiny muted">{fmtDay(date)}</div>
        </div>
        <button className="btn primary sm" onClick={() => goBack(`/food?date=${date}`)}>
          Done{added ? ` (${added})` : ''}
        </button>
      </header>

      <div className="stack">
        <SearchBox value={q} onChange={(v) => { setQ(v); if (!v) setOnline(null) }} placeholder="Search foods" onSubmit={searchOnline} />
        <div className="grid-3">
          <button className="btn soft" onClick={() => setScan(true)}>
            <Icon name="barcode" size={18} /> Scan
          </button>
          <button className="btn" onClick={() => setQuick(true)}>
            <Icon name="zap" size={18} /> Quick
          </button>
          <button className="btn" onClick={() => setCreate({ name: q })}>
            <Icon name="plus" size={18} /> Create
          </button>
        </div>
        {lookingUp && <p className="small muted" style={{ textAlign: 'center' }}>Looking up barcode…</p>}

        {q.trim() ? (
          <>
            {local.length > 0 && (
              <>
                <div className="field-label">On your phone</div>
                <FoodList foods={local} onPick={setPicked} />
              </>
            )}
            {(!online || online.q !== q.trim()) && (
              <button className="btn soft block" onClick={searchOnline} disabled={q.trim().length < 2}>
                <Icon name="search" size={18} /> Search Open Food Facts for “{q.trim()}”
              </button>
            )}
            {online && online.q === q.trim() && (
              <>
                <div className="field-label">Open Food Facts</div>
                {online.status === 'loading' && <p className="small muted">Searching…</p>}
                {online.status === 'error' && (
                  <div className="card small text-2">
                    Couldn’t reach Open Food Facts. Check your connection and try again, or use Quick add.
                  </div>
                )}
                {online.status === 'done' &&
                  (online.results.length ? (
                    <FoodList foods={online.results} onPick={setPicked} />
                  ) : (
                    <Empty>No results. Try fewer words, scan the barcode, or create the food.</Empty>
                  ))}
              </>
            )}
          </>
        ) : (
          <>
            <Segmented
              value={tab}
              onChange={setTab}
              label="Food lists"
              options={[
                { value: 'recent', label: 'Recent' },
                { value: 'favorites', label: 'Favorites' },
                { value: 'mine', label: 'My foods' },
                { value: 'meals', label: 'Meals' },
              ]}
            />
            {tab === 'meals' ? (
              meals && meals.length ? (
                <div className="list">
                  {meals.map((m) => {
                    const t = mealTotals(m)
                    return (
                      <button key={m.id} className="list-row" onClick={() => setMealOpen(m)}>
                        <div className="grow">
                          <div className="bold ellipsis">{m.name}</div>
                          <div className="small muted">
                            {m.items.length} items · {fmtKcal(t.kcal)} kcal
                          </div>
                        </div>
                        <Icon name="plus" className="chev" />
                      </button>
                    )
                  })}
                </div>
              ) : (
                <Empty icon="food">Save a meal from your diary (⋯ next to any meal) to log it again in one tap.</Empty>
              )
            ) : tabList.length ? (
              <FoodList foods={tabList} onPick={setPicked} />
            ) : (
              <Empty icon={tab === 'favorites' ? 'star' : 'food'}>
                {tab === 'recent'
                  ? 'Foods you log show up here. Search, scan a barcode, or try “chicken”, “rice” or “banana”.'
                  : tab === 'favorites'
                    ? 'Tap the ☆ on any food to keep it here.'
                    : 'Foods you create show up here.'}
              </Empty>
            )}
          </>
        )}
      </div>

      {picked && (
        <FoodSheet
          food={picked}
          date={date}
          meal={meal}
          onClose={() => setPicked(null)}
          onLogged={() => setAdded((n) => n + 1)}
          onEditFood={(f) => {
            setPicked(null)
            setCreate({ existing: f })
          }}
        />
      )}
      {quick && <QuickAddSheet date={date} meal={meal} onClose={() => setQuick(false)} onSaved={() => setAdded((n) => n + 1)} />}
      {create && (
        <CreateFoodSheet
          barcode={create.barcode}
          initialName={create.name}
          existing={create.existing}
          onClose={() => setCreate(null)}
          onSaved={(f) => setPicked(f)}
        />
      )}
      {scan && <ScannerSheet onDetected={onBarcode} onClose={() => setScan(false)} />}
      {mealOpen && (
        <Sheet
          title={mealOpen.name}
          onClose={() => setMealOpen(null)}
          footer={
            <div className="row">
              <button
                className="btn danger"
                onClick={async () => {
                  if (!confirm(`Delete saved meal “${mealOpen.name}”?`)) return
                  await db.meals.delete(mealOpen.id)
                  setMealOpen(null)
                }}
              >
                Delete
              </button>
              <button
                className="btn primary lg grow"
                onClick={async () => {
                  await logSavedMeal(mealOpen, date, meal)
                  toast(`Added ${mealOpen.name}`)
                  setAdded((n) => n + mealOpen.items.length)
                  setMealOpen(null)
                }}
              >
                Add all to {MEAL_LABEL[meal]}
              </button>
            </div>
          }
        >
          <div className="list">
            {mealOpen.items.map((it, i) => (
              <div key={i} className="list-row">
                <div className="grow">
                  <div className="ellipsis">{it.name}</div>
                  <div className="small muted">
                    {amountLabel(it) || 'Quick add'}
                  </div>
                </div>
                <span className="tnum bold">{fmtKcal(it.n.kcal)}</span>
              </div>
            ))}
          </div>
        </Sheet>
      )}
    </div>
  )
}
