import { AssistantPanel } from '../../assistant/AssistantPanel'
import { PresetsPanel } from '../../presets/PresetsPanel'
import type { StripItem } from '../photos'
import { Stage } from '../stage/Stage'
import { useLeftPanel, useView, view } from '../view'
import { Adjustments } from './Adjustments'
import { Filmstrip } from './Filmstrip'
import { History } from './History'
import { Toolbar } from './Toolbar'

/** Desktop & tablet layout: presets | photo + filmstrip | adjustments (or the AI assistant). */
export function DesktopEditor({ order, id }: { order: StripItem[] | undefined; id: string }) {
  const ai = useView((s) => s.ai)
  const left = useLeftPanel()[0]
  const cls = ['ed-desk-body', !left && 'no-left', ai && 'with-ai'].filter(Boolean).join(' ')
  return (
    <div className="ed-desk">
      <Toolbar order={order} />
      <div className={cls}>
        {left && (
          <aside className="ed-left" aria-label="Presets and history">
            <div className="ed-left-presets scroll">
              <PresetsPanel layout="sidebar" />
            </div>
            <History />
          </aside>
        )}
        <main className="ed-center">
          <Stage pad={24} />
          {order && order.length > 1 && <Filmstrip order={order} current={id} />}
        </main>
        {ai ? (
          <aside className="ed-right ed-ai" aria-label="AI assistant">
            <AssistantPanel onClose={() => view.set({ ai: false })} />
          </aside>
        ) : (
          <Adjustments />
        )}
      </div>
    </div>
  )
}
