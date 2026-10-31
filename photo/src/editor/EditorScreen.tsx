import { useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../io/db'
import { goBack } from '../router'
import { Empty, Spinner } from '../ui/controls'
import { Icon } from '../ui/Icon'
import { useIsPhone } from '../ui/hooks'
import { finishCrop, isCropping } from './crop/cropTool'
import { DesktopEditor } from './desktop/DesktopEditor'
import { useRasterSync } from './ai/rasterSync'
import { usePersistence } from './persistence'
import { PhoneEditor } from './phone/PhoneEditor'
import { usePhotoOrder } from './photos'
import { SessionContext, useEditorSession, type SessionStatus } from './session'
import { EditorSheets } from './Sheets'
import { useEditorShortcuts } from './shortcuts'
import './editor.css'

function Waiting({ status, retry, fileName }: { status: SessionStatus; retry: () => void; fileName?: string }) {
  if (status.state === 'loading') {
    return (
      <div className="ed-wait" role="status">
        <Spinner label="Opening photo" />
        <p>{fileName ? `Opening ${fileName}…` : 'Opening…'}</p>
      </div>
    )
  }
  if (status.state !== 'error') return null
  const title = { missing: 'Photo not found', unsupported: 'This browser can’t edit photos', decode: 'Couldn’t open this photo', engine: 'The editor couldn’t start' }[status.reason]
  return (
    <div className="ed-wait">
      <Empty icon={status.reason === 'missing' ? 'image' : 'info'}>
        <h1 className="ed-wait-title">{title}</h1>
        <p className="ed-wait-msg">{status.message}</p>
        {status.reason === 'unsupported' && <p className="ed-wait-msg">Try a recent version of Safari, Chrome, Edge or Firefox.</p>}
        <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
          <button type="button" className="btn" onClick={() => goBack('/')}>
            <Icon name="left" size={16} />
            Back to library
          </button>
          {(status.reason === 'decode' || status.reason === 'engine') && (
            <button type="button" className="btn primary" onClick={retry}>
              Try again
            </button>
          )}
        </div>
      </Empty>
    </div>
  )
}

/** The editing screen for one photo. */
export function EditorScreen({ id }: { id: string }) {
  const { status, retry } = useEditorSession(id)
  const session = status.state === 'ready' ? status.session : null
  const phone = useIsPhone()
  const order = usePhotoOrder()
  const fileName = useLiveQuery(() => db.photos.get(id).then((p) => p?.fileName), [id])
  usePersistence(id, !!session)
  useRasterSync(session)
  useEditorShortcuts(session, order)
  // Leaving mid-crop keeps the crop (like switching tools).
  useEffect(() => () => void (isCropping() && finishCrop()), [id])

  return (
    <div className={phone ? 'ed ed-is-phone' : 'ed'}>
      {session ? (
        <SessionContext.Provider value={session}>
          {phone ? <PhoneEditor /> : <DesktopEditor order={order} id={id} />}
          <EditorSheets session={session} />
        </SessionContext.Provider>
      ) : (
        <Waiting status={status} retry={retry} fileName={fileName} />
      )}
    </div>
  )
}
