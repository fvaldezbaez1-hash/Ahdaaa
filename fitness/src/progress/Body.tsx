import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState } from 'react'
import { db } from '../lib/db'
import { addDays, dayKey, fmtDay, fmtShortDay, parseDay, today } from '../lib/dates'
import { uid } from '../lib/id'
import { trendOn, weeklyRate } from '../lib/trend'
import type { BodyEntry, Photo, Pose } from '../lib/types'
import { cmTo, fmtLength, fmtNum, fmtWeight, kgTo, round, toCm, toKg } from '../lib/units'
import { useSettings, useWeightTrend } from '../state'
import { LineChart } from '../ui/charts'
import { Empty, Field, Segmented, Stat, UnitInput } from '../ui/controls'
import { Icon } from '../ui/Icon'
import { Sheet } from '../ui/Sheet'
import { toast } from '../ui/toast'

type Range = '1m' | '3m' | '6m' | '1y' | 'all'
const RANGE_DAYS: Record<Range, number> = { '1m': 30, '3m': 91, '6m': 182, '1y': 365, all: 100_000 }

const MEASURES = [
  ['waist', 'Waist'],
  ['chest', 'Chest'],
  ['hips', 'Hips'],
  ['arms', 'Arms'],
  ['thighs', 'Thighs'],
  ['neck', 'Neck'],
] as const

export function BodyEntrySheet({ date: initialDate, onClose }: { date?: string; onClose: () => void }) {
  const st = useSettings()
  const [date, setDate] = useState(initialDate ?? today())
  // undefined while loading, null when nothing is logged for that day.
  const existing = useLiveQuery(async () => (await db.body.get(date)) ?? null, [date])
  const [form, setForm] = useState<BodyEntry>({ date })
  const loadedFor = useRef<string | null>(null)
  useEffect(() => {
    if (existing !== undefined && loadedFor.current !== date) {
      loadedFor.current = date
      setForm(existing ?? { date })
    }
  }, [existing, date])

  const lenVal = (v?: number) => (v === undefined ? undefined : round(cmTo(v, st.lengthUnit), 1))
  const setLen = (k: (typeof MEASURES)[number][0], v?: number) => setForm((f) => ({ ...f, [k]: v === undefined ? undefined : toCm(v, st.lengthUnit) }))

  const save = async () => {
    const clean: BodyEntry = { date }
    for (const [k, v] of Object.entries(form)) if (k !== 'date' && v !== undefined) Object.assign(clean, { [k]: v })
    if (Object.keys(clean).length === 1) await db.body.delete(date)
    else await db.body.put(clean)
    toast('Saved')
    onClose()
  }

  return (
    <Sheet
      title="Weigh-in & measurements"
      onClose={onClose}
      footer={
        <div className="row">
          {existing && (
            <button
              className="btn danger"
              onClick={async () => {
                if (!confirm(`Delete everything logged for ${fmtDay(date)}?`)) return
                await db.body.delete(date)
                onClose()
              }}
            >
              Delete
            </button>
          )}
          <button className="btn primary lg grow" onClick={save}>
            Save
          </button>
        </div>
      }
    >
      <div className="stack">
        <Field label="Date">
          <input type="date" value={date} max={today()} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </Field>
        <div className="grid-2">
          <Field label="Weight">
            <UnitInput
              value={form.weightKg === undefined ? undefined : round(kgTo(form.weightKg, st.weightUnit), 1)}
              onChange={(v) => setForm((f) => ({ ...f, weightKg: v === undefined ? undefined : toKg(v, st.weightUnit) }))}
              unit={st.weightUnit}
              dp={1}
              autoFocus
            />
          </Field>
          <Field label="Body fat">
            <UnitInput value={form.bodyFat} onChange={(v) => setForm((f) => ({ ...f, bodyFat: v }))} unit="%" dp={1} />
          </Field>
        </div>
        <p className="field-label">Measurements (optional)</p>
        <div className="grid-3">
          {MEASURES.map(([k, label]) => (
            <Field key={k} label={label}>
              <UnitInput value={lenVal(form[k])} onChange={(v) => setLen(k, v)} unit={st.lengthUnit} dp={1} />
            </Field>
          ))}
        </div>
        <p className="small muted">Measure at the same spot each time, first thing in the morning.</p>
      </div>
    </Sheet>
  )
}

async function compressImage(file: File, maxDim = 1280): Promise<Blob> {
  let source: ImageBitmap | HTMLImageElement
  try {
    source = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    source = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = reject
      img.src = URL.createObjectURL(file)
    })
  }
  const scale = Math.min(1, maxDim / Math.max(source.width, source.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(source.width * scale)
  canvas.height = Math.round(source.height * scale)
  canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not read photo'))), 'image/jpeg', 0.82))
}

function usePhotoUrls(photos: Photo[] | undefined) {
  const urls = useMemo(() => new Map((photos ?? []).map((p) => [p.id, URL.createObjectURL(p.blob)])), [photos])
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls])
  return urls
}

