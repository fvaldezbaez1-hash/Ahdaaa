import { getPath } from '../edit/path'
import type { EditRecipe } from '../edit/types'
import { previewJpeg } from '../io/api'
import { editor } from '../state/editor'
import { AiError, aiError } from './errors'
import { hasLooks, systemPrompt } from './prompt'
import { describeRecipe, diffRecipes, mergeDiffs, type DiffItem } from './recipeText'
import { assistantTools, runTool, ToolInputError, type ToolContext } from './schema'
import { addUsage, NO_USAGE, type ChatMessage, type Provider, type ProviderConfig, type ToolResult, type TurnRequest, type TurnResult, type Usage } from './types'

// One user request: look at a preview, let the model call tools, apply them,
// show it the result, let it refine — at most MAX_ROUNDS model calls. All of
// a request's changes become ONE undo step (editor.preview … editor.commit).

export const MAX_ROUNDS = 3
export const PREVIEW_EDGE = 1024

export type Phase = 'looking' | 'applying' | 'checking'

export interface AgentEdit {
  diff: DiffItem[]
  /** Label of the undo step. */
  summary: string
  why: string
  /** Editor version right after the commit, or -1 if the user edited meanwhile (undo then reverts selectively). */
  versionAfter: number
}

export interface AgentHooks {
  onText(delta: string): void
  /** A turn is retried: drop the last `length` characters it streamed. */
  onTextReset(length: number): void
  onPhase(phase: Phase): void
  /** Called once, even when the request fails part-way, if anything was changed. */
  onEdit(edit: AgentEdit): void
}

export interface AgentOptions {
  provider: Provider
  cfg: ProviderConfig
  vendor: string
  model: string
  photoId: string
  /** Earlier turns, condensed to text (old previews aren't re-sent). */
  history: ChatMessage[]
  userText: string
  signal: AbortSignal
  hooks: AgentHooks
}

export interface AgentResult {
  text: string
  usage: Usage
  rounds: number
}

async function render(photoId: string, recipe: EditRecipe): Promise<{ dataUrl: string; width: number; height: number } | undefined> {
  try {
    return await previewJpeg(photoId, recipe, PREVIEW_EDGE)
  } catch {
    // The model can still work from the settings alone.
    return undefined
  }
}

function userMessage(text: string, recipe: EditRecipe, ctx: ToolContext, shot: { width: number; height: number } | undefined): string {
  const view = shot ? `The attached image is a ${shot.width}×${shot.height} px preview of the photo with the current settings.` : "The preview couldn't be rendered; judge from the settings."
  return `${text}\n---\nCurrent settings: ${describeRecipe(recipe, ctx.kind, ctx.asShot)}\n${view}`
}

const CHECK = 'Here is the photo with your changes applied. If something is clearly off, correct it with one more call; otherwise reply to the user without calling tools.'
const LAST_CHECK = 'Here is the photo with your changes applied. Reply to the user now (no more changes this time).'

