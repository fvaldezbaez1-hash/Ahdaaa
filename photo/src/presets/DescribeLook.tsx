import { useState } from 'react'
import { aiReady, generatePreset } from '../assistant/api'
import type { EditRecipe, SourceKind } from '../edit/types'
import { previewJpeg } from '../io/api'
import { link } from '../router'
import { Icon } from '../ui/Icon'
import { toast } from '../ui/toast'
import { addUserPreset } from './store'

/** "Describe a look": the AI builds a preset from words (and sees the photo, if there is one). */
export function DescribeLook({ photo, onCreated }: { photo: { id: string; kind: SourceKind; recipe: EditRecipe } | null; onCreated: (id: string) => void }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<'setup' | string | null>(null)

  const create = async () => {
    const description = text.trim()
    if (!description || busy) return
    setNote(null)
    if (!(await aiReady())) return setNote('setup')
    setBusy(true)
    try {
      const preview = photo ? (await previewJpeg(photo.id, photo.recipe, 768).catch(() => null))?.dataUrl : undefined
      const r = await generatePreset(description, { kind: photo?.kind ?? 'display', previewDataUrl: preview })
      const id = await addUserPreset({ name: r.name, collection: 'mine', source: 'ai', description: r.explanation, tags: ['ai', ...description.toLowerCase().split(/\s+/).slice(0, 6)], data: r.data })
      setText('')
      toast(`AI created “${r.name}” · saved to My presets`)
      onCreated(id)
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ps-ai-wrap">
      <form
        className="ps-ai"
        onSubmit={(e) => {
          e.preventDefault()
          void create()
        }}
      >
        <Icon name="sparkle" size={16} className="accent" />
        <label className="grow">
          <span className="sr-only">Describe a look for the AI</span>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Describe a look: “90s disposable camera”" enterKeyHint="go" maxLength={200} />
        </label>
        <button type="submit" className="btn primary sm" disabled={busy || !text.trim()}>
          {busy ? 'Creating…' : 'Create'}
        </button>
      </form>
      {note === 'setup' ? (
        <p className="small text-2" role="status">
          The AI uses your own API key. Turn it on in <a href={link('/settings')}>Settings → AI assistant</a>, then describe your look again.
        </p>
      ) : (
        note && (
          <p className="small" role="alert" style={{ color: 'var(--danger)' }}>
            {note}
          </p>
        )
      )}
    </div>
  )
}
