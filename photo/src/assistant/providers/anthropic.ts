import Anthropic from '@anthropic-ai/sdk'
import type { BetaContentBlockParam, BetaMessageParam, BetaTool } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { AiError, aiError, httpError } from '../errors'
import type { ChatMessage, Provider, ProviderConfig, TurnRequest, TurnResult } from '../types'
import { splitDataUrl, TEST_PROMPT } from './shared'

// Claude through the official SDK. Anthropic supports direct browser access
// (the SDK sends the anthropic-dangerous-direct-browser-access header).

const VENDOR = 'Anthropic'
/** Models that accept output_config.effort (older ones reject it). */
const EFFORT = /^claude-(opus-4-[5-9]|opus-5|sonnet-4-6|sonnet-5|haiku-5|fable|mythos)/
/** Models with server-side refusal fallback; "default" lets Anthropic pick the substitute. */
const FALLBACK = /^claude-(fable-5-1|opus-5|sonnet-5-5)/

const client = (cfg: ProviderConfig) =>
  new Anthropic({ apiKey: cfg.apiKey, dangerouslyAllowBrowser: true, maxRetries: 1, ...(cfg.fetch ? { fetch: cfg.fetch } : {}) })

const textBlock = (text: string | undefined): BetaContentBlockParam[] => (text ? [{ type: 'text', text }] : [])
const imageBlocks = (images: string[] | undefined): BetaContentBlockParam[] =>
  (images ?? []).map((url) => {
    const { mediaType, data } = splitDataUrl(url)
    return { type: 'image', source: { type: 'base64', media_type: mediaType, data } }
  })

export function toAnthropicMessages(messages: ChatMessage[], model: string): BetaMessageParam[] {
  return messages.map((m): BetaMessageParam => {
    switch (m.role) {
      case 'user':
        // Images before text works best for Claude.
        return { role: 'user', content: [...imageBlocks(m.images), ...textBlock(m.text)] }
      case 'assistant': {
        // Replayed verbatim: thinking blocks must come back unchanged.
        if (m.native?.provider === 'anthropic' && m.native.model === model) return { role: 'assistant', content: m.native.data as BetaContentBlockParam[] }
        const calls = (m.toolCalls ?? []).map((c): BetaContentBlockParam => ({ type: 'tool_use', id: c.id, name: c.name, input: c.args ?? {} }))
        return { role: 'assistant', content: [...textBlock(m.text || (calls.length ? '' : '…')), ...calls] }
      }
      case 'tool':
        return {
          role: 'user',
          content: [
            ...m.results.map((r): BetaContentBlockParam => ({ type: 'tool_result', tool_use_id: r.callId, content: r.content, ...(r.isError ? { is_error: true } : {}) })),
            ...textBlock(m.text),
            ...imageBlocks(m.images),
          ],
        }
    }
  })
}

export function anthropicError(e: unknown, model: string): AiError {
  if (e instanceof AiError) return e
  if (e instanceof Anthropic.APIUserAbortError) return aiError('aborted', VENDOR)
  if (e instanceof Anthropic.APIConnectionError) return aiError('network', VENDOR)
  if (e instanceof Anthropic.APIError) {
    const body = e.error as { error?: { type?: string; message?: string } } | undefined
    if (e.status === 529) return aiError('server', VENDOR)
    return httpError(e.status, VENDOR, { code: body?.error?.type, message: body?.error?.message ?? e.message, model })
  }
  if (e instanceof Error && e.name === 'AbortError') return aiError('aborted', VENDOR)
  // Anything else is the SDK failing to parse the stream (e.g. a malformed tool input).
  return aiError('output', VENDOR)
}

export const anthropicProvider: Provider = {
  async turn(cfg: ProviderConfig, req: TurnRequest): Promise<TurnResult> {
    const { model } = req
    try {
      const stream = client(cfg).beta.messages.stream(
        {
          model,
          max_tokens: req.maxOutputTokens ?? 16000,
          system: req.system,
          // Caches the system prompt, tools and history between rounds.
          cache_control: { type: 'ephemeral' },
          messages: toAnthropicMessages(req.messages, model),
          // Forced tool use is rejected by current models, so the prompt asks for the call instead.
          tools: req.tools.map((t): BetaTool => ({ name: t.name, description: t.description, input_schema: t.parameters as BetaTool.InputSchema, strict: true, eager_input_streaming: true })),
          ...(EFFORT.test(model) ? { output_config: { effort: 'low' as const } } : {}),
          ...(FALLBACK.test(model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
        },
        { signal: req.signal },
      )
      if (req.onText) stream.on('text', req.onText)
      const msg = await stream.finalMessage()
      // A refusal can cut a tool call off mid-input: never run that turn's tools.
      if (msg.stop_reason === 'refusal') throw aiError('refusal', VENDOR)
      let text = ''
      const toolCalls: TurnResult['toolCalls'] = []
      for (const b of msg.content) {
        if (b.type === 'text') text += b.text
        else if (b.type === 'tool_use') toolCalls.push({ id: b.id, name: b.name, args: b.input })
      }
      const u = msg.usage
      return {
        text,
        toolCalls,
        stop: msg.stop_reason === 'max_tokens' ? 'max_tokens' : toolCalls.length ? 'tool_use' : 'end',
        usage: { input: u.input_tokens, cachedInput: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0, output: u.output_tokens },
        native: { provider: 'anthropic', model, data: msg.content },
      }
    } catch (e) {
      throw anthropicError(e, model)
    }
  },

  async testKey(cfg, model, signal) {
    try {
      await client(cfg).messages.create(
        { model, max_tokens: 64, messages: [{ role: 'user', content: TEST_PROMPT }], ...(EFFORT.test(model) ? { output_config: { effort: 'low' as const } } : {}) },
        { signal },
      )
    } catch (e) {
      throw anthropicError(e, model)
    }
  },
}
