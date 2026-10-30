import { Icon, Logo, type IconName } from '../ui/Icon'
import { IosNote } from './ImportSheet'
import { isIOS } from './platform'

const POINTS: { icon: IconName; title: string; text: string }[] = [
  { icon: 'lock', title: 'Private by design', text: 'Your photos never leave this device. No account, no uploads.' },
  { icon: 'download', title: 'Works offline', text: 'Install Lumen to your home screen or dock and edit anywhere, even in airplane mode.' },
  { icon: 'image', title: 'RAW from 1,000+ cameras', text: 'Canon, Nikon, Sony, Fujifilm, Leica, iPhone ProRAW and more, plus JPEG, HEIC and TIFF.' },
]

/** First run: what Lumen is, and the way in. */
export function Welcome({ phone, onImport, onImportFolder }: { phone: boolean; onImport: () => void; onImportFolder: () => void }) {
  return (
    <div className="welcome-wrap">
      <section className="welcome" aria-labelledby="welcome-title">
        <div>
          <Logo size={44} />
          <h1 id="welcome-title" style={{ marginTop: 14 }}>
            Welcome to Lumen
          </h1>
          <p className="lead">
            A professional photo editor that lives on your device. Develop RAW files with pro tools on your GPU, then finish with 1,000 presets or the AI assistant.
          </p>
        </div>
        <ul className="welcome-points">
          {POINTS.map((p) => (
            <li key={p.title}>
              <span className="icon-wrap">
                <Icon name={p.icon} size={18} />
              </span>
              <div>
                <b>{p.title}</b>
                <span>{p.text}</span>
              </div>
            </li>
          ))}
        </ul>
        <div className="welcome-actions">
          <button type="button" className={phone ? 'btn primary lg block' : 'btn primary lg'} onClick={onImport}>
            <Icon name="plus" />
            Import photos
          </button>
          {!phone && (
            <>
              <button type="button" className="btn outline lg" onClick={onImportFolder}>
                <Icon name="folder" />
                Import a folder
              </button>
              <span className="muted small">or drop photos anywhere</span>
            </>
          )}
        </div>
        {isIOS && <IosNote />}
      </section>
    </div>
  )
}
