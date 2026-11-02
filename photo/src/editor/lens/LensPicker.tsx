import { useEffect, useState } from 'react'
import { SearchBox } from '../../ui/controls'
import { Sheet } from '../../ui/Sheet'
import { useSession } from '../session'
import { enableProfile, lensName, loadLens, useLensStatus, type LensInfo } from './lensSync'

/** Choose a lens profile by name (lenses that fit the camera first). */
export function LensPicker({ onClose }: { onClose: () => void }) {
  const session = useSession()
  const { camera } = useLensStatus()
  const [query, setQuery] = useState(session.record.meta.lens ?? '')
  const [found, setFound] = useState<LensInfo[] | null>(null)

  useEffect(() => {
    let live = true
    const t = setTimeout(() => {
      void loadLens()
        .then((m) => m.listLenses(query, { camera, limit: 40 }))
        .then((ls) => live && setFound(ls))
    }, 150)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [query, camera])

  const pick = (l: LensInfo) => {
    onClose()
    void enableProfile(session, l.id, `Lens profile: ${l.model}`)
  }
  return (
    <Sheet title="Lens profile" onClose={onClose}>
      <div className="stack">
        <SearchBox value={query} onChange={setQuery} placeholder="Search lenses, e.g. 24-70 2.8" autoFocus />
        {camera && <p className="muted small">Lenses that fit the {camera.maker} {camera.model} come first.</p>}
        {found === null ? (
          <p className="muted small">Loading the lens database…</p>
        ) : found.length === 0 ? (
          <p className="muted small">No lens matches “{query}”.</p>
        ) : (
          <div className="list ed-lens-list">
            {found.map((l) => (
              <button key={l.id} type="button" className="list-row" onClick={() => pick(l)}>
                <span className="grow">
                  <span className="ellipsis" style={{ display: 'block' }}>
                    {lensName(l)}
                  </span>
                  <small className="muted">
                    {l.focal[0] === l.focal[1] ? `${l.focal[0]} mm` : `${l.focal[0]}–${l.focal[1]} mm`}
                    {l.aperture[0] ? ` · ƒ/${l.aperture[0]}` : ''} · {l.mounts.join(', ')}
                  </small>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  )
}
