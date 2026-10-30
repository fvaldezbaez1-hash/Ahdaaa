import { useState, type ReactNode } from 'react'
import { AssistantPanel } from '../../assistant/AssistantPanel'
import { PresetsPanel } from '../../presets/PresetsPanel'
import { goBack } from '../../router'
import { editor, useEditor } from '../../state/editor'
import { Icon, type IconName } from '../../ui/Icon'
import { toast } from '../../ui/toast'
import { enterCrop, finishCrop } from '../crop/cropTool'
import { CropActions, CropPanel } from '../crop/CropPanel'
import { HealPanel } from '../masks/HealPanel'
import { ToolIcon } from '../masks/icons'
import { MasksPanel } from '../masks/MasksPanel'
import { enterHeal, enterMasks, exitTool } from '../masks/modes'
import { applyAuto } from '../panels/actions'
import { ColorGrading } from '../panels/ColorGrading'
import { ColorMixer } from '../panels/ColorMixer'
import { resetParts, usePartChanged, type PartId } from '../panels/parts'
import { cameraLine, exposureLine } from '../panels/photoInfo'
import { ProfileRow } from '../panels/ProfileRow'
import { DetailSliders, EffectsSliders, LightSliders, PresenceSliders } from '../panels/SliderGroups'
import { ToneCurve } from '../panels/ToneCurve'
import { WhiteBalance } from '../panels/WhiteBalance'
import { useSession } from '../session'
import { Stage } from '../stage/Stage'
import { useView, view } from '../view'

type ToolId = 'presets' | 'light' | 'color' | 'effects' | 'detail' | 'curve' | 'grading' | 'masks' | 'heal' | 'crop'

interface Tool {
  id: ToolId
  label: string
  icon: IconName | 'heal'
  title: string
  hint?: string
  parts?: PartId[]
  body: () => ReactNode
}

const TOOLS: Tool[] = [
  { id: 'presets', label: 'Presets', icon: 'presets', title: 'Presets', hint: 'Tap a look, then set the amount', body: () => <PresetsPanel layout="strip" /> },
  { id: 'light', label: 'Light', icon: 'light', title: 'Light', hint: 'Double-tap a slider to reset', parts: ['light'], body: () => <LightSliders /> },
  {
    id: 'color',
    label: 'Color',
    icon: 'palette',
    title: 'Color',
    hint: 'White balance and color',
    parts: ['wb', 'vibrance', 'mixer'],
    body: () => (
      <>
        <ProfileRow />
        <h3 className="ed-subhead">White balance</h3>
        <WhiteBalance />
        <PresenceSliders local={false} />
        <h3 className="ed-subhead">Color mixer</h3>
        <ColorMixer />
      </>
    ),
  },
  {
    id: 'effects',
    label: 'Effects',
    icon: 'effects',
    title: 'Effects',
    hint: 'Texture, depth and finish',
    parts: ['texture', 'effects'],
    body: () => (
      <>
        <PresenceSliders color={false} />
        <EffectsSliders />
      </>
    ),
  },
  { id: 'detail', label: 'Detail', icon: 'detail', title: 'Detail', hint: 'Sharpening and noise', parts: ['detail'], body: () => <DetailSliders /> },
  { id: 'curve', label: 'Curve', icon: 'curve', title: 'Tone curve', hint: 'Tap to add a point, drag off to remove', parts: ['curve'], body: () => <ToneCurve /> },
  { id: 'grading', label: 'Grading', icon: 'grading', title: 'Color grading', hint: 'Drag the wheel to tint', parts: ['grading'], body: () => <ColorGrading layout="single" /> },
  { id: 'masks', label: 'Masks', icon: 'mask', title: 'Masks', hint: 'Adjust part of the photo', body: () => <MasksPanel layout="strip" /> },
  { id: 'heal', label: 'Heal', icon: 'heal', title: 'Heal & clone', body: () => <HealPanel layout="strip" /> },
  { id: 'crop', label: 'Crop', icon: 'crop', title: 'Crop & straighten', body: () => <CropPanel layout="strip" /> },
]

function PanelReset({ parts, title }: { parts: PartId[]; title: string }) {
  const changed = usePartChanged(parts)
  if (!changed) return null
  return (
    <button type="button" className="btn ghost sm" onClick={() => resetParts(parts, `Reset ${title}`)}>
      Reset
    </button>
  )
}

