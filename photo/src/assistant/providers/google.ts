import { ApiError, FunctionCallingConfigMode, GoogleGenAI, PartMediaResolutionLevel, ThinkingLevel, type Content, type Part } from '@google/genai'
import { AiError, aiError, httpError } from '../errors'
import type { ChatMessage, Provider, ProviderConfig, TurnRequest, TurnResult } from '../types'
import { splitDataUrl, TEST_PROMPT } from './shared'

// Gemini through the official SDK (generateContent, which keeps nothing server-side).

const VENDOR = 'Google'
/** Gemini 3+ take a thinking level; 2.x models use budgets and reject it. */
const THINKING_LEVEL = /^gemini-(3|4)|^gemini-(flash|flash-lite|pro)-latest$/
/** Gemini may omit call ids; ours carry this prefix and aren't sent back. */
const LOCAL_ID = 'local-'
const BLOCKED = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION', 'IMAGE_SAFETY', 'IMAGE_PROHIBITED_CONTENT', 'IMAGE_RECITATION'])
const MALFORMED = new Set(['MALFORMED_FUNCTION_CALL', 'UNEXPECTED_TOOL_CALL'])

const client = (cfg: ProviderConfig) => new GoogleGenAI({ apiKey: cfg.apiKey, ...(cfg.fetch ? { httpOptions: { fetch: cfg.fetch } } : {}) })

const imageParts = (images: string[] | undefined): Part[] =>
  (images ?? []).map((url) => {
    const { mediaType, data } = splitDataUrl(url)
    // "High" caps a 1024 px preview at ~1,120 tokens.
    return { inlineData: { mimeType: mediaType, data }, mediaResolution: { level: PartMediaResolutionLevel.MEDIA_RESOLUTION_HIGH } }
  })

export function toGeminiContents(messages: ChatMessage[], model: string): Content[] {
  return messages.map((m): Content => {
    switch (m.role) {
      case 'user':
        return { role: 'user', parts: [...imageParts(m.images), { text: m.text }] }
      case 'assistant':
        // Replayed verbatim: thought signatures must come back on the parts they arrived with.
        if (m.native?.provider === 'google' && m.native.model === model) return m.native.data as Content
        return {
          role: 'model',
          parts: [
            ...(m.text ? [{ text: m.text }] : []),
            ...(m.toolCalls ?? []).map((c): Part => ({ functionCall: { ...(c.id.startsWith(LOCAL_ID) ? {} : { id: c.id }), name: c.name, args: (c.args ?? {}) as Record<string, unknown> } })),
          ],
        }
      case 'tool':
        return {
          role: 'user',
          parts: [
            ...m.results.map((r): Part => ({
              functionResponse: { ...(r.callId.startsWith(LOCAL_ID) ? {} : { id: r.callId }), name: r.name, response: r.isError ? { error: r.content } : { output: r.content } },
            })),
            ...(m.text ? [{ text: m.text }] : []),
            ...imageParts(m.images),
          ],
        }
    }
  })
}

export function googleError(e: unknown, model: string): AiError {
  if (e instanceof AiError) return e
  if (e instanceof Error && e.name === 'AbortError') return aiError('aborted', VENDOR)
  if (e instanceof ApiError) return httpError(e.status, VENDOR, { message: e.message, model })
  // fetch() itself failed: offline or blocked.
  if (e instanceof TypeError) return aiError('network', VENDOR)
  return aiError('output', VENDOR)
}

export const googleProvider: Provider = {
  async turn(cfg: ProviderConfig, req: TurnRequest): Promise<TurnResult> {
    const { model } = req
    try {
      const stream = await client(cfg).models.generateContentStream({
        model,
        contents: toGeminiContents(req.messages, model),
        config: {
          systemInstruction: req.system,
          tools: [{ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.parameters })) }],
          // VALIDATED keeps calls schema-valid without forcing one.
          toolConfig: { functionCallingConfig: { mode: req.toolChoice === 'required' ? FunctionCallingConfigMode.ANY : FunctionCallingConfigMode.VALIDATED } },
          ...(THINKING_LEVEL.test(model) ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {}),
          maxOutputTokens: req.maxOutputTokens ?? 16000,
          abortSignal: req.signal,
        },
      })
      let text = ''
      let finish: string | undefined
      let usage: TurnResult['usage'] = { input: 0, cachedInput: 0, cacheWrite: 0, output: 0 }
      const parts: Part[] = []
      const toolCalls: TurnResult['toolCalls'] = []
      for await (const chunk of stream) {
        if (chunk.promptFeedback?.blockReason) throw aiError('refusal', VENDOR)
        const cand = chunk.candidates?.[0]
        for (const part of cand?.content?.parts ?? []) {
          parts.push(part)
          if (part.text && !part.thought) {
            text += part.text
            req.onText?.(part.text)
          }
          if (part.functionCall?.name) {
            toolCalls.push({ id: part.functionCall.id ?? `${LOCAL_ID}${toolCalls.length}`, name: part.functionCall.name, args: part.functionCall.args ?? {} })
          }
        }
        if (cand?.finishReason) finish = cand.finishReason
        const u = chunk.usageMetadata
        if (u) {
          const cached = u.cachedContentTokenCount ?? 0
          usage = { input: (u.promptTokenCount ?? 0) - cached, cachedInput: cached, cacheWrite: 0, output: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) }
        }
      }
      if (finish && BLOCKED.has(finish)) throw aiError('refusal', VENDOR)
      if (finish && MALFORMED.has(finish)) throw aiError('output', VENDOR)
      return {
        text,
        toolCalls,
        stop: finish === 'MAX_TOKENS' ? 'max_tokens' : toolCalls.length ? 'tool_use' : 'end',
        usage,
        native: { provider: 'google', model, data: { role: 'model', parts } satisfies Content },
      }
    } catch (e) {
      throw googleError(e, model)
    }
  },

  async testKey(cfg, model, signal) {
    try {
      await client(cfg).models.generateContent({
        model,
        contents: TEST_PROMPT,
        config: { maxOutputTokens: 16, abortSignal: signal, ...(THINKING_LEVEL.test(model) ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {}) },
      })
    } catch (e) {
      throw googleError(e, model)
    }
  },
}
