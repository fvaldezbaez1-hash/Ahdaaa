import { navigate } from '../router'
import { Segmented } from '../ui/controls'
import { Topbar } from '../ui/Topbar'
import { BodySection } from './Body'
import { NutritionSection } from './Nutrition'
import { TrainingSection } from './Training'

type Tab = 'body' | 'training' | 'nutrition'

export function ProgressTab({ tab: tabParam }: { tab?: string }) {
  const tab: Tab = tabParam === 'training' || tabParam === 'nutrition' ? tabParam : 'body'
  return (
    <div className="screen">
      <Topbar title="Progress" />
      <div className="stack">
        <Segmented
          value={tab}
          onChange={(t) => navigate(`/progress?tab=${t}`, { replace: true })}
          label="Progress sections"
          options={[
            { value: 'body', label: 'Body' },
            { value: 'training', label: 'Training' },
            { value: 'nutrition', label: 'Nutrition' },
          ]}
        />
        {tab === 'body' && <BodySection />}
        {tab === 'training' && <TrainingSection />}
        {tab === 'nutrition' && <NutritionSection />}
      </div>
    </div>
  )
}
