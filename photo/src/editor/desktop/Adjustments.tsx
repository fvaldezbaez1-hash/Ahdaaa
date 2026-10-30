import { useEditor } from '../../state/editor'
import { CropActions, CropPanel } from '../crop/CropPanel'
import { ColorGrading } from '../panels/ColorGrading'
import { ColorMixer } from '../panels/ColorMixer'
import { Histogram } from '../panels/Histogram'
import { cameraLine, exposureLine } from '../panels/photoInfo'
import { ProfileRow } from '../panels/ProfileRow'
import { Section } from '../panels/Section'
import { DetailSliders, EffectsSliders, LightSliders, PresenceSliders } from '../panels/SliderGroups'
import { ToneCurve } from '../panels/ToneCurve'
import { WhiteBalance } from '../panels/WhiteBalance'
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
    </div>
  )
}

/** The right column: histogram, profile and every adjustment group. */
export function Adjustments() {
  const cropping = useView((s) => s.tool === 'crop')
  const bw = useEditor((s) => s.recipe?.treatment === 'bw')
  return (
    <aside className="ed-right scroll" aria-label="Adjustments">
      <div className="ed-top">
        <Histogram />
        <Info />
        {!cropping && <ProfileRow />}
      </div>
      {cropping ? (
        <section className="ed-crop-side" aria-label="Crop and straighten">
          <div className="row between">
            <h2>Crop & straighten</h2>
            <CropActions />
          </div>
          <CropPanel layout="side" />
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
          <Section id="mixer" title={bw ? 'B&W mix' : 'Color mixer'} parts={['mixer']}>
            <ColorMixer />
          </Section>
          <Section id="grading" title="Color grading" parts={['grading']}>
            <ColorGrading layout="grid" />
          </Section>
          <Section id="detail" title="Detail" parts={['detail']}>
            <DetailSliders />
          </Section>
          <Section id="effects" title="Effects" parts={['effects']}>
            <EffectsSliders />
          </Section>
          <section className="ed-masks" aria-labelledby="ed-masks-title">
            <h2 id="ed-masks-title">Masks</h2>
            <div className="ed-masks-grid" aria-hidden="true">
              {['Sky · AI', 'Subject · AI', 'Brush', 'Gradient'].map((m) => (
                <span key={m}>{m}</span>
              ))}
            </div>
            <p className="muted small">Brush, gradient and AI masks are coming in the next update.</p>
          </section>
        </>
      )}
    </aside>
  )
}
