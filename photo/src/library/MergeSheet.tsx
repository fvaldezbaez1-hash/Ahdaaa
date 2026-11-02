// Merge the selected photos into an HDR photo or a panorama (src/merge). A quick
// low-resolution preview first, then the full-resolution merge, whose result
// lands in the library next to its sources and opens in the editor.
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { isAbort } from '../io/abort'
import { db } from '../io/db'
import type { PhotoRecord } from '../io/types'
import type { Deghost, MergeKind, MergeOptions, MergePlan, Projection } from '../merge'
import { navigate } from '../router'
import { Icon } from '../ui/Icon'
import { PhotoThumb } from '../ui/PhotoThumb'
import { Sheet } from '../ui/Sheet'
import { Segmented, Spinner, Toggle } from '../ui/controls'
import { toast } from '../ui/toast'
import { errorMessage } from './actions'
import { formatDimensions, plural } from './library'
import './MergeSheet.css'
import './sheets.css'

type MergeModule = typeof import('../merge')
type Progress = { fraction: number; stage: string }

const DEGHOST: { value: Deghost; label: string; title: string }[] = [
  { value: 'off', label: 'Off', title: 'Nothing moved between the brackets' },
  { value: 'low', label: 'Low', title: 'Leaves, water, small movements' },
  { value: 'medium', label: 'Medium', title: 'People walking, cars' },
  { value: 'high', label: 'High', title: 'Large moving subjects' },
]
const PROJECTIONS: { value: Projection | 'auto'; label: string; title: string }[] = [
  { value: 'auto', label: 'Auto', title: 'Chosen from the field of view' },
  { value: 'perspective', label: 'Perspective', title: 'Straight lines stay straight; for narrow panoramas' },
  { value: 'cylindrical', label: 'Cylindrical', title: 'Wide horizontal panoramas' },
  { value: 'spherical', label: 'Spherical', title: 'Very wide or multi-row panoramas' },
]
const PROJECTION_NAME: Record<Projection, string> = { perspective: 'perspective', cylindrical: 'cylindrical', spherical: 'spherical' }

