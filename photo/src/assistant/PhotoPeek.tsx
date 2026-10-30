import { useEffect, useRef, useState } from 'react'
import { defaultRecipe } from '../edit/defaults'
import { previewJpeg } from '../io/api'
import { editor, useEditor } from '../state/editor'
import { Spinner } from '../ui/controls'

// Phones: the assistant covers the editor, so it shows the photo itself.
// Re-rendered (small) as the edit changes; hold it to see the original.

const EDGE = 900
const DEBOUNCE_MS = 250

export function PhotoPeek({ photoId }: { photoId: string }) {
  const recipe = useEditor((s) => s.recipe)
  const [edited, setEdited] = useState<string>()
  const [original, setOriginal] = useState<{ key: string; url: string }>()
  const [holding, setHolding] = useState(false)
  const first = useRef(true)

  useEffect(() => {
    if (!recipe) return
    let live = true
    const t = setTimeout(
      () =>
        void previewJpeg(photoId, recipe, EDGE)
          .then((r) => live && setEdited(r.dataUrl))
          .catch(() => undefined),
      first.current ? 0 : DEBOUNCE_MS,
    )
    first.current = false
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [photoId, recipe])

  const hold = () => {
    setHolding(true)
    const { recipe: r, kind, asShot } = editor.getState()
    if (!r) return
    // Same framing as the edit, everything else as shot.
    const key = JSON.stringify(r.geometry)
    if (original?.key === key) return
    void previewJpeg(photoId, { ...defaultRecipe(kind, asShot), geometry: r.geometry }, EDGE)
      .then((p) => setOriginal({ key, url: p.dataUrl }))
      .catch(() => undefined)
  }
  const release = () => setHolding(false)
  const showOriginal = holding && !!original

  return (
    <div className="ai-peek" onPointerDown={hold} onPointerUp={release} onPointerLeave={release} onPointerCancel={release} onContextMenu={(e) => e.preventDefault()}>
      {edited ? <img src={showOriginal ? original.url : edited} alt={showOriginal ? 'Your photo as shot' : 'Your photo with the current edit'} draggable={false} /> : <Spinner label="Rendering the photo" />}
      <span className="ai-peek-tag" aria-hidden="true">
        {showOriginal ? 'Original' : 'Hold to compare'}
      </span>
    </div>
  )
}
