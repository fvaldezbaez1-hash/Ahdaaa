import { useLayoutEffect, useRef, useState } from 'react'
import type { EditRecipe } from '../edit/types'
import { useEditor } from '../state/editor'
import { updateSettings, useSettings, type AiProvider, type Settings } from '../state/settings'
import { Spinner } from '../ui/controls'
import { Icon } from '../ui/Icon'
import { useIsPhone } from '../ui/hooks'
import type { Phase } from './agent'
import { ChangeCard } from './ChangeCard'
import { chat, useChat, type AssistantTurn, type Turn } from './chat'
import type { AiErrorKind } from './errors'
import { openAiSettings } from './links'
import { PhotoPeek } from './PhotoPeek'
import { formatCost, typicalCost } from './pricing'
import { devMock } from './providers'
import { modelFor, PROVIDER_IDS, PROVIDERS } from './providers/meta'
import { useSpeech } from './useSpeech'
import './assistant.css'

const PHASES: Record<Phase, string> = {
  looking: 'Looking at the photo…',
  applying: 'Adjusting the sliders…',
  checking: 'Checking the result…',
}
/** Errors the user fixes in Settings, and errors worth simply trying again. */
const SETTINGS_FIX = new Set<AiErrorKind>(['setup', 'auth', 'quota', 'model', 'blocked'])
const RETRYABLE = new Set<AiErrorKind>(['rate', 'network', 'server', 'output', 'blocked'])

const isReady = (ai: Settings['ai']) => devMock() || (ai.enabled && !!ai.keys[ai.provider]?.trim())

/** The AI assistant: right column of the editor on desktop, full screen on phones. */
export function AssistantPanel({ onClose }: { onClose?: () => void }) {
  const settings = useSettings()
  const photoId = useEditor((s) => s.photoId)
  const phone = useIsPhone()
  const ai = settings?.ai

  return (
    <div className={phone ? 'ai is-phone' : 'ai'}>
      <header className="ai-head">
        {phone && onClose && (
          <button type="button" className="icon-btn lg" aria-label="Back to the editor" onClick={onClose}>
            <Icon name="left" size={22} />
          </button>
        )}
        <span className="ai-badge" aria-hidden="true">
          <Icon name="sparkle" size={phone ? 18 : 16} />
        </span>
        <div className="grow">
          <h2 className="ai-title">Lumen AI</h2>
          {!phone && <p className="ai-sub">Edits with the real sliders · everything can be undone</p>}
        </div>
        {ai && (
          <label className="ai-provider">
            <span className="sr-only">AI provider</span>
            <select value={ai.provider} onChange={(e) => void updateSettings((s) => ({ ai: { ...s.ai, provider: e.target.value as AiProvider } }))}>
              {PROVIDER_IDS.map((id) => (
                <option key={id} value={id}>
                  {PROVIDERS[id].label}
                </option>
              ))}
            </select>
          </label>
        )}
        {!phone && onClose && (
          <button type="button" className="icon-btn" aria-label="Close the AI assistant" onClick={onClose}>
            <Icon name="x" />
          </button>
        )}
      </header>
      {phone && photoId && <PhotoPeek photoId={photoId} />}
      {!ai ? (
        <div className="ai-center">
          <Spinner label="Loading" />
        </div>
      ) : !photoId ? (
        <div className="ai-center muted">Open a photo to edit it with Lumen AI.</div>
      ) : isReady(ai) ? (
        <Conversation photoId={photoId} provider={ai.provider} model={modelFor(ai.provider, ai.models)} phone={phone} />
      ) : (
        <SetupCard ai={ai} />
      )}
    </div>
  )
}

