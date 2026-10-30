import { editor, useEditor } from '../../state/editor'
import { useIsPhone } from '../../ui/hooks'
import { Icon } from '../../ui/Icon'
import { Slider } from '../../ui/Slider'
import { useSession } from '../session'
import { DENOISE_DEFAULT, removeDenoise, runDenoise } from './actions'
import { AiJobCard } from './AiJobCard'
import { estimate, useAiJob, useAiSupport } from './jobs'
import { useMissingRasters } from './rasterSync'
import { needsCompute } from './refs'

/** AI Denoise in the Detail panel: run it once on the full photo, then blend by Amount. */
export function AiDenoise() {
  const session = useSession()
  const dn = useEditor((s) => s.recipe?.denoise)
  const missing = useMissingRasters()
  const support = useAiSupport()
  const job = useAiJob()
  const phone = useIsPhone()
  const busy = !!job && job.phase !== 'error'
  const mp = (session.record.width * session.record.height) / 1e6
  const time = estimate(support, 'denoise', mp)

  if (!dn)
    return (
      <div className="ed-denoise">
        <AiJobCard scope="denoise" />
        {job?.scope !== 'denoise' && (
          <>
            <button type="button" className="btn outline sm ed-denoise-btn" disabled={busy || !support?.available} onClick={() => void runDenoise(session)}>
              <Icon name="sparkle" size={15} className="accent" />
              AI Denoise
            </button>
            <p className="muted small">
              {support && !support.available
                ? (support.reason ?? 'On-device AI isn’t available on this device.')
                : `Cleans up noise with an on-device model, on the full ${Math.round(mp)} MP photo${time ? `: ${time} on this device` : ''}.${phone ? ' Slow on phones; keep Lumen open while it works.' : ''}`}
            </p>
          </>
        )}
      </div>
    )

  const stale = needsCompute(dn.raster, missing)
  return (
    <div className="ed-denoise">
      <AiJobCard scope="denoise" />
      <Slider
        label="AI Denoise"
        value={dn.amount}
        min={0}
        max={100}
        step={1}
        defaultValue={DENOISE_DEFAULT}
        signed={false}
        onChange={(v) => editor.preview((r) => (r.denoise ? { ...r, denoise: { ...r.denoise, amount: v } } : r))}
        onCommit={(v) => editor.commit(`AI Denoise ${Math.round(v)}`)}
      />
      {stale && job?.scope !== 'denoise' && (
        <div className="ed-ai-card">
          <p className="small">The denoised copy isn’t on this device (restored from a backup?).</p>
          <button type="button" className="btn outline sm" disabled={busy} onClick={() => void runDenoise(session)}>
            Recompute
          </button>
        </div>
      )}
      <button type="button" className="btn ghost sm ed-denoise-remove" onClick={removeDenoise}>
        Remove AI Denoise
      </button>
    </div>
  )
}