export async function runAgent(o: AgentOptions): Promise<AgentResult> {
  const start = editor.getState()
  if (start.photoId !== o.photoId || !start.recipe) throw aiError('aborted', o.vendor)
  const ctx: ToolContext = { kind: start.kind, asShot: start.asShot }
  const guard = () => {
    if (o.signal.aborted || editor.getState().photoId !== o.photoId) throw aiError('aborted', o.vendor)
  }

  o.hooks.onPhase('looking')
  const shot = await render(o.photoId, start.recipe)
  guard()
  const messages: ChatMessage[] = [...o.history, { role: 'user', text: userMessage(o.userText, start.recipe, ctx, shot), images: shot ? [shot.dataUrl] : undefined }]
  const base = { model: o.model, system: systemPrompt(ctx.kind, ctx.asShot), tools: assistantTools(hasLooks()), signal: o.signal }

  let text = ''
  let usage = NO_USAGE
  let rounds = 0
  let diff: DiffItem[] = []
  let ours: EditRecipe | null = null
  const summaries: string[] = []
  const whys: string[] = []

  try {
    while (rounds < MAX_ROUNDS) {
      rounds++
      const res = await turn(o, { ...base, messages }, text)
      usage = addUsage(usage, res.usage)
      if (res.text.trim()) text = text ? `${text}\n\n${res.text.trim()}` : res.text.trim()
      if (!res.toolCalls.length) break
      // A tool call cut off by the output limit may parse as a smaller, wrong edit.
      if (res.stop === 'max_tokens') throw aiError('output', o.vendor)
      guard()

      o.hooks.onPhase('applying')
      const current = editor.getState().recipe as EditRecipe
      let next = current
      const results: ToolResult[] = []
      for (const call of res.toolCalls) {
        try {
          const out = runTool(call.name, call.args, next, ctx)
          next = out.recipe
          if (out.summary) summaries.push(out.summary)
          if (out.why) whys.push(out.why)
          results.push({ callId: call.id, name: call.name, content: ['Applied.', ...out.notes].join(' ') })
        } catch (e) {
          if (!(e instanceof ToolInputError)) throw e
          results.push({ callId: call.id, name: call.name, content: `Not applied: ${e.message}`, isError: true })
        }
      }
      if (next !== current) {
        // Live, without an undo step yet; the commit below makes the whole request one step.
        editor.preview(() => next)
        ours = next
        diff = mergeDiffs(diff, diffRecipes(current, next, ctx.kind))
      }
      if (rounds === MAX_ROUNDS) break

      o.hooks.onPhase('checking')
      const after = await render(o.photoId, next)
      guard()
      const last = results[results.length - 1]
      last.content += ` Settings now: ${describeRecipe(next, ctx.kind, ctx.asShot)}`
      messages.push({ role: 'assistant', text: res.text, toolCalls: res.toolCalls, native: res.native })
      messages.push({ role: 'tool', results, text: rounds === MAX_ROUNDS - 1 ? LAST_CHECK : CHECK, images: after ? [after.dataUrl] : undefined })
    }
  } finally {
    if (ours) finish(o, ours, diff, summaries, whys)
  }
  return { text, usage, rounds }
}

/** One model call; a malformed answer is retried once (its streamed text is withdrawn). */
async function turn(o: AgentOptions, req: Omit<TurnRequest, 'onText'>, sofar: string): Promise<TurnResult> {
  for (let attempt = 0; ; attempt++) {
    let streamed = 0
    const onText = (d: string) => {
      // Separate this round's words from the previous round's.
      const chunk = streamed === 0 && sofar ? `\n\n${d}` : d
      streamed += chunk.length
      o.hooks.onText(chunk)
    }
    try {
      return await o.provider.turn(o.cfg, { ...req, onText })
    } catch (e) {
      if (attempt > 0 || !(e instanceof AiError) || e.kind !== 'output') throw e
      o.hooks.onTextReset(streamed)
    }
  }
}

function finish(o: AgentOptions, ours: EditRecipe, diff: DiffItem[], summaries: string[], whys: string[]) {
  const st = editor.getState()
  // Switched photos: the editor already dropped the live change.
  if (st.photoId !== o.photoId) return
  const summary = (summaries[0] ?? 'Edit').slice(0, 40)
  editor.commit(`AI · ${summary}`)
  const now = editor.getState()
  const exact = JSON.stringify(now.recipe) === JSON.stringify(ours)
  // If the user undid or changed things mid-request, only show what is still applied.
  const kept = exact ? diff : diff.filter((i) => now.recipe && JSON.stringify(getPath(now.recipe, i.path)) === JSON.stringify(i.to))
  if (!kept.some((i) => !i.hidden)) return
  o.hooks.onEdit({ diff: kept, summary, why: [...new Set(whys)].join(' '), versionAfter: exact ? now.version : -1 })
}
