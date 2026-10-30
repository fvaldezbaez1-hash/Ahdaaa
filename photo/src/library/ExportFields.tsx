import { useState } from 'react'
import type { ExportOptions } from '../io/types'
import { Field, Segmented, Toggle } from '../ui/controls'
import { Slider } from '../ui/Slider'
import { FORMATS, SIZE_CHOICES, sizeChoiceOf, type SizeChoice } from './exportMath'
import { formatDimensions } from './library'

const COLOR_SPACES: { value: ExportOptions['colorSpace']; label: string }[] = [
  { value: 'srgb', label: 'sRGB (recommended)' },
  { value: 'display-p3', label: 'Display P3' },
]

/** Export choices, shared by the export sheet and the export defaults in Settings. */
export function ExportFields({
  value,
  onChange,
  onCommit = onChange,
  fullSize,
}: {
  value: ExportOptions
  /** Every change, including each step of a quality drag. */
  onChange: (v: ExportOptions) => void
  /** Finished changes (slider released), for callers that persist. */
  onCommit?: (v: ExportOptions) => void
  /** Pixel size at full resolution, when exporting a single photo. */
  fullSize?: { width: number; height: number }
}) {
  const [custom, setCustom] = useState(() => sizeChoiceOf(value.longEdge) === 'custom')
  const choice: SizeChoice = custom ? 'custom' : sizeChoiceOf(value.longEdge)
  const set = (patch: Partial<ExportOptions>) => onCommit({ ...value, ...patch })

  return (
    <div className="stack">
      <div className="field">
        <span>Format</span>
        <Segmented label="Format" value={value.format} options={FORMATS.map((f) => ({ value: f.value, label: f.label }))} onChange={(format) => set({ format })} />
        {value.format === 'tiff16' && <small className="muted small">Uncompressed 16-bit for printing or further work in other apps. Large files.</small>}
        {value.format === 'png' && <small className="muted small">Lossless 8-bit. Larger than JPEG.</small>}
      </div>
      {value.format === 'jpeg' && (
        <Slider
          label="Quality"
          value={value.quality}
          min={10}
          max={100}
          defaultValue={92}
          format={(v) => String(Math.round(v))}
          onChange={(quality) => onChange({ ...value, quality })}
          onCommit={(quality) => onCommit({ ...value, quality })}
        />
      )}
      <Field label="Size">
        <select
          value={choice}
          onChange={(e) => {
            const c = e.target.value as SizeChoice
            setCustom(c === 'custom')
            if (c === 'full') set({ longEdge: undefined })
            else if (c === 'custom') set({ longEdge: value.longEdge ?? 3000 })
            else set({ longEdge: Number(c) })
          }}
        >
          {SIZE_CHOICES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.value === 'full' && fullSize ? `${s.label} (${formatDimensions(fullSize.width, fullSize.height)})` : s.label}
            </option>
          ))}
        </select>
      </Field>
      {choice === 'custom' && (
        <Field label="Long edge in pixels">
          <input
            type="number"
            inputMode="numeric"
            min={64}
            max={20000}
            step={1}
            value={value.longEdge ?? ''}
            onChange={(e) => {
              const n = Math.round(Number(e.target.value))
              if (Number.isFinite(n) && n > 0) set({ longEdge: Math.min(20000, n) })
            }}
          />
        </Field>
      )}
      <div className="field">
        <span>Color space</span>
        <Segmented label="Color space" value={value.colorSpace} options={COLOR_SPACES} onChange={(colorSpace) => set({ colorSpace })} />
        <small className="muted small">
          {value.colorSpace === 'srgb' ? 'Looks right on every screen and website.' : 'Richer reds and greens on modern phones and Macs; may look duller in older apps.'}
        </small>
      </div>
      <div className="setting-row">
        <span className="lbl">
          <b>Keep camera info</b>
          <small>Capture date, camera, lens and exposure</small>
        </span>
        <Toggle label="Keep camera info" checked={value.keepMetadata} onChange={(keepMetadata) => set({ keepMetadata })} />
      </div>
      {value.keepMetadata && (
        <div className="setting-row">
          <span className="lbl">
            <b>Remove location</b>
            <small>Leave out where the photo was taken</small>
          </span>
          <Toggle label="Remove location" checked={value.stripLocation} onChange={(stripLocation) => set({ stripLocation })} />
        </div>
      )}
    </div>
  )
}
