import { useSyncExternalStore } from 'react'
import { uid } from '../io/db'
import { editor } from '../state/editor'
import { loadSettings, type AiProvider } from '../state/settings'
import { runAgent, type AgentEdit, type Phase } from './agent'
import { AiError, aiError, type AiErrorKind } from './errors'
import { estimateCost } from './pricing'
import { loadPrefs } from './prefs'
import { devMock, loadProvider } from './providers'
import { modelFor, PROVIDERS } from './providers/meta'
import { diffSummary, revertDiff } from './recipeText'
import type { ChatMessage } from './types'

// The conversation for each photo, kept in memory for this session. Old
// previews aren't stored: earlier turns go back to the model as text.

export interface UserTurn {
  id: string
  role: 'user'
  text: string
}

export interface EditCard extends AgentEdit {
  status: 'open' | 'kept' | 'undone'
  whyOpen: boolean
}

export interface AssistantTurn {
  id: string
  role: 'assistant'
  text: string
  pending: boolean
  phase?: Phase
  edit?: EditCard
  error?: { kind: AiErrorKind; message: string }
  /** The request this answers, for "Try again". */
  ask: string
  stopped?: boolean
  /** Estimated cost in US$. */
  cost?: number
}

export type Turn = UserTurn | AssistantTurn

export interface Chat {
  turns: Turn[]
  busy: boolean
}

const EMPTY: Chat = { turns: [], busy: false }
/** Earlier turns sent back to the model (each user turn plus its reply). */
const HISTORY_TURNS = 12
const MAX_CHATS = 30

const chats = new Map<string, Chat>()
const controllers = new Map<string, AbortController>()
const listeners = new Set<() => void>()

function set(photoId: string, fn: (c: Chat) => Chat) {
  const next = fn(chats.get(photoId) ?? EMPTY)
  chats.delete(photoId)
  chats.set(photoId, next)
  if (chats.size > MAX_CHATS) chats.delete(chats.keys().next().value as string)
  listeners.forEach((l) => l())
}

function patchTurn(photoId: string, id: string, fn: (t: AssistantTurn) => Partial<AssistantTurn>) {
  set(photoId, (c) => ({ ...c, turns: c.turns.map((t) => (t.id === id && t.role === 'assistant' ? { ...t, ...fn(t) } : t)) }))
}

/** Earlier turns as plain text for the model, including what happened to each edit. */
export function condense(turns: Turn[]): ChatMessage[] {
  const out: ChatMessage[] = []
  for (const t of turns.slice(-HISTORY_TURNS)) {
    if (t.role === 'user') {
      out.push({ role: 'user', text: t.text })
      continue
    }
    if (t.pending) continue
    let text = t.text.trim()
    if (t.edit) {
      const fate = t.edit.status === 'undone' ? ' The user undid this edit.' : t.edit.status === 'kept' ? ' The user kept it.' : ''
      text += `${text ? '\n' : ''}[Changed: ${diffSummary(t.edit.diff)}.${fate}]`
    }
    if (!text) text = t.error ? `[Failed: ${t.error.message}]` : t.stopped ? '[Stopped by the user.]' : '[No reply.]'
    out.push({ role: 'assistant', text })
  }
  // Every vendor wants the conversation to open with the user.
  while (out.length && out[0].role !== 'user') out.shift()
  return out
}

// Switching photos cancels requests for the photo that was left.
editor.subscribe(() => {
  const open = editor.getState().photoId
  for (const [photoId, c] of controllers) if (photoId !== open) c.abort()
})

