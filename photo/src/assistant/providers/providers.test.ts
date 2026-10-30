import { describe, expect, it, vi } from 'vitest'
import { AiError } from '../errors'
import { assistantTools } from '../schema'
import type { ChatMessage, ProviderConfig, TurnRequest } from '../types'
import { anthropicProvider, toAnthropicMessages } from './anthropic'
import { googleProvider, toGeminiContents } from './google'
import { openaiProvider, toOpenAIInput } from './openai'

// The real SDKs run against a mocked fetch that answers in each vendor's
// wire format, so request building and stream parsing are both exercised.

const IMG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
const ARGS = { summary: 'Warmer', why: 'Golden light.', changes: [{ path: 'wb.temp', value: 12 }] }

interface Captured {
  url: string
  headers: Headers
  body: Record<string, unknown>
}

function mockFetch(responses: (() => Response)[]) {
  const calls: Captured[] = []
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : undefined
    const text = req ? await req.text() : typeof init?.body === 'string' ? init.body : ''
    calls.push({ url: req?.url ?? String(input), headers: new Headers(req?.headers ?? init?.headers), body: text ? JSON.parse(text) : {} })
    const next = responses.shift()
    if (!next) throw new Error('unexpected request')
    return next()
  })
  return { fetch: fn as unknown as typeof fetch, calls }
}

const sse = (events: { event?: string; data: unknown }[]) => () =>
  new Response(events.map((e) => `${e.event ? `event: ${e.event}\n` : ''}data: ${JSON.stringify(e.data)}\n\n`).join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => () =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'x-should-retry': 'false', ...headers } })

const request = (model: string, extra: Partial<TurnRequest> = {}): TurnRequest => ({
  model,
  system: 'SYSTEM',
  messages: [{ role: 'user', text: 'Warm it up', images: [IMG] }],
  tools: assistantTools(false),
  ...extra,
})

async function expectAiError(p: Promise<unknown>, kind: AiError['kind']) {
  const e = await p.then(
    () => undefined,
    (err: unknown) => err,
  )
  expect(e).toBeInstanceOf(AiError)
  expect((e as AiError).kind).toBe(kind)
}

// ---------- Anthropic ----------

function anthropicStream(stop = 'tool_use') {
  const ev = (type: string, data: object) => ({ event: type, data: { type, ...data } })
  return sse([
    ev('message_start', {
      message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 900, output_tokens: 1, cache_read_input_tokens: 3000, cache_creation_input_tokens: 100 } },
    }),
    ev('content_block_start', { index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } }),
    ev('content_block_delta', { index: 0, delta: { type: 'signature_delta', signature: 'SIG' } }),
    ev('content_block_stop', { index: 0 }),
    ev('content_block_start', { index: 1, content_block: { type: 'text', text: '' } }),
    ev('content_block_delta', { index: 1, delta: { type: 'text_delta', text: 'Warming ' } }),
    ev('content_block_delta', { index: 1, delta: { type: 'text_delta', text: 'it up.' } }),
    ev('content_block_stop', { index: 1 }),
    ev('content_block_start', { index: 2, content_block: { type: 'tool_use', id: 'toolu_1', name: 'set_adjustments', input: {} } }),
    ev('content_block_delta', { index: 2, delta: { type: 'input_json_delta', partial_json: JSON.stringify(ARGS).slice(0, 20) } }),
    ev('content_block_delta', { index: 2, delta: { type: 'input_json_delta', partial_json: JSON.stringify(ARGS).slice(20) } }),
    ev('content_block_stop', { index: 2 }),
    ev('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 140 } }),
    ev('message_stop', {}),
  ])
}

