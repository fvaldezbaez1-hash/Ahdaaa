import { KeywordEditor } from '../../library/KeywordEditor'
import { useEditor } from '../../state/editor'
import { ColorEditor } from '../color/ColorEditor'
import { CropActions, CropPanel } from '../crop/CropPanel'
import { LensPanel } from '../lens/LensPanel'
import { HealPanel } from '../masks/HealPanel'
import { MasksPanel, MasksSummary } from '../masks/MasksPanel'
import { ColorGrading } from '../panels/ColorGrading'
import { ColorMixer } from '../panels/ColorMixer'
import { Histogram } from '../panels/Histogram'
import { Levels } from '../panels/Levels'
import { cameraLine, exposureLine } from '../panels/photoInfo'
import { ProfileRow } from '../panels/ProfileRow'
import { Section } from '../panels/Section'
import { DetailSliders, EffectsSliders, LightSliders, PresenceSliders } from '../panels/SliderGroups'
import { ToneCurve } from '../panels/ToneCurve'
import { WhiteBalance } from '../panels/WhiteBalance'
import { TransformPanel } from '../transform/TransformPanel'
import { useSession } from '../session'
import { useView } from '../view'

function Info() {
  const { record } = useSession()
  const exposure = exposureLine(record.meta), camera = cameraLine(record.meta)
  return (
    <div className="ed-info">
      {exposure && <div className="tnum">{exposure}</div>}
      {camera && <div className="ellipsis">{camera}</div>}
      {!exposure && !camera && <div>{`${record.width.toLocaleString('en-US')} × ${record.height.toLocaleString('en-US')} px`}</div>}
      <div className="ed-keywords">
        <KeywordEditor ids={[record.id]} compact />
      </div>
    </div>
  )
}

/** The right column: histogram, profile and every adjustment group. */
export function Adjustments() {
  const tool = useView((s) => s.tool)
  const cropping = tool === 'crop'
  const bw = useEditor((s) => s.recipe?.treatment === 'bw')
  return (
    <aside className="ed-right scroll" aria-label="Adjustments">
      <div className="ed-top">
        <Histogram />
        <Info />
        {!tool && <ProfileRow />}
      </div>
      {tool === 'mask' ? (
        <MasksPanel layout="side" />
      ) : tool === 'heal' ? (
        <HealPanel layout="side" />
      ) : tool === 'guides' ? (
        <section className="ed-crop-side" aria-label="Guided Upright">
          <h2>Transform</h2>
          <TransformPanel />
        </section>
      ) : cropping ? (
        <section className="ed-crop-side" aria-label="Crop and straighten">
          <div className="row between">
            <h2>Crop & straighten</h2>
            <CropActions />
          </div>
          <CropPanel layout="side" />
          <h2 className="ed-side-sub">Transform</h2>
          <TransformPanel />
        </section>
      ) : (
        <>
          <Section id="wb" title="White balance" parts={['wb']}>
            <WhiteBalance />
          </Section>
          <Section id="light" title="Light" parts={['light']}>
            <LightSliders />
          </Section>
          <Section id="presence" title="Presence" parts={['presence']}>
            <PresenceSliders />
          </Section>
          <Section id="curve" title="Tone curve" parts={['curve']}>
            <ToneCurve />
          </Section>
          <Section id="levels" title="Levels" parts={['levels']}>
            <Levels />
          </Section>
          <Section id="mixer" title={bw ? 'B&W mix' : 'Color mixer'} parts={['mixer']}>
            <ColorMixer />
          </Section>
          <Section id="colorEditor" title="Color editor" parts={['colorEditor']}>
            <ColorEditor />
          </Section>
          <Section id="grading" title="Color grading" parts={['grading']}>
            <ColorGrading layout="grid" />
          </Section>
          <Section id="detail" title="Detail" parts={['detail']}>
            <DetailSliders />
          </Section>
          <Section id="lens" title="Lens corrections" parts={['lens']}>
            <LensPanel />
          </Section>
          <Section id="transform" title="Transform" parts={['transform']}>
            <TransformPanel />
          </Section>
          <Section id="effects" title="Effects" parts={['effects']}>
            <EffectsSliders />
          </Section>
          <MasksSummary />
        </>
      )}
    </aside>
  )
}