function suggestions(recipe: EditRecipe | null, turns: Turn[]): string[] {
  let list = ['Make it pop', 'Warm golden hour', 'Make it moodier', 'Natural portrait', 'Black & white', 'Fix the white balance', 'Straighten it']
  if (recipe?.treatment === 'bw') list = list.map((s) => (s === 'Black & white' ? 'Back to color' : s))
  if (recipe && recipe.geometry.angle !== 0) list = list.filter((s) => s !== 'Straighten it')
  const last = turns[turns.length - 1]
  if (last?.role === 'assistant' && last.edit && last.edit.status !== 'undone') list = ['A bit subtler', 'Push it further', ...list]
  if (!turns.length) list = ['What would you improve?', ...list]
  return list
}

function Conversation({ photoId, provider, model, phone }: { photoId: string; provider: AiProvider; model: string; phone: boolean }) {
  const { turns, busy } = useChat(photoId)
  const recipe = useEditor((s) => s.recipe)
  const [draft, setDraft] = useState('')
  const log = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const vendor = PROVIDERS[provider].vendor
  const cost = typicalCost(model)

  // Follow new text unless the user scrolled up to read.
  useLayoutEffect(() => {
    const el = log.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [turns])

  const send = (text: string) => {
    if (!text.trim() || busy) return
    pinned.current = true
    setDraft('')
    void chat.send(photoId, text)
  }

  return (
    <>
      <div
        ref={log}
        className="ai-log scroll"
        role="log"
        aria-label="Conversation with Lumen AI"
        aria-busy={busy}
        onScroll={(e) => {
          const el = e.currentTarget
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
        }}
      >
        {turns.length === 0 && (
          <div className="ai-bot">
            <p className="ai-text">Tell me what you’d like in your own words, or tap a suggestion. I’ll move the real sliders and show you exactly what changed.</p>
          </div>
        )}
        {turns.map((t) =>
          t.role === 'user' ? (
            <p key={t.id} className="ai-user">
              {t.text}
            </p>
          ) : (
            <Reply key={t.id} turn={t} photoId={photoId} />
          ),
        )}
      </div>
      <footer className="ai-foot">
        <div className={phone ? 'ai-chips no-scrollbar' : 'ai-chips'} role="group" aria-label="Suggestions">
          {suggestions(recipe, turns).map((s) => (
            <button key={s} type="button" className="chip" disabled={busy} onClick={() => send(s)}>
              {s}
            </button>
          ))}
        </div>
        <Composer draft={draft} setDraft={setDraft} busy={busy} phone={phone} onSend={send} onStop={() => chat.stop(photoId)} />
        <p className="ai-note">
          <Icon name="lock" size={12} />
          <span>
            Only a 1024 px preview is sent to {vendor}; your original stays on this device.
            {cost !== undefined && ` ${model} · ${formatCost(cost)} per request.`}
          </span>
        </p>
      </footer>
    </>
  )
}

function Reply({ turn, photoId }: { turn: AssistantTurn; photoId: string }) {
  const working = turn.pending && (!turn.text || turn.phase !== 'looking')
  return (
    <div className="ai-bot">
      {turn.text && <p className="ai-text">{turn.text}</p>}
      {working && (
        <div className="ai-typing" role="status">
          <span className="ai-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          {PHASES[turn.phase ?? 'looking']}
        </div>
      )}
      {turn.edit && (
        <ChangeCard
          edit={turn.edit}
          onKeep={() => chat.keep(photoId, turn.id)}
          onUndo={() => chat.undo(photoId, turn.id)}
          onWhy={() => chat.toggleWhy(photoId, turn.id)}
        />
      )}
      {turn.error && (
        <div className="ai-error" role="alert">
          <Icon name="info" size={16} />
          <div className="grow stack tight">
            <p>{turn.error.message}</p>
            <div className="row wrap">
              {SETTINGS_FIX.has(turn.error.kind) && (
                <button type="button" className="btn sm" onClick={openAiSettings}>
                  Open AI settings
                </button>
              )}
              {RETRYABLE.has(turn.error.kind) && (
                <button type="button" className="btn sm ghost" onClick={() => chat.retry(photoId, turn.id)}>
                  Try again
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {turn.stopped && <p className="ai-meta">Stopped.</p>}
      {!turn.pending && turn.cost !== undefined && <p className="ai-meta">{formatCost(turn.cost)}</p>}
    </div>
  )
}

function Composer({
  draft, setDraft, busy, phone, onSend, onStop,
}: {
  draft: string
  setDraft: (v: string) => void
  busy: boolean
  phone: boolean
  onSend: (text: string) => void
  onStop: () => void
}) {
  const field = useRef<HTMLTextAreaElement>(null)
  const before = useRef('')
  const speech = useSpeech((t) => setDraft(before.current ? `${before.current} ${t}` : t))

  // Grow with the text up to about five lines.
  useLayoutEffect(() => {
    const el = field.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [draft])

  return (
    <form
      className="ai-input"
      onSubmit={(e) => {
        e.preventDefault()
        onSend(draft)
      }}
    >
      <label className="grow">
        <span className="sr-only">Describe an edit</span>
        <textarea
          ref={field}
          rows={1}
          value={draft}
          enterKeyHint="send"
          placeholder={phone ? 'Describe an edit…' : 'Describe an edit… “make the water more turquoise”'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              onSend(draft)
            }
          }}
        />
      </label>
      {speech.supported && (
        <button
          type="button"
          className={speech.listening ? 'ai-icon on' : 'ai-icon'}
          aria-label={speech.listening ? 'Stop dictation' : 'Speak your edit'}
          aria-pressed={speech.listening}
          title="Dictate (uses your browser’s speech recognition)"
          onClick={() => {
            if (speech.listening) return speech.stop()
            before.current = draft.trim()
            speech.start()
          }}
        >
          <Icon name="mic" size={phone ? 20 : 18} />
        </button>
      )}
      {busy ? (
        <button type="button" className="ai-send stop" aria-label="Stop" onClick={onStop}>
          <span aria-hidden="true" />
        </button>
      ) : (
        <button type="submit" className="ai-send" aria-label="Send" disabled={!draft.trim()}>
          <Icon name="send" size={phone ? 18 : 17} />
        </button>
      )}
    </form>
  )
}

function SetupCard({ ai }: { ai: Settings['ai'] }) {
  const vendor = PROVIDERS[ai.provider].vendor
  const others = PROVIDER_IDS.filter((id) => id !== ai.provider && ai.keys[id]?.trim()).map((id) => PROVIDERS[id].vendor)
  const title = !ai.enabled ? 'The AI assistant is off' : others.length ? `Add your ${vendor} key` : 'Edit by describing it'
  return (
    <div className="ai-setup scroll">
      <div className="ai-setup-card">
        <span className="ai-badge lg" aria-hidden="true">
          <Icon name="sparkle" size={22} />
        </span>
        <h3>{title}</h3>
        <p>Tell Lumen AI what you want — “warmer, like golden hour”, “fix the white balance”, “make it pop” — and it moves the real sliders for you.</p>
        <ul className="ai-setup-list">
          <li>
            <Icon name="check" size={16} />
            Looks at a small preview and suggests fixes
          </li>
          <li>
            <Icon name="check" size={16} />
            Shows exactly which sliders moved — keep it or undo it
          </li>
          <li>
            <Icon name="check" size={16} />
            Explains why each change works
          </li>
          <li>
            <Icon name="key" size={16} />
            Uses your own key for OpenAI, Google Gemini or Anthropic Claude. You pay the vendor directly, usually a few cents per request.
          </li>
        </ul>
        {ai.enabled && others.length > 0 && (
          <p className="muted">
            You already have a key for {others.join(' and ')}: pick it in the menu above, or add a {vendor} key.
          </p>
        )}
        <p className="ai-privacy">
          <Icon name="lock" size={13} />
          Your key stays on this device. Only a 1024 px preview goes to the vendor you choose; your original never leaves it.
        </p>
        <a
          className="btn primary block"
          href="#/settings"
          onClick={(e) => {
            e.preventDefault()
            openAiSettings()
          }}
        >
          {ai.enabled ? 'Set up in Settings' : 'Turn it on in Settings'}
        </a>
      </div>
    </div>
  )
}
