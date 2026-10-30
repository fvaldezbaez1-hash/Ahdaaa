import type { ViewMode } from '../../engine/types'
import { goBack } from '../../router'
import { editor, useEditor } from '../../state/editor'
import { Segmented } from '../../ui/controls'
import { Icon } from '../../ui/Icon'
import { toast } from '../../ui/toast'
import { enterCrop, finishCrop, rotateQuick } from '../crop/cropTool'
import { ToolIcon } from '../masks/icons'
import { enterHeal, enterMasks, exitTool } from '../masks/modes'
import { applyAuto } from '../panels/actions'
import type { StripItem } from '../photos'
import { useSession } from '../session'
import { stageControl } from '../stage/stageView'
import { useLeftPanel, useView, view } from '../view'

const MODES: { value: ViewMode; label: string; title: string }[] = [
  { value: 'after', label: 'After', title: 'Your edit' },
  { value: 'split', label: 'Split', title: 'Before | after (Y)' },
  { value: 'before', label: 'Before', title: 'The original (\\)' },
]

function ZoomButton() {
  const zoom = useView((s) => s.zoom)
  const zoom100 = useView((s) => s.zoom100)
  const cropping = useView((s) => s.tool === 'crop')
  const text = zoom === 1 ? 'Fit' : `${Math.round((zoom / zoom100) * 100)}%`
  return (
    <button
      type="button"
      className="btn ghost sm tnum ed-zoom"
      disabled={cropping}
      onClick={stageControl.toggleZoom}
      title={zoom === 1 ? 'Zoom to 100% (Z) · Ctrl+scroll or pinch to zoom' : 'Fit the photo (Z)'}
      aria-label={`Zoom: ${text}. ${zoom === 1 ? 'Zoom to 100%' : 'Fit'}`}
    >
      {text}
    </button>
  )
}

export function Toolbar({ order }: { order: StripItem[] | undefined }) {
  const { id, record, engine } = useSession()
  const canUndo = useEditor((s) => s.canUndo)
  const canRedo = useEditor((s) => s.canRedo)
  const mode = useView((s) => s.mode)
  const tool = useView((s) => s.tool)
  const cropping = tool === 'crop'
  const ai = useView((s) => s.ai)
  const [leftPanel, toggleLeft] = useLeftPanel()
  const index = order?.findIndex((p) => p.id === id) ?? -1

  return (
    <div className="ed-toolbar" role="toolbar" aria-label="Editor">
      <div className="ed-tb-group ed-tb-file">
        <button type="button" className="icon-btn" onClick={() => goBack('/')} aria-label="Back to library" title="Back to library">
          <Icon name="left" />
        </button>
        <button
          type="button"
          className={leftPanel ? 'icon-btn on' : 'icon-btn'}
          aria-pressed={leftPanel}
          onClick={toggleLeft}
          aria-label="Presets and history"
          title="Presets and history"
        >
          <Icon name="presets" />
        </button>
        <div className="ed-tb-name">
          <span className="ellipsis">{record.fileName}</span>
          {index >= 0 && order && <span className="muted tnum ed-tb-count">{`${index + 1} of ${order.length}`}</span>}
        </div>
      </div>
      <div className="ed-tb-group">
        <button type="button" className="icon-btn" disabled={!canUndo || cropping} onClick={editor.undo} aria-label="Undo" title="Undo (⌘Z)">
          <Icon name="undo" />
        </button>
        <button type="button" className="icon-btn" disabled={!canRedo || cropping} onClick={editor.redo} aria-label="Redo" title="Redo (⇧⌘Z)">
          <Icon name="redo" />
        </button>
      </div>
      <div className="ed-tb-group ed-tb-center">
        <Segmented label="Compare" value={mode} onChange={(m) => view.set({ mode: m })} options={MODES} />
        <span className="muted small ed-tb-hint">Hold the photo to see the original</span>
      </div>
      <div className="ed-tb-group ed-tb-end">
        <ZoomButton />
        <button
          type="button"
          className={cropping ? 'icon-btn on' : 'icon-btn'}
          aria-pressed={cropping}
          onClick={() => (cropping ? finishCrop() : enterCrop({ w: record.width, h: record.height }))}
          aria-label="Crop and straighten"
          title="Crop & straighten (C)"
        >
          <Icon name="crop" />
        </button>
        <button
          type="button"
          className={tool === 'mask' ? 'icon-btn on' : 'icon-btn'}
          aria-pressed={tool === 'mask'}
          onClick={() => (tool === 'mask' ? exitTool() : enterMasks())}
          aria-label="Masks"
          title="Masks: adjust part of the photo (M)"
        >
          <Icon name="mask" />
        </button>
        <button
          type="button"
          className={tool === 'heal' ? 'icon-btn on' : 'icon-btn'}
          aria-pressed={tool === 'heal'}
          onClick={() => (tool === 'heal' ? exitTool() : enterHeal())}
          aria-label="Heal and clone"
          title="Heal & clone (Q)"
        >
          <ToolIcon name="heal" />
        </button>
        <button type="button" className="icon-btn ed-tb-rotate" disabled={cropping} onClick={() => rotateQuick(-1)} aria-label="Rotate left 90°" title="Rotate left 90° ([)">
          <Icon name="rotate" />
        </button>
        <button type="button" className="btn outline sm" disabled={cropping} onClick={() => applyAuto(engine) || toast('This photo already looks balanced')} title="Auto tone">
          <Icon name="wand" size={15} />
          Auto
        </button>
        <span className="ed-tb-sep" aria-hidden="true" />
        <button type="button" className={ai ? 'btn outline sm on' : 'btn outline sm'} aria-pressed={ai} onClick={() => view.set({ ai: !ai })}>
          <Icon name="sparkle" size={15} className="accent" />
          Ask AI
        </button>
        <button type="button" className="btn primary sm" onClick={() => view.set({ sheet: 'export' })}>
          <Icon name="share" size={15} />
          Export
        </button>
      </div>
    </div>
  )
}
