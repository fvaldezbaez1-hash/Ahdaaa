import { useState } from 'react'
import { editor, useEditor } from '../../state/editor'
import { Icon } from '../../ui/Icon'
import { useSession } from '../session'
import { useView } from '../view'
import { KindChooser } from './KindChooser'
import { LayerList } from './LayerList'
import { LocalSliders } from './LocalSliders'
import { LayerOptions, MaskList } from './MaskSettings'
import { isAdjusted, updateLayer } from './model'
import { createLayer, enterMasks, exitTool } from './modes'

function NewMask({ open: initial = false }: { open?: boolean }) {
  const { record } = useSession()
  const [open, setOpen] = useState(initial)
  if (!open)
    return (
      <button type="button" className="btn outline sm ed-new-mask" onClick={() => setOpen(true)}>
        <Icon name="plus" size={15} />
        New mask
      </button>
    )
  return (
    <div className="ed-adding">
      <div className="row between">
        <span className="bold">New mask</span>
        <button type="button" className="btn ghost sm" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <KindChooser
        label="New mask"
        onPick={(k) => {
          setOpen(false)
          createLayer(k, { width: record.width, height: record.height })
        }}
      />
    </div>
  )
}

function ResetAdjust({ layerId }: { layerId: string }) {
  const layer = useEditor((s) => s.recipe?.layers.find((l) => l.id === layerId))
  if (!layer || !isAdjusted(layer.adjust)) return null
  return (
    <button type="button" className="btn ghost sm" onClick={() => editor.apply((r) => updateLayer(r, layerId, (l) => ({ ...l, adjust: {} })), `${layer.name}: Reset adjustments`)}>
      Reset
    </button>
  )
}

/**
 * Local adjustments: the mask layers, the selected layer's masks and their
 * settings, and what the layer changes. `side` = desktop column (with a
 * header), `strip` = phone tool panel.
 */
export function MasksPanel({ layout }: { layout: 'side' | 'strip' }) {
  const layerId = useView((s) => s.layer)
  const count = useEditor((s) => s.recipe?.layers.length ?? 0)
  const exists = useEditor((s) => !!s.recipe?.layers.some((l) => l.id === layerId))
  return (
    <div className={`ed-masks-panel ${layout}`}>
      {layout === 'side' && (
        <div className="row between">
          <h2>Masks</h2>
          <button type="button" className="btn primary sm" onClick={exitTool}>
            Done
          </button>
        </div>
      )}
      {count === 0 && <p className="muted small">Masks apply adjustments to part of the photo. Choose how to select it:</p>}
      <LayerList />
      <NewMask key={count} open={count === 0} />
      {exists && layerId ? (
        <>
          <section className="ed-mask-block" aria-label="Mask">
            <MaskList layerId={layerId} />
          </section>
          <section className="ed-mask-block" aria-label="Layer">
            <LayerOptions layerId={layerId} />
          </section>
          <section className="ed-mask-block" aria-label="Adjustments">
            <div className="row between">
              <h3 className="ed-block-title">Adjustments</h3>
              <ResetAdjust layerId={layerId} />
            </div>
            <LocalSliders layerId={layerId} />
          </section>
        </>
      ) : (
        count > 0 && <p className="muted small">Select a mask to edit it.</p>
      )}
    </div>
  )
}

/** Desktop, outside the masking tool: the photo's masks at a glance and a way in. */
export function MasksSummary() {
  const layers = useEditor((s) => s.recipe?.layers)
  return (
    <section className="ed-masks" aria-labelledby="ed-masks-title">
      <div className="row between">
        <h2 id="ed-masks-title">Masks</h2>
        <button type="button" className="btn ghost sm" onClick={() => enterMasks()} title="Masks (M)">
          {layers?.length ? 'Edit' : 'Add'}
        </button>
      </div>
      {layers?.length ? (
        <ul className="ed-mask-summary">
          {layers.map((l) => (
            <li key={l.id}>
              <button type="button" onClick={() => enterMasks(l.id)} className={l.enabled ? undefined : 'off'}>
                <span className="ellipsis">{l.name}</span>
                <span className="muted small">{l.masks.length > 1 ? `${l.masks.length} masks` : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">Brighten a face, darken the sky or warm one corner: brush, gradient and range masks apply adjustments to part of the photo.</p>
      )}
    </section>
  )
}
