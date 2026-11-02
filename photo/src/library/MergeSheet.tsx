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
  const [picked, setKind] = useState<MergeKind | null>(null)
  const [options, setOptions] = useState<MergeOptions | null>(null)
  /** The latest preview request, by key: its progress, then its plan or error. */
  const [planned, setPlanned] = useState<{ key: string; progress?: Progress; plan?: MergePlan; error?: string } | null>(null)
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

  // HDR or panorama: what the person picked, else what the photos look like.
  const kind = picked ?? (mod && photos?.length ? mod.suggestKind(photos) : null)
  const opts = options ?? mod?.DEFAULT_MERGE_OPTIONS ?? null
  const why = mod && photos && kind ? mod.cantMerge(photos, kind) : null
  // Everything the preview depends on; a new key replans (and cancels the previous plan).
  const key = mod && photos?.length && kind && opts && !why ? JSON.stringify({ ids: photos.map((p) => p.id), kind, opts }) : ''

  useEffect(() => {
    if (!mod || !key) return
    const req = JSON.parse(key) as { ids: string[]; kind: MergeKind; opts: MergeOptions }
    const ac = new AbortController()
    const onProgress = (fraction: number, stage: string) => !ac.signal.aborted && setPlanned({ key, progress: { fraction, stage } })
    mod.planMerge(req.ids, req.kind, req.opts, { signal: ac.signal, onProgress }).then(
      (plan) => !ac.signal.aborted && setPlanned({ key, plan }),
      (e) => !ac.signal.aborted && !isAbort(e) && setPlanned({ key, error: errorMessage(e) }),
    )
    return () => ac.abort()
  }, [mod, key])

  const current = key && planned?.key === key ? planned : null
  const plan = current?.plan ?? null
  const planning = key && !current?.plan && !current?.error ? (current?.progress ?? { fraction: 0, stage: 'Reading the photos…' }) : null
  const problem = why ?? current?.error

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

  const set = (patch: Partial<MergeOptions>) => opts && setOptions({ ...opts, ...patch })
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
      {!mod || !photos || !kind || !opts ? (
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
            {plan && <PreviewCanvas plan={plan} />}
            {planning && (
              <div className="merge-preview-status">
                <Spinner label={planning.stage} />
                <span className="small">{planning.stage}</span>
              </div>
            )}
            {problem && !planning && <p className="merge-error">{problem}</p>}
          </div>

          {error && <p className="merge-error">{error}</p>}

          {plan && (
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
              <Segmented<Deghost> label="Deghost" value={opts.deghost} onChange={(v) => !busy && set({ deghost: v })} options={DEGHOST} />
            </div>
          ) : (
            <>
              <div className="setting-row merge-wrap">
                <div className="lbl">
                  <b>Projection</b>
                </div>
                <Segmented<Projection | 'auto'> label="Projection" value={opts.projection} onChange={(v) => !busy && set({ projection: v })} options={PROJECTIONS} />
              </div>
              <div className="setting-row">
                <div className="lbl">
                  <b>Auto crop</b>
                  <small>Crops away the empty edges</small>
                </div>
                <Toggle label="Auto crop" checked={opts.autoCrop} onChange={(v) => !busy && set({ autoCrop: v })} />
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