const POSE_LABEL: Record<Pose, string> = { front: 'Front', side: 'Side', back: 'Back' }

function Photos() {
  const photos = useLiveQuery(() => db.photos.orderBy('date').reverse().toArray(), [])
  const urls = usePhotoUrls(photos)
  const [pose, setPose] = useState<Pose>('front')
  const [open, setOpen] = useState<Photo | null>(null)
  const [compare, setCompare] = useState<string>('')
  const input = useRef<HTMLInputElement>(null)

  const add = async (files: FileList | null) => {
    if (!files?.length) return
    for (const f of Array.from(files)) {
      try {
        const blob = await compressImage(f)
        await db.photos.put({ id: uid(), date: today(), pose, blob, createdAt: Date.now() })
      } catch {
        toast('Couldn’t read that photo')
      }
    }
    toast('Photo saved')
  }

  const other = photos?.find((p) => p.id === compare)

  return (
    <section className="stack">
      <div className="section-title" style={{ marginBottom: 0 }}>
        <h2>Progress photos</h2>
      </div>
      <div className="row">
        <div className="grow">
          <Segmented value={pose} onChange={setPose} options={(['front', 'side', 'back'] as Pose[]).map((p) => ({ value: p, label: POSE_LABEL[p] }))} label="Pose" />
        </div>
        <button className="btn soft" onClick={() => input.current?.click()}>
          <Icon name="camera" size={18} /> Add
        </button>
      </div>
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => void add(e.target.files).then(() => (e.target.value = ''))} />
      {photos && photos.length === 0 && <Empty icon="image">Photos show changes the scale can miss. They stay on this phone.</Empty>}
      {photos && photos.length > 0 && (
        <div className="photo-grid">
          {photos.map((p) => (
            <button key={p.id} onClick={() => setOpen(p)} aria-label={`${POSE_LABEL[p.pose]} photo, ${fmtShortDay(p.date)}`}>
              <img src={urls.get(p.id)} alt="" loading="lazy" />
              <span className="cap">
                {fmtShortDay(p.date)} · {POSE_LABEL[p.pose]}
              </span>
            </button>
          ))}
        </div>
      )}
      {open && (
        <Sheet title={`${POSE_LABEL[open.pose]} · ${fmtShortDay(open.date)}`} onClose={() => { setOpen(null); setCompare('') }} full>
          <div className="stack">
            <div className={other ? 'grid-2' : ''}>
              {other && (
                <figure style={{ margin: 0 }}>
                  <img src={urls.get(other.id)} alt="" style={{ width: '100%', borderRadius: 12 }} />
                  <figcaption className="small muted">{fmtShortDay(other.date)}</figcaption>
                </figure>
              )}
              <figure style={{ margin: 0 }}>
                <img src={urls.get(open.id)} alt="" style={{ width: '100%', borderRadius: 12 }} />
                {other && <figcaption className="small muted">{fmtShortDay(open.date)}</figcaption>}
              </figure>
            </div>
            {photos && photos.length > 1 && (
              <Field label="Compare with">
                <select value={compare} onChange={(e) => setCompare(e.target.value)}>
                  <option value="">—</option>
                  {photos.filter((p) => p.id !== open.id).map((p) => (
                    <option key={p.id} value={p.id}>
                      {fmtShortDay(p.date)} · {POSE_LABEL[p.pose]}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <button
              className="btn danger"
              onClick={async () => {
                if (!confirm('Delete this photo?')) return
                await db.photos.delete(open.id)
                setOpen(null)
              }}
            >
              Delete photo
            </button>
          </div>
        </Sheet>
      )}
    </section>
  )
}

export function BodySection() {
  const st = useSettings()
  const { body, trend } = useWeightTrend()
  const [range, setRange] = useState<Range>('3m')
  const [entry, setEntry] = useState<{ date?: string } | null>(null)
  const t = today()
  const from = addDays(t, -RANGE_DAYS[range])

  const w = (kg: number) => kgTo(kg, st.weightUnit)
  const inRange = trend.filter((p) => p.date >= from)
  const weighIns = (body ?? []).filter((b) => b.weightKg && b.date >= from)
  const trendNow = trendOn(trend, t)
  const change = inRange.length > 1 ? inRange[inRange.length - 1].trend - inRange[0].trend : undefined
  const rate = weeklyRate(trend)

  const measured = (body ?? []).filter((b) => MEASURES.some(([k]) => b[k] !== undefined) || b.bodyFat !== undefined)
  const latest = (k: keyof BodyEntry) => [...measured].reverse().find((b) => b[k] !== undefined)
  const first = (k: keyof BodyEntry) => measured.find((b) => b[k] !== undefined)

  return (
    <div className="stack">
      <div className="chips" role="tablist" aria-label="Time range">
        {(Object.keys(RANGE_DAYS) as Range[]).map((r) => (
          <button key={r} className={r === range ? 'chip on' : 'chip'} onClick={() => setRange(r)} aria-pressed={r === range}>
            {r === 'all' ? 'All' : r.toUpperCase()}
          </button>
        ))}
      </div>
      <div className="grid-3">
        <Stat tile label="Trend" value={trendNow !== undefined ? fmtNum(round(w(trendNow), 1), 1) : '–'} unit={st.weightUnit} />
        <Stat tile label="Change" value={change !== undefined ? `${change > 0 ? '+' : change < 0 ? '−' : ''}${fmtNum(Math.abs(round(w(change), 1)), 1)}` : '–'} unit={st.weightUnit} />
        <Stat tile label="Per week" value={rate !== undefined ? `${rate > 0 ? '+' : rate < 0 ? '−' : ''}${fmtNum(Math.abs(round(w(rate), 2)), 2)}` : '–'} unit={st.weightUnit} />
      </div>
      <div className="card stack">
        <div className="row">
          <h3 className="grow">Weight</h3>
          <button className="btn soft sm" onClick={() => setEntry({})}>
            <Icon name="plus" size={16} /> Log
          </button>
        </div>
        {inRange.length === 0 ? (
          <Empty icon="scale">Log your weight to see your trend. Morning weigh-ins work best.</Empty>
        ) : (
          <LineChart
            ariaLabel={`Weight trend, ${range}`}
            series={[
              { key: 'scale', label: 'Scale weight', color: 'var(--muted)', kind: 'dots', points: weighIns.map((b) => ({ x: parseDay(b.date).getTime(), y: w(b.weightKg!) })) },
              { key: 'trend', label: 'Trend', color: 'var(--s1)', kind: 'line', points: inRange.map((p) => ({ x: parseDay(p.date).getTime(), y: w(p.trend) })) },
            ]}
            xFormat={(x) => fmtShortDay(dayKey(x))}
            yFormat={(y) => fmtNum(round(y, 1), 1)}
          />
        )}
        <p className="small muted">The trend line smooths out water and food swings, so it shows your real direction.</p>
      </div>

      <div className="card stack">
        <div className="row">
          <h3 className="grow">Measurements</h3>
          <button className="btn soft sm" onClick={() => setEntry({})}>
            <Icon name="ruler" size={16} /> Log
          </button>
        </div>
        {measured.length === 0 ? (
          <p className="small muted">Waist, hips and arms show progress the scale can hide, especially while building muscle.</p>
        ) : (
          <div className="list">
            {[['bodyFat', 'Body fat'] as const, ...MEASURES].map(([k, label]) => {
              const l = latest(k)
              if (!l) return null
              const f = first(k)
              const diff = f && f.date !== l.date ? (l[k] as number) - (f[k] as number) : undefined
              const fmt = (v: number) => (k === 'bodyFat' ? `${fmtNum(v, 1)}%` : fmtLength(v, st.lengthUnit))
              return (
                <div key={k} className="list-row">
                  <span className="grow">{label}</span>
                  <span className="stack tight" style={{ alignItems: 'flex-end', gap: 0 }}>
                    <span className="bold tnum">{fmt(l[k] as number)}</span>
                    {diff !== undefined && (
                      <span className="tiny muted">
                        {diff > 0 ? '+' : diff < 0 ? '−' : ''}
                        {k === 'bodyFat' ? `${fmtNum(Math.abs(diff), 1)}%` : fmtLength(Math.abs(diff), st.lengthUnit)} since {fmtShortDay(f!.date)}
                      </span>
                    )}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {body && body.length > 0 && (
        <details className="card">
          <summary className="bold">All entries</summary>
          <div className="list" style={{ marginTop: 10 }}>
            {[...body].reverse().slice(0, 120).map((b) => (
              <button key={b.date} className="list-row" onClick={() => setEntry({ date: b.date })}>
                <span className="grow">{fmtDay(b.date)}</span>
                <span className="tnum">{b.weightKg ? fmtWeight(b.weightKg, st.weightUnit) : 'Measurements'}</span>
                <Icon name="right" className="chev" />
              </button>
            ))}
          </div>
        </details>
      )}

      <Photos />
      {entry && <BodyEntrySheet date={entry.date} onClose={() => setEntry(null)} />}
    </div>
  )
}
