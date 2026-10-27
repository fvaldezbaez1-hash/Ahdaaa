import { useRef, useState } from 'react'
import { addImportedWorkouts, makeBackup, restoreBackup } from '../lib/backup'
import { toCsv } from '../lib/csv'
import { db } from '../lib/db'
import { today } from '../lib/dates'
import { updateSettings } from '../lib/settings'
import { exportWorkoutCsv, importWorkoutCsv } from '../lib/workoutCsv'
import { useExercises, useSettings } from '../state'
import { Toggle } from '../ui/controls'
import { Icon } from '../ui/Icon'
import { toast } from '../ui/toast'
import { Topbar } from '../ui/Topbar'

/** Share sheet on phones (Save to Files / Drive / AirDrop), download elsewhere. */
async function saveFile(name: string, type: string, content: string): Promise<boolean> {
  const file = new File([content], name, { type })
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean }
  if (nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: name })
      return true
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return false
    }
  }
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return true
}

function pickFile(input: HTMLInputElement | null): Promise<string | null> {
  return new Promise((resolve) => {
    if (!input) return resolve(null)
    input.value = ''
    input.onchange = async () => {
      const f = input.files?.[0]
      resolve(f ? await f.text() : null)
    }
    input.oncancel = () => resolve(null)
    input.click()
  })
}