describe('Anthropic adapter', () => {
  it('sends a browser-safe, strict, cached request and parses the stream', async () => {
    const { fetch, calls } = mockFetch([anthropicStream()])
    const deltas: string[] = []
    const res = await anthropicProvider.turn({ apiKey: 'sk-ant-test', fetch }, request('claude-sonnet-5-5', { onText: (d) => deltas.push(d) }))

    const { url, headers, body } = calls[0]
    expect(url).toMatch(/^https:\/\/api\.anthropic\.com\/v1\/messages/)
    expect(headers.get('authorization')).toBe('Bearer sk-ant-test')
    expect(headers.get('anthropic-dangerous-direct-browser-access')).toBe('true')
    expect(headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01')
    expect(body).toMatchObject({ model: 'claude-sonnet-5-5', stream: true, system: 'SYSTEM', output_config: { effort: 'low' }, fallbacks: 'default', cache_control: { type: 'ephemeral' } })
    expect(body).not.toHaveProperty('thinking')
    expect(body).not.toHaveProperty('tool_choice')
    const tool = (body.tools as Record<string, unknown>[])[0]
    expect(tool).toMatchObject({ name: 'set_adjustments', strict: true, eager_input_streaming: true })
    const content = (body.messages as { content: Record<string, unknown>[] }[])[0].content
    expect(content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: '/9j/4AAQSkZJRg==' } })
    expect(content[1]).toEqual({ type: 'text', text: 'Warm it up' })

    expect(deltas.join('')).toBe('Warming it up.')
    expect(res.text).toBe('Warming it up.')
    expect(res.stop).toBe('tool_use')
    expect(res.toolCalls).toEqual([{ id: 'toolu_1', name: 'set_adjustments', args: ARGS }])
    expect(res.usage).toEqual({ input: 900, cachedInput: 3000, cacheWrite: 100, output: 140 })
  })

  it('replays its own turn verbatim (thinking signature included) and rebuilds others', async () => {
    const { fetch } = mockFetch([anthropicStream()])
    const res = await anthropicProvider.turn({ apiKey: 'k', fetch }, request('claude-sonnet-5-5'))
    const turn: ChatMessage = { role: 'assistant', text: res.text, toolCalls: res.toolCalls, native: res.native }
    const [mine] = toAnthropicMessages([turn], 'claude-sonnet-5-5')
    expect(mine.content).toBe(res.native.data)
    expect(JSON.stringify(mine.content)).toContain('"signature":"SIG"')
    const [other] = toAnthropicMessages([turn], 'claude-opus-5-5')
    expect(other.content).toEqual([
      { type: 'text', text: 'Warming it up.' },
      { type: 'tool_use', id: 'toolu_1', name: 'set_adjustments', input: ARGS },
    ])
    const [results] = toAnthropicMessages([{ role: 'tool', results: [{ callId: 'toolu_1', name: 'set_adjustments', content: 'Bad', isError: true }], text: 'Look', images: [IMG] }], 'm')
    expect((results.content as { type: string }[]).map((b) => b.type)).toEqual(['tool_result', 'text', 'image'])
  })

  it('leaves effort and fallbacks out for models that reject them', async () => {
    const { fetch, calls } = mockFetch([anthropicStream('end_turn')])
    await anthropicProvider.turn({ apiKey: 'k', fetch }, request('claude-haiku-4-5'))
    expect(calls[0].body).not.toHaveProperty('output_config')
    expect(calls[0].body).not.toHaveProperty('fallbacks')
  })

  it('turns a refusal into an error and never runs the tools', async () => {
    const { fetch } = mockFetch([anthropicStream('refusal')])
    await expectAiError(anthropicProvider.turn({ apiKey: 'k', fetch }, request('claude-sonnet-5-5')), 'refusal')
  })

  it('maps API errors', async () => {
    const auth = mockFetch([json(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } })])
    await expectAiError(anthropicProvider.turn({ apiKey: 'bad', fetch: auth.fetch }, request('claude-sonnet-5-5')), 'auth')
    const credit = mockFetch([json(400, { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } })])
    await expectAiError(anthropicProvider.testKey({ apiKey: 'k', fetch: credit.fetch }, 'claude-sonnet-5-5'), 'quota')
    expect(credit.calls[0].body).toMatchObject({ max_tokens: 64, messages: [{ role: 'user', content: 'Reply with OK.' }] })
  })
})

// ---------- OpenAI ----------

function openaiStream(final: 'completed' | 'incomplete' = 'completed', reason?: string) {
  let seq = 0
  const ev = (type: string, data: object) => ({ event: type, data: { type, sequence_number: seq++, ...data } })
  const base = { id: 'resp_1', object: 'response', created_at: 1, model: 'gpt-6.1-terra', status: 'in_progress', output: [], usage: null, error: null, incomplete_details: null }
  const reasoning = { id: 'rs_1', type: 'reasoning', summary: [], encrypted_content: 'ENC' }
  const msgDone = { id: 'msg_1', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Warming it up.', annotations: [] }] }
  const args = JSON.stringify(ARGS)
  const call = { id: 'fc_1', type: 'function_call', call_id: 'call_1', name: 'set_adjustments', arguments: args, status: 'completed' }
  const usage = { input_tokens: 1200, input_tokens_details: { cached_tokens: 200 }, output_tokens: 80, output_tokens_details: { reasoning_tokens: 20 }, total_tokens: 1280 }
  return sse([
    ev('response.created', { response: base }),
    ev('response.output_item.added', { output_index: 0, item: reasoning }),
    ev('response.output_item.done', { output_index: 0, item: reasoning }),
    ev('response.output_item.added', { output_index: 1, item: { ...msgDone, status: 'in_progress', content: [] } }),
    ev('response.content_part.added', { item_id: 'msg_1', output_index: 1, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } }),
    ev('response.output_text.delta', { item_id: 'msg_1', output_index: 1, content_index: 0, delta: 'Warming ', logprobs: [] }),
    ev('response.output_text.delta', { item_id: 'msg_1', output_index: 1, content_index: 0, delta: 'it up.', logprobs: [] }),
    ev('response.output_text.done', { item_id: 'msg_1', output_index: 1, content_index: 0, text: 'Warming it up.', logprobs: [] }),
    ev('response.content_part.done', { item_id: 'msg_1', output_index: 1, content_index: 0, part: msgDone.content[0] }),
    ev('response.output_item.done', { output_index: 1, item: msgDone }),
    ev('response.output_item.added', { output_index: 2, item: { ...call, arguments: '', status: 'in_progress' } }),
    ev('response.function_call_arguments.delta', { item_id: 'fc_1', output_index: 2, delta: args }),
    ev('response.function_call_arguments.done', { item_id: 'fc_1', output_index: 2, arguments: args }),
    ev('response.output_item.done', { output_index: 2, item: call }),
    final === 'completed'
      ? ev('response.completed', { response: { ...base, status: 'completed', output: [reasoning, msgDone, call], usage } })
      : ev('response.incomplete', { response: { ...base, status: 'incomplete', incomplete_details: { reason }, output: [reasoning, msgDone, call], usage } }),
  ])
}