/** Phone layout: top bar, photo, the active tool's panel and a scrolling tool bar. */
export function PhoneEditor() {
  const { record, engine } = useSession()
  const [toolId, setToolId] = useState<ToolId>('light')
  const canUndo = useEditor((s) => s.canUndo)
  const canRedo = useEditor((s) => s.canRedo)
  const cropping = useView((s) => s.tool === 'crop')
  const ai = useView((s) => s.ai)
  const tool = TOOLS.find((t) => t.id === toolId)!
  const subtitle = [cameraLine(record.meta).split(' · ')[0], exposureLine(record.meta)].filter(Boolean).join(' · ')

  const pick = (id: ToolId) => {
    if (cropping && id !== 'crop') finishCrop()
    if (id === 'crop' && !cropping) enterCrop({ w: record.width, h: record.height })
    if (id === 'masks') enterMasks()
    else if (id === 'heal') enterHeal()
    else if (id !== 'crop') exitTool()
    setToolId(id)
  }
  const auto = () => {
    if (applyAuto(engine)) toast('Auto applied · tweak anything you like')
    else toast('This photo already looks balanced')
    pick('light')
  }

  return (
    <div className="ed-phone">
      <header className="ed-phone-top">
        <button type="button" className="icon-btn lg" onClick={() => goBack('/')} aria-label="Back to library">
          <Icon name="left" size={22} />
        </button>
        <div className="ed-phone-title">
          <div className="ellipsis bold">{record.fileName}</div>
          {subtitle && <div className="ellipsis muted small">{subtitle}</div>}
        </div>
        <button type="button" className="icon-btn lg" disabled={!canUndo || cropping} onClick={editor.undo} aria-label="Undo">
          <Icon name="undo" size={20} />
        </button>
        <button type="button" className="icon-btn lg" disabled={!canRedo || cropping} onClick={editor.redo} aria-label="Redo">
          <Icon name="redo" size={20} />
        </button>
        <button type="button" className="ed-export-pill" onClick={() => view.set({ sheet: 'export' })}>
          <span>Export</span>
        </button>
      </header>

      <Stage pad={10} />

      <section className="ed-phone-panel" aria-labelledby="ed-panel-title">
        <div className="ed-phone-panel-head">
          <h2 id="ed-panel-title">{tool.title}</h2>
          {cropping ? <CropActions /> : tool.parts ? <PanelReset parts={tool.parts} title={tool.title} /> : null}
          {!cropping && tool.hint && !tool.parts && <span className="muted small">{tool.hint}</span>}
        </div>
        <div className={tool.id === 'presets' ? 'ed-phone-panel-body flush' : 'ed-phone-panel-body scroll'}>
          {tool.parts && tool.hint && <p className="muted small ed-phone-hint">{tool.hint}</p>}
          {tool.body()}
        </div>
      </section>

      <nav className="ed-phone-tools no-scrollbar" aria-label="Tools">
        {TOOLS.slice(0, 1).map((t) => (
          <ToolButton key={t.id} tool={t} on={toolId === t.id} onClick={() => pick(t.id)} />
        ))}
        <button type="button" className="ed-tool" onClick={auto}>
          <Icon name="wand" size={24} />
          Auto
        </button>
        {TOOLS.slice(1).map((t) => (
          <ToolButton key={t.id} tool={t} on={toolId === t.id} onClick={() => pick(t.id)} />
        ))}
        <button type="button" className="ed-tool ai" onClick={() => view.set({ ai: true })}>
          <Icon name="sparkle" size={24} />
          Ask AI
        </button>
      </nav>

      {ai && (
        <div className="ed-phone-ai" role="dialog" aria-modal="true" aria-label="AI assistant">
          <AssistantPanel onClose={() => view.set({ ai: false })} />
        </div>
      )}
    </div>
  )
}

function ToolButton({ tool, on, onClick }: { tool: Tool; on: boolean; onClick: () => void }) {
  return (
    <button type="button" className={on ? 'ed-tool on' : 'ed-tool'} aria-pressed={on} onClick={onClick}>
      {tool.icon === 'heal' ? <ToolIcon name="heal" size={24} /> : <Icon name={tool.icon} size={24} />}
      {tool.label}
    </button>
  )
}