export function DataScreen() {
  const st = useSettings()
  const { list, map } = useExercises()
  const [photos, setPhotos] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const jsonInput = useRef<HTMLInputElement>(null)
  const csvInput = useRef<HTMLInputElement>(null)

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label)
    try {
      await fn()
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const backup = () =>
    run('backup', async () => {
      const data = await makeBackup({ photos })
      const ok = await saveFile(`forge-backup-${today()}.json`, 'application/json', JSON.stringify(data))
      if (ok) {
        await updateSettings({ lastBackupAt: Date.now() })
        toast('Backup saved')
      }
    })

  const restore = () =>
    run('restore', async () => {
      const text = await pickFile(jsonInput.current)
      if (!text) return
      let data: unknown
      try {
        data = JSON.parse(text)
      } catch {
        throw new Error('That file isn’t a Forge backup.')
      }
      if (!confirm('Replace everything on this phone with this backup? This can’t be undone.')) return
      await restoreBackup(data)
      toast('Backup restored')
    })

  const importCsv = () =>
    run('import', async () => {
      const text = await pickFile(csvInput.current)
      if (!text) return
      const r = importWorkoutCsv(text, { exercises: list, weightUnit: st.weightUnit, distanceUnit: st.distanceUnit })
      const sets = r.workouts.reduce((n, w) => n + w.exercises.reduce((m, e) => m + e.sets.length, 0), 0)
      const app = r.format === 'hevy' ? 'Hevy' : 'Strong'
      const unitNote = r.format === 'strong' ? `\n\nWeights are read as ${st.weightUnit} (Strong exports use your app’s unit). Change Units in Settings first if that’s wrong.` : ''
      if (!confirm(`Import ${r.workouts.length} workouts (${sets} sets) from ${app}?${r.newExercises.length ? ` ${r.newExercises.length === 1 ? '1 exercise isn’t' : `${r.newExercises.length} exercises aren’t`} in Forge’s library and will be added as custom.` : ''}${unitNote}`)) return
      const res = await addImportedWorkouts(r.workouts, r.newExercises)
      toast(`Imported ${res.added} workouts${res.skipped ? ` (${res.skipped} already here)` : ''}`)
    })

  const exportWorkouts = () =>
    run('workouts', async () => {
      const w = await db.workouts.toArray()
      if (!w.length) return toast('No workouts yet')
      await saveFile(`forge-workouts-${today()}.csv`, 'text/csv', exportWorkoutCsv(w, map))
    })

  const exportFood = () =>
    run('food', async () => {
      const e = await db.entries.orderBy('date').toArray()
      if (!e.length) return toast('No food logged yet')
      const rows: unknown[][] = [['date', 'meal', 'food', 'brand', 'amount', 'unit', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sugar_g', 'sodium_mg']]
      for (const x of e)
        rows.push([x.date, x.meal, x.name, x.brand ?? '', x.qty && x.servingLabel ? `${x.qty} × ${x.servingLabel}` : x.grams ?? '', x.unit ?? '', x.n.kcal, x.n.protein, x.n.carbs, x.n.fat, x.n.fiber ?? '', x.n.sugar ?? '', x.n.sodium ?? ''])
      await saveFile(`forge-food-${today()}.csv`, 'text/csv', toCsv(rows))
    })

  const exportBody = () =>
    run('body', async () => {
      const b = await db.body.orderBy('date').toArray()
      if (!b.length) return toast('No weigh-ins yet')
      const rows: unknown[][] = [['date', 'weight_kg', 'body_fat_pct', 'waist_cm', 'chest_cm', 'hips_cm', 'arms_cm', 'thighs_cm', 'neck_cm']]
      const r = (n?: number) => (n === undefined ? '' : Math.round(n * 100) / 100)
      for (const x of b) rows.push([x.date, r(x.weightKg), r(x.bodyFat), r(x.waist), r(x.chest), r(x.hips), r(x.arms), r(x.thighs), r(x.neck)])
      await saveFile(`forge-body-${today()}.csv`, 'text/csv', toCsv(rows))
    })

  return (
    <div className="screen no-tabs">
      <Topbar title="Your data" back="/settings" />
      <div className="stack loose">
        <section className="stack">
          <div className="card stack">
            <div className="row">
              <Icon name="download" />
              <h3 className="grow">Back up</h3>
            </div>
            <p className="small text-2">
              Everything lives only on this phone. Save a backup now and then (to iCloud Drive, Google Drive or email) so a lost or reset phone doesn’t mean lost progress.
            </p>
            <div className="row between">
              <span className="small">Include progress photos</span>
              <Toggle checked={photos} onChange={setPhotos} label="Include progress photos" />
            </div>
            <button className="btn primary block" onClick={backup} disabled={!!busy}>
              {busy === 'backup' ? 'Preparing…' : 'Save backup'}
            </button>
            <button className="btn block" onClick={restore} disabled={!!busy}>
              Restore from backup
            </button>
          </div>
        </section>

        <section className="stack">
          <div className="card stack">
            <div className="row">
              <Icon name="upload" />
              <h3 className="grow">Import from Hevy or Strong</h3>
            </div>
            <p className="small text-2">
              Hevy: Profile → Settings → Export & Import Data → Export Workouts. Strong: Settings → Export Strong Data. Then pick the CSV file here. Workouts already in Forge are skipped.
            </p>
            <button className="btn soft block" onClick={importCsv} disabled={!!busy}>
              {busy === 'import' ? 'Importing…' : 'Choose CSV file'}
            </button>
          </div>
        </section>

        <section className="stack tight">
          <div className="field-label">Export spreadsheets (CSV)</div>
          <div className="list">
            <button className="list-row" onClick={exportWorkouts} disabled={!!busy}>
              <Icon name="dumbbell" />
              <span className="grow">Workouts (Hevy format)</span>
              <Icon name="share" className="chev" />
            </button>
            <button className="list-row" onClick={exportFood} disabled={!!busy}>
              <Icon name="food" />
              <span className="grow">Food diary</span>
              <Icon name="share" className="chev" />
            </button>
            <button className="list-row" onClick={exportBody} disabled={!!busy}>
              <Icon name="scale" />
              <span className="grow">Weight & measurements</span>
              <Icon name="share" className="chev" />
            </button>
          </div>
        </section>

        <section className="stack tight">
          <div className="field-label">Danger zone</div>
          <button
            className="btn danger block"
            style={{ border: '1px solid var(--border)' }}
            onClick={async () => {
              if (!confirm('Erase ALL data on this phone: workouts, food, weight, photos and settings?')) return
              if (!confirm('Really erase everything? Make a backup first if you might want it back.')) return
              await db.delete()
              location.hash = ''
              location.reload()
            }}
          >
            Erase all data
          </button>
        </section>
      </div>
      <input ref={jsonInput} type="file" accept="application/json,.json" hidden />
      <input ref={csvInput} type="file" accept=".csv,text/csv,text/comma-separated-values" hidden />
    </div>
  )
}