describe('OpenAI adapter', () => {
  it('sends a strict, stateless Responses request and parses the stream', async () => {
    const { fetch, calls } = mockFetch([openaiStream()])
    const deltas: string[] = []
    const res = await openaiProvider.turn({ apiKey: 'sk-test', fetch }, request('gpt-6.1-terra', { onText: (d) => deltas.push(d) }))

    const { url, headers, body } = calls[0]
    expect(url).toBe('https://api.openai.com/v1/responses')
    expect(headers.get('authorization')).toBe('Bearer sk-test')
    expect(body).toMatchObject({ model: 'gpt-6.1-terra', instructions: 'SYSTEM', store: false, stream: true, reasoning: { effort: 'low' }, include: ['reasoning.encrypted_content'], tool_choice: 'auto' })
    const tool = (body.tools as Record<string, unknown>[])[0] as { strict: boolean; parameters: { required: string[]; properties: Record<string, { type: unknown }> } }
    expect(tool.strict).toBe(true)
    expect(tool.parameters.required).toContain('crop')
    expect(tool.parameters.properties.crop.type).toEqual(['object', 'null'])
    const input = body.input as { role: string; content: Record<string, unknown>[] }[]
    expect(input[0].content[0]).toEqual({ type: 'input_image', image_url: IMG, detail: 'high' })
    expect(input[0].content[1]).toEqual({ type: 'input_text', text: 'Warm it up' })

    expect(deltas.join('')).toBe('Warming it up.')
    expect(res.text).toBe('Warming it up.')
    expect(res.toolCalls).toEqual([{ id: 'call_1', name: 'set_adjustments', args: ARGS }])
    expect(res.usage).toEqual({ input: 1000, cachedInput: 200, cacheWrite: 0, output: 80 })
    // Reasoning (with its encrypted content) is replayed before the call it led to.
    expect(toOpenAIInput([{ role: 'assistant', text: res.text, toolCalls: res.toolCalls, native: res.native }], 'gpt-6.1-terra')).toEqual([
      { id: 'rs_1', type: 'reasoning', summary: [], encrypted_content: 'ENC' },
      { role: 'assistant', content: 'Warming it up.' },
      { type: 'function_call', call_id: 'call_1', name: 'set_adjustments', arguments: JSON.stringify(ARGS) },
    ])
  })

  it('sends tool results, then the fresh preview as a user message', () => {
    expect(toOpenAIInput([{ role: 'tool', results: [{ callId: 'call_1', name: 'set_adjustments', content: 'Applied.' }], text: 'Check', images: [IMG] }], 'm')).toEqual([
      { type: 'function_call_output', call_id: 'call_1', output: 'Applied.' },
      { role: 'user', content: [{ type: 'input_image', image_url: IMG, detail: 'high' }, { type: 'input_text', text: 'Check' }] },
    ])
  })

  it('goes through the relay when one is set, and leaves reasoning out for older models', async () => {
    const { fetch, calls } = mockFetch([openaiStream()])
    const cfg: ProviderConfig = { apiKey: 'sk-test', baseURL: 'https://relay.example.com/v1', fetch }
    await openaiProvider.turn(cfg, request('gpt-4.1'))
    expect(calls[0].url).toBe('https://relay.example.com/v1/responses')
    expect(calls[0].body).not.toHaveProperty('reasoning')
    expect(calls[0].body).not.toHaveProperty('include')
  })

  it('maps quota, rate limits, content filtering and blocked browsers', async () => {
    const quota = mockFetch([json(429, { error: { message: 'You exceeded your current quota.', type: 'insufficient_quota', code: 'insufficient_quota' } })])
    await expectAiError(openaiProvider.turn({ apiKey: 'k', fetch: quota.fetch }, request('gpt-6.1-terra')), 'quota')
    const rate = mockFetch([json(429, { error: { message: 'Rate limit reached for requests', type: 'requests', code: 'rate_limit_exceeded' } })])
    await expectAiError(openaiProvider.turn({ apiKey: 'k', fetch: rate.fetch }, request('gpt-6.1-terra')), 'rate')
    const filtered = mockFetch([openaiStream('incomplete', 'content_filter')])
    await expectAiError(openaiProvider.turn({ apiKey: 'k', fetch: filtered.fetch }, request('gpt-6.1-terra')), 'refusal')
    const cors = mockFetch([
      () => {
        throw new TypeError('Failed to fetch')
      },
      () => {
        throw new TypeError('Failed to fetch')
      },
    ])
    const e = await openaiProvider.testKey({ apiKey: 'k', fetch: cors.fetch }, 'gpt-6.1-terra').catch((err: unknown) => err)
    expect(e).toBeInstanceOf(AiError)
    expect((e as AiError).kind).toBe('blocked')
    expect((e as AiError).message).toMatch(/relay URL/)
  })
})

