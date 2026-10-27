import { useState } from 'react'
import { db } from '../lib/db'
import { uid } from '../lib/id'
import { kcalFromMacros, MEAL_LABEL, MEALS } from '../lib/nutrition'
import type { Food, FoodEntry, Meal } from '../lib/types'
import { Field, NumField, UnitInput } from '../ui/controls'
import { Sheet } from '../ui/Sheet'
import { toast } from '../ui/toast'
import { addEntry } from './repo'

/** Log calories (and optionally macros) without picking a food. */
export function QuickAddSheet({
  date,
  meal: initialMeal,
  entry,
  onClose,
  onSaved,
}: {
  date: string
  meal: Meal
  entry?: FoodEntry
  onClose: () => void
  onSaved?: () => void
}) {
  const [kcal, setKcal] = useState<number | undefined>(entry?.n.kcal)
  const [p, setP] = useState<number | undefined>(entry?.n.protein || undefined)
  const [c, setC] = useState<number | undefined>(entry?.n.carbs || undefined)
  const [f, setF] = useState<number | undefined>(entry?.n.fat || undefined)
  const [name, setName] = useState(entry?.name ?? '')
  const [meal, setMeal] = useState<Meal>(entry?.meal ?? initialMeal)
  const fromMacros = kcalFromMacros(p ?? 0, c ?? 0, f ?? 0)
  const total = kcal ?? (fromMacros || undefined)

  const save = async () => {
    if (!total) return
    const n = { kcal: Math.round(total), protein: p ?? 0, carbs: c ?? 0, fat: f ?? 0 }
    if (entry) await db.entries.put({ ...entry, meal, name: name.trim() || 'Quick add', n })
    else await addEntry({ date, meal, name: name.trim() || 'Quick add', n })
    toast(entry ? 'Updated' : `Added ${Math.round(total)} kcal`)
    onSaved?.()
    onClose()
  }

  return (
    <Sheet
      title="Quick add"
      onClose={onClose}
      footer={
        <div className="row">
          {entry && (
            <button
              className="btn danger"
              onClick={async () => {
                await db.entries.delete(entry.id)
                onClose()
              }}
            >
              Delete
            </button>
          )}
          <button className="btn primary lg grow" disabled={!total} onClick={save}>
            {entry ? 'Update' : `Add to ${MEAL_LABEL[meal]}`}
          </button>
        </div>
      }
    >
      <div className="stack">
        <Field label="Calories">
          <UnitInput value={kcal} onChange={setKcal} unit="kcal" dp={0} autoFocus placeholder={fromMacros ? String(fromMacros) : ''} />
        </Field>
        <div className="grid-3">
          <Field label="Protein">
            <UnitInput value={p} onChange={setP} unit="g" dp={1} />
          </Field>
          <Field label="Carbs">
            <UnitInput value={c} onChange={setC} unit="g" dp={1} />
          </Field>
          <Field label="Fat">
            <UnitInput value={f} onChange={setF} unit="g" dp={1} />
          </Field>
        </div>
        {kcal !== undefined && fromMacros > 0 && Math.abs(fromMacros - kcal) > Math.max(30, kcal * 0.15) && (
          <p className="small muted">Heads up: those macros add up to about {fromMacros} kcal.</p>
        )}
        <Field label="Description (optional)">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Restaurant burrito" />
        </Field>
        <Field label="Meal">
          <select value={meal} onChange={(e) => setMeal(e.target.value as Meal)}>
            {MEALS.map((m) => (
              <option key={m} value={m}>
                {MEAL_LABEL[m]}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </Sheet>
  )
}

/** Create (or edit) your own food from its nutrition label. */
export function CreateFoodSheet({
  barcode,
  initialName,
  existing,
  onClose,
  onSaved,
}: {
  barcode?: string
  initialName?: string
  existing?: Food
  onClose: () => void
  onSaved: (f: Food) => void
}) {
  const s0 = existing?.servings[0]
  const per = (v: number | undefined) => (v === undefined || !s0 ? v : Math.round(((v * s0.grams) / 100) * 10) / 10)
  const [name, setName] = useState(existing?.name ?? initialName ?? '')
  const [brand, setBrand] = useState(existing?.brand ?? '')
  const [code, setCode] = useState(existing?.barcode ?? barcode ?? '')
  const [unit, setUnit] = useState<'g' | 'ml'>(existing?.unit ?? 'g')
  const [label, setLabel] = useState(s0?.label ?? '1 serving')
  const [size, setSize] = useState<number | undefined>(s0?.grams ?? 100)
  const [kcal, setKcal] = useState<number | undefined>(per(existing?.per100.kcal))
  const [p, setP] = useState<number | undefined>(per(existing?.per100.protein))
  const [c, setC] = useState<number | undefined>(per(existing?.per100.carbs))
  const [f, setF] = useState<number | undefined>(per(existing?.per100.fat))
  const [fiber, setFiber] = useState<number | undefined>(per(existing?.per100.fiber))
  const [sugar, setSugar] = useState<number | undefined>(per(existing?.per100.sugar))
  const [sodium, setSodium] = useState<number | undefined>(per(existing?.per100.sodium))

  const ok = name.trim() && size && size > 0 && kcal !== undefined
  const save = async () => {
    if (!ok) return
    const k = 100 / size!
    const r1 = (v: number) => Math.round(v * k * 10) / 10
    const food: Food = {
      id: existing?.id ?? `c:${uid()}`,
      name: name.trim(),
      brand: brand.trim() || undefined,
      barcode: code.replace(/\D/g, '') || undefined,
      per100: {
        kcal: Math.round(kcal! * k),
        protein: r1(p ?? 0),
        carbs: r1(c ?? 0),
        fat: r1(f ?? 0),
        ...(fiber !== undefined ? { fiber: r1(fiber) } : {}),
        ...(sugar !== undefined ? { sugar: r1(sugar) } : {}),
        ...(sodium !== undefined ? { sodium: Math.round(sodium * k) } : {}),
      },
      servings: [{ label: label.trim() || '1 serving', grams: size! }],
      unit,
      source: 'custom',
      favorite: existing?.favorite,
      uses: existing?.uses,
      lastUsed: existing?.lastUsed,
    }
    await db.foods.put(food)
    toast(existing ? 'Food updated' : 'Food created')
    onSaved(food)
    onClose()
  }

  return (
    <Sheet
      title={existing ? 'Edit food' : 'Create food'}
      onClose={onClose}
      footer={
        <button className="btn primary block lg" disabled={!ok} onClick={save}>
          Save food
        </button>
      }
    >
      <div className="stack">
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Protein bar" autoFocus={!existing} />
        </Field>
        <div className="grid-2">
          <Field label="Brand (optional)">
            <input value={brand} onChange={(e) => setBrand(e.target.value)} />
          </Field>
          <Field label="Barcode (optional)">
            <input value={code} inputMode="numeric" onChange={(e) => setCode(e.target.value)} />
          </Field>
        </div>
        <p className="field-label" style={{ marginTop: 6 }}>Serving size (from the label)</p>
        <div className="row">
          <input className="input grow" value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Serving name" placeholder="1 bar" />
          <NumField className="input" style={{ width: 80, textAlign: 'center' }} value={size} onChange={setSize} aria-label="Serving size" />
          <select className="input" style={{ width: 72 }} value={unit} onChange={(e) => setUnit(e.target.value as 'g' | 'ml')} aria-label="Unit">
            <option value="g">g</option>
            <option value="ml">ml</option>
          </select>
        </div>
        <p className="field-label" style={{ marginTop: 6 }}>Per serving</p>
        <Field label="Calories">
          <UnitInput value={kcal} onChange={setKcal} unit="kcal" dp={0} />
        </Field>
        <div className="grid-3">
          <Field label="Protein">
            <UnitInput value={p} onChange={setP} unit="g" dp={1} />
          </Field>
          <Field label="Carbs">
            <UnitInput value={c} onChange={setC} unit="g" dp={1} />
          </Field>
          <Field label="Fat">
            <UnitInput value={f} onChange={setF} unit="g" dp={1} />
          </Field>
          <Field label="Fiber">
            <UnitInput value={fiber} onChange={setFiber} unit="g" dp={1} />
          </Field>
          <Field label="Sugar">
            <UnitInput value={sugar} onChange={setSugar} unit="g" dp={1} />
          </Field>
          <Field label="Sodium">
            <UnitInput value={sodium} onChange={setSodium} unit="mg" dp={0} />
          </Field>
        </div>
        {existing && (
          <button
            className="btn danger"
            onClick={async () => {
              if (!confirm('Delete this food? Diary entries that used it stay.')) return
              await db.foods.delete(existing.id)
              onClose()
            }}
          >
            Delete food
          </button>
        )}
      </div>
    </Sheet>
  )
}

