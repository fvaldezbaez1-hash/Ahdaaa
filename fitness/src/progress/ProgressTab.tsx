import { navigate } from '../router'
import { Segmented } from '../ui/controls'
import { Topbar } from '../ui/Topbar'
import { HelpButton, Tip } from '../help/Tip'
import { BodySection } from './Body'
import { NutritionSection } from './Nutrition'
import { TrainingSection } from './Training'

type Tab = 'body' | 'training' | 'nutrition'

export function ProgressTab({ tab: tabParam }: { tab?: string }) {
  const tab: Tab = tabParam === 'training' || tabParam === 'nutrition' ? tabParam : 'body'
  return (
    <div className="screen">
      <Topbar title="Progress" right={<HelpButton section="progress" />} />
      <div className="stack">
        <Tip id="progress" title="Reading your progress" learnMore="progress">
          <ul>
            <li>
              <b>Body</b>: dots are your daily weigh-ins and the <b>blue line</b> is your trend. Watch the line, not the daily ups and downs.
            </li>
            <li>
              <b>Training</b>: how often you train and your new records.
            </li>
            <li>
              <b>Nutrition</b>: your average calories and how your target is changing.
            </li>
          </ul>
        </Tip>
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
