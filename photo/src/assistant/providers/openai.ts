import OpenAI from 'openai'
import type { FunctionTool, ResponseInputContent, ResponseInputItem, ResponseReasoningItem } from 'openai/resources/responses/responses'
import { AiError, aiError, httpError } from '../errors'
import { strictSchema } from '../schema'
import type { ChatMessage, Provider, ProviderConfig, TurnRequest, TurnResult } from '../types'
import { parseArgs, TEST_PROMPT } from './shared'

// GPT through the Responses API. OpenAI doesn't document browser (CORS)
// access, so an optional relay URL can stand in for api.openai.com.

const VENDOR = 'OpenAI'
/** Reasoning models: low effort keeps replies fast and cheap. */
const REASONING = /^(gpt-5|gpt-6|o\d)/

const client = (cfg: ProviderConfig) =>
  new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL, dangerouslyAllowBrowser: true, maxRetries: 1, ...(cfg.fetch ? { fetch: cfg.fetch } : {}) })

const userContent = (text: string, images: string[] | undefined): ResponseInputContent[] => [
  ...(images ?? []).map((url): ResponseInputContent => ({ type: 'input_image', image_url: url, detail: 'high' })),
  { type: 'input_text', text },
]

export function toOpenAIInput(messages: ChatMessage[], model: string): ResponseInputItem[] {
  const out: ResponseInputItem[] = []
  for (const m of messages) {
    if (m.role === 'user') out.push({ role: 'user', content: userContent(m.text, m.images) })
    else if (m.role === 'assistant') {
      // Reasoning items (with encrypted content) must precede the calls they led to.
      if (m.native?.provider === 'openai' && m.native.model === model) out.push(...(m.native.data as ResponseInputItem[]))
      else {
        if (m.text) out.push({ role: 'assistant', content: m.text })
        for (const c of m.toolCalls ?? []) out.push({ type: 'function_call', call_id: c.id, name: c.name, arguments: JSON.stringify(c.args ?? {}) })
      }
    } else {
      for (const r of m.results) out.push({ type: 'function_call_output', call_id: r.callId, output: r.content })
      if (m.text || m.images?.length) out.push({ role: 'user', content: userContent(m.text ?? '', m.images) })
    }
  }
  return out
}

export function openaiError(e: unknown, model: string, relay: boolean): AiError {
  if (e instanceof AiError) return e
  if (e instanceof OpenAI.APIUserAbortError) return aiError('aborted', VENDOR)
  // A browser that can't reach the API (or a CORS block) ends up here.
  if (e instanceof OpenAI.APIConnectionError) {
    return typeof navigator !== 'undefined' && navigator.onLine === false ? aiError('network', VENDOR) : aiError('blocked', VENDOR, { relayHint: !relay })
  }
  if (e instanceof OpenAI.APIError) return httpError(e.status, VENDOR, { code: e.code ?? e.type, message: e.message, model })
  if (e instanceof Error && e.name === 'AbortError') return aiError('aborted', VENDOR)
  return aiError('output', VENDOR)
}

export const openaiProvider: Provider = {
  async turn(cfg: ProviderConfig, req: TurnRequest): Promise<TurnResult> {
    const { model } = req
    const reasoning = REASONING.test(model)
    try {
      const stream = client(cfg).responses.stream(
        {
          model,
          instructions: req.system,
          input: toOpenAIInput(req.messages, model),
          tools: req.tools.map((t): FunctionTool => ({ type: 'function', name: t.name, description: t.description, parameters: strictSchema(t.parameters), strict: true })),
          tool_choice: req.toolChoice === 'required' ? 'required' : 'auto',
          parallel_tool_calls: true,
          // Nothing is kept on OpenAI's side; reasoning travels with the request instead.
          store: false,
          ...(reasoning ? { reasoning: { effort: 'low' as const }, include: ['reasoning.encrypted_content' as const] } : {}),
          max_output_tokens: req.maxOutputTokens ?? 16000,
          prompt_cache_key: 'lumen-assistant',
        },
        { signal: req.signal },
      )
      if (req.onText) {
        const onText = req.onText
        stream.on('response.output_text.delta', (e) => onText(e.delta))
      }
      const res = await stream.finalResponse()
      if (res.status === 'failed') throw httpError(undefined, VENDOR, { code: res.error?.code, message: res.error?.message, model })
      if (res.status === 'incomplete' && res.incomplete_details?.reason === 'content_filter') throw aiError('refusal', VENDOR)

      let text = ''
      let refused = false
      const toolCalls: TurnResult['toolCalls'] = []
      const replay: ResponseInputItem[] = []
      for (const item of res.output) {
        if (item.type === 'reasoning') replay.push(item as ResponseReasoningItem)
        else if (item.type === 'message') {
          const said = item.content.map((c) => (c.type === 'output_text' ? c.text : '')).join('')
          refused ||= item.content.some((c) => c.type === 'refusal')
          text += said
          if (said) replay.push({ role: 'assistant', content: said })
        } else if (item.type === 'function_call') {
          toolCalls.push({ id: item.call_id, name: item.name, args: parseArgs(item.arguments) })
          replay.push({ type: 'function_call', call_id: item.call_id, name: item.name, arguments: item.arguments })
        }
      }
      if (refused && !toolCalls.length) throw aiError('refusal', VENDOR)
      const u = res.usage
      const cached = u?.input_tokens_details?.cached_tokens ?? 0
      return {
        text,
        toolCalls,
        stop: res.status === 'incomplete' ? 'max_tokens' : toolCalls.length ? 'tool_use' : 'end',
        usage: { input: (u?.input_tokens ?? 0) - cached, cachedInput: cached, cacheWrite: 0, output: u?.output_tokens ?? 0 },
        native: { provider: 'openai', model, data: replay },
      }
    } catch (e) {
      throw openaiError(e, model, !!cfg.baseURL)
    }
  },

  async testKey(cfg, model, signal) {
    try {
      await client(cfg).responses.create(
        { model, input: TEST_PROMPT, max_output_tokens: 16, store: false, ...(REASONING.test(model) ? { reasoning: { effort: 'low' as const } } : {}) },
        { signal },
      )
    } catch (e) {
      throw openaiError(e, model, !!cfg.baseURL)
    }
  },
}