export function MergeSheet({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const photos = useLiveQuery(() => db.photos.bulkGet(ids).then((ps) => ps.filter((p): p is PhotoRecord => !!p)), [ids.join('\n')])
  const [mod, setMod] = useState<MergeModule | null>(null)
  const [kind, setKind] = useState<MergeKind | null>(null)
  const [options, setOptions] = useState<MergeOptions | null>(null)
  const [plan, setPlan] = useState<MergePlan | null>(null)
  const [planning, setPlanning] = useState<Progress | null>(null)
  const [running, setRunning] = useState<Progress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const runAbort = useRef<AbortController | null>(null)

  useEffect(() => {
    let live = true
    import('../merge').then(
      (m) => live && setMod(m),
      (e) => live && setError(errorMessage(e)),
    )
    return () => {
      live = false
      runAbort.current?.abort()
    }
  }, [])

  // Suggest HDR or panorama once the photos and the merge code are in.
  useEffect(() => {
    if (!mod || !photos || kind) return
    setKind(mod.suggestKind(photos))
    setOptions({ ...mod.DEFAULT_MERGE_OPTIONS })
  }, [mod, photos, kind])

  const why = mod && photos && kind ? mod.cantMerge(photos, kind) : null
  // Only the options of the chosen kind change its preview.
  const planKey = !options || !kind ? '' : kind === 'hdr' ? `hdr ${options.deghost}` : `pano ${options.projection} ${options.autoCrop}`

  useEffect(() => {
    if (!mod || !kind || !options || !photos?.length || why) return
    const ac = new AbortController()
    setPlan(null)
    setError(null)
    setPlanning({ fraction: 0, stage: 'Reading the photos…' })
    mod
      .planMerge(
        photos.map((p) => p.id),
        kind,
        options,
        { signal: ac.signal, onProgress: (fraction, stage) => !ac.signal.aborted && setPlanning({ fraction, stage }) },
      )
      .then(
        (p) => {
          if (ac.signal.aborted) return
          setPlan(p)
          setPlanning(null)
        },
        (e) => {
          if (ac.signal.aborted || isAbort(e)) return
          setError(errorMessage(e))
          setPlanning(null)
        },
      )
    return () => ac.abort()
    // planKey stands for the options that matter, and photos for their ids (the live query re-emits).
  }, [mod, planKey, photos?.map((p) => p.id).join('\n'), why])

  const merge = () => {
    if (!mod || !plan) return
    const ac = new AbortController()
    runAbort.current = ac
    setError(null)
    setRunning({ fraction: 0, stage: 'Starting…' })
    mod.runMerge(plan, { signal: ac.signal, onProgress: (fraction, stage) => !ac.signal.aborted && setRunning({ fraction, stage }) }).then(
      (id) => {
        runAbort.current = null
        toast(plan.kind === 'hdr' ? 'HDR photo added to the library' : 'Panorama added to the library')
        onClose()
        navigate(`/edit/${encodeURIComponent(id)}`)
      },
      (e) => {
        runAbort.current = null
        setRunning(null)
        if (!isAbort(e)) setError(errorMessage(e))
      },
    )
  }

  const close = () => {
    runAbort.current?.abort()
    onClose()
  }

  const set = (patch: Partial<MergeOptions>) => setOptions((o) => (o ? { ...o, ...patch } : o))
  const busy = !!running

  let footer: React.ReactNode
  if (running) {
    const pct = Math.round(running.fraction * 100)
    footer = (
      <div className="stack tight" aria-live="polite">
        <div className="row between">
          <b>{running.stage}</b>
          <span className="muted tnum">{pct}%</span>
        </div>
        <div className="progress" role="progressbar" aria-label="Merge progress" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <i style={{ width: `${pct}%` }} />
        </div>
        <div className="lib-foot">
          <button type="button" className="btn outline" onClick={() => runAbort.current?.abort()}>
            Cancel
          </button>
        </div>
      </div>
    )
  } else {
    footer = (
      <div className="lib-foot">
        <span className="grow tnum">{plan ? `${formatDimensions(plan.output.width, plan.output.height)} · ${((plan.output.width * plan.output.height) / 1e6).toFixed(1)} MP DNG` : ''}</span>
        <button type="button" className="btn ghost" onClick={close}>
          Cancel
        </button>
        <button type="button" className="btn primary" disabled={!plan || !!planning} onClick={merge}>
          <Icon name="check" size={16} />
          {kind === 'hdr' ? 'Merge HDR' : 'Merge panorama'}
        </button>
      </div>
    )
  }

  return (
    <Sheet title={kind === 'pano' ? 'Panorama' : kind === 'hdr' ? 'HDR merge' : 'Merge'} onClose={close} footer={footer} wide>
      {!mod || !photos || !kind || !options ? (
        error ? <p className="merge-error">{error}</p> : <Spinner />
      ) : (
        <div className="stack loose merge-sheet">
          <div className="merge-sources" aria-label={plural(photos.length, 'photo')}>
            {photos.slice(0, 9).map((p) => (
              <div key={p.id} className="merge-thumb">
                <PhotoThumb id={p.id} />
              </div>
            ))}
            {photos.length > 9 && <span className="muted small">+{photos.length - 9}</span>}
          </div>

          <Segmented<MergeKind>
            label="Merge as"
            value={kind}
            onChange={(k) => !busy && setKind(k)}
            options={[
              { value: 'hdr', label: 'HDR', title: 'Combine exposure brackets into one photo with more dynamic range' },
              { value: 'pano', label: 'Panorama', title: 'Stitch overlapping photos into a wider view' },
            ]}
          />

          <div className="merge-preview" aria-busy={!!planning}>
            {plan && !why && <PreviewCanvas plan={plan} />}
            {planning && (
              <div className="merge-preview-status">
                <Spinner label={planning.stage} />
                <span className="small">{planning.stage}</span>
              </div>
            )}
            {(why || (error && !planning)) && <p className="merge-error">{why ?? error}</p>}
          </div>

          {plan && !planning && !why && (
            <div className="merge-facts muted small">
              {plan.kind === 'hdr' && plan.stops !== undefined && <span>About {plan.stops.toFixed(1)} stops of dynamic range</span>}
              {plan.kind === 'pano' && plan.span && (
                <span>
                  {Math.round(plan.span[0])}° × {Math.round(plan.span[1])}° view{plan.projection ? `, ${PROJECTION_NAME[plan.projection]}` : ''}
                </span>
              )}
              {plan.notes.map((n) => (
                <span key={n}>{n}</span>
              ))}
            </div>
          )}

          {kind === 'hdr' ? (
            <div className="setting-row">
              <div className="lbl">
                <b>Deghost</b>
                <small>Removes things that moved between brackets</small>
              </div>
              <Segmented<Deghost> label="Deghost" value={options.deghost} onChange={(v) => !busy && set({ deghost: v })} options={DEGHOST} />
            </div>
          ) : (
            <>
              <div className="setting-row merge-wrap">
                <div className="lbl">
                  <b>Projection</b>
                </div>
                <Segmented<Projection | 'auto'> label="Projection" value={options.projection} onChange={(v) => !busy && set({ projection: v })} options={PROJECTIONS} />
              </div>
              <div className="setting-row">
                <div className="lbl">
                  <b>Auto crop</b>
                  <small>Crops away the empty edges</small>
                </div>
                <Toggle label="Auto crop" checked={options.autoCrop} onChange={(v) => !busy && set({ autoCrop: v })} />
              </div>
            </>
          )}
          <p className="muted small">The merged photo is saved as a DNG next to these photos; they stay as they are.</p>
        </div>
      )}
    </Sheet>
  )
}

function PreviewCanvas({ plan }: { plan: MergePlan }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    const { data, width, height } = plan.preview
    c.width = width
    c.height = height
    ctx.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0)
  }, [plan])
  return <canvas ref={ref} role="img" aria-label={plan.kind === 'hdr' ? 'HDR preview' : 'Panorama preview'} />
}