export const chat = {
  get: (photoId: string): Chat => chats.get(photoId) ?? EMPTY,
  subscribe(fn: () => void) {
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  },

  async send(photoId: string, raw: string) {
    const text = raw.trim()
    if (!text || chat.get(photoId).busy) return
    const history = condense(chat.get(photoId).turns)
    const replyId = uid()
    set(photoId, (c) => ({
      busy: true,
      turns: [...c.turns, { id: uid(), role: 'user', text }, { id: replyId, role: 'assistant', text: '', pending: true, phase: 'looking', ask: text }],
    }))
    const controller = new AbortController()
    controllers.set(photoId, controller)

    let vendor = 'The AI'
    try {
      const settings = await loadSettings()
      const provider: AiProvider = settings.ai.provider
      vendor = PROVIDERS[provider].vendor
      const apiKey = settings.ai.keys[provider]?.trim() ?? ''
      const model = modelFor(provider, settings.ai.models)
      if (!devMock() && (!settings.ai.enabled || !apiKey)) throw aiError('setup', vendor)
      const baseURL = provider === 'openai' ? (await loadPrefs()).openaiBaseUrl : undefined
      const impl = await loadProvider(provider).catch(() => {
        throw aiError('network', vendor)
      })
      const result = await runAgent({
        provider: impl,
        cfg: { apiKey, baseURL },
        vendor,
        model,
        photoId,
        history,
        userText: text,
        signal: controller.signal,
        hooks: {
          onText: (d) => patchTurn(photoId, replyId, (t) => ({ text: t.text + d })),
          onTextReset: (n) => patchTurn(photoId, replyId, (t) => ({ text: t.text.slice(0, Math.max(0, t.text.length - n)) })),
          onPhase: (phase) => patchTurn(photoId, replyId, () => ({ phase })),
          onEdit: (edit) => patchTurn(photoId, replyId, () => ({ edit: { ...edit, status: 'open', whyOpen: false } })),
        },
      })
      patchTurn(photoId, replyId, (t) => ({
        text: result.text || (t.edit ? '' : 'I couldn’t come up with an answer. Try asking differently.'),
        cost: estimateCost(model, result.usage),
      }))
    } catch (e) {
      const err = e instanceof AiError ? e : aiError('output', vendor)
      // A refusal can arrive mid-answer; its partial text isn't an answer.
      patchTurn(photoId, replyId, (t) =>
        err.kind === 'aborted' ? { stopped: true } : { error: { kind: err.kind, message: err.message }, text: err.kind === 'refusal' ? '' : t.text },
      )
    } finally {
      if (controllers.get(photoId) === controller) controllers.delete(photoId)
      patchTurn(photoId, replyId, () => ({ pending: false, phase: undefined }))
      set(photoId, (c) => ({ ...c, busy: false }))
    }
  },

  stop(photoId: string) {
    controllers.get(photoId)?.abort()
  },

  retry(photoId: string, turnId: string) {
    const t = chat.get(photoId).turns.find((x) => x.id === turnId)
    if (t?.role === 'assistant') void chat.send(photoId, t.ask)
  },

  keep(photoId: string, turnId: string) {
    patchTurn(photoId, turnId, (t) => (t.edit ? { edit: { ...t.edit, status: 'kept' } } : {}))
  },

  /** Undo the edit: a plain undo while it's still the latest step, otherwise revert just what the AI set. */
  undo(photoId: string, turnId: string) {
    const t = chat.get(photoId).turns.find((x) => x.id === turnId)
    const st = editor.getState()
    if (t?.role !== 'assistant' || !t.edit || t.edit.status === 'undone' || st.photoId !== photoId) return
    const edit = t.edit
    if (edit.versionAfter === st.version) editor.undo()
    else editor.apply((r) => revertDiff(r, edit.diff), `Undo AI · ${edit.summary}`)
    patchTurn(photoId, turnId, () => ({ edit: { ...edit, status: 'undone', whyOpen: false } }))
  },

  toggleWhy(photoId: string, turnId: string) {
    patchTurn(photoId, turnId, (t) => (t.edit ? { edit: { ...t.edit, whyOpen: !t.edit.whyOpen } } : {}))
  },

  clear(photoId: string) {
    chat.stop(photoId)
    set(photoId, () => EMPTY)
  },
}

export function useChat(photoId: string | null): Chat {
  return useSyncExternalStore(chat.subscribe, () => (photoId ? chat.get(photoId) : EMPTY), () => EMPTY)
}