// ---------- Google ----------

function geminiStream(finish = 'STOP') {
  return sse([
    { data: { candidates: [{ content: { role: 'model', parts: [{ text: 'Warming ' }] }, index: 0 }] } },
    { data: { candidates: [{ content: { role: 'model', parts: [{ text: 'it up.' }] }, index: 0 }] } },
    {
      data: {
        candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'set_adjustments', args: ARGS }, thoughtSignature: 'SIG2' }] }, finishReason: finish, index: 0 }],
        usageMetadata: { promptTokenCount: 1500, cachedContentTokenCount: 500, candidatesTokenCount: 60, thoughtsTokenCount: 40, totalTokenCount: 1600 },
      },
    },
  ])
}

describe('Google adapter', () => {
  it('sends a validated function-calling request and keeps thought signatures', async () => {
    const { fetch, calls } = mockFetch([geminiStream()])
    const deltas: string[] = []
    const res = await googleProvider.turn({ apiKey: 'AIza-test', fetch }, request('gemini-3.8-flash', { onText: (d) => deltas.push(d) }))

    const { url, headers, body } = calls[0]
    expect(url).toContain('models/gemini-3.8-flash:streamGenerateContent')
    expect(url).toContain('alt=sse')
    expect(headers.get('x-goog-api-key')).toBe('AIza-test')
    const contents = body.contents as { role: string; parts: Record<string, unknown>[] }[]
    expect(contents[0].parts[0]).toMatchObject({ inlineData: { mimeType: 'image/jpeg', data: '/9j/4AAQSkZJRg==' } })
    expect(contents[0].parts[1]).toEqual({ text: 'Warm it up' })
    expect(JSON.stringify(body.systemInstruction)).toContain('SYSTEM')
    const decl = (body.tools as { functionDeclarations: Record<string, unknown>[] }[])[0].functionDeclarations[0]
    expect(decl.name).toBe('set_adjustments')
    expect(decl.parametersJsonSchema).toBeDefined()
    expect(JSON.stringify(body)).toContain('"mode":"VALIDATED"')
    expect(JSON.stringify(body)).toContain('"thinkingLevel":"LOW"')

    expect(deltas.join('')).toBe('Warming it up.')
    expect(res.toolCalls).toEqual([{ id: 'local-0', name: 'set_adjustments', args: ARGS }])
    expect(res.usage).toEqual({ input: 1000, cachedInput: 500, cacheWrite: 0, output: 100 })
    const [replay] = toGeminiContents([{ role: 'assistant', text: res.text, toolCalls: res.toolCalls, native: res.native }], 'gemini-3.8-flash')
    expect(replay.parts?.at(-1)).toMatchObject({ functionCall: { name: 'set_adjustments' }, thoughtSignature: 'SIG2' })
    // Our own call ids aren't sent back to Gemini.
    const [results] = toGeminiContents([{ role: 'tool', results: [{ callId: 'local-0', name: 'set_adjustments', content: 'Applied.' }], text: 'Check' }], 'm')
    expect(results.parts?.[0]).toEqual({ functionResponse: { name: 'set_adjustments', response: { output: 'Applied.' } } })
  })

  it('maps safety stops and a bad key', async () => {
    const blocked = mockFetch([geminiStream('SAFETY')])
    await expectAiError(googleProvider.turn({ apiKey: 'k', fetch: blocked.fetch }, request('gemini-3.8-flash')), 'refusal')
    const bad = mockFetch([json(400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } })])
    await expectAiError(googleProvider.testKey({ apiKey: 'bad', fetch: bad.fetch }, 'gemini-3.8-flash'), 'auth')
  })
})
