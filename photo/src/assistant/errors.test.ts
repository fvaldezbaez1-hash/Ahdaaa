import { describe, expect, it } from 'vitest'
import { aiError, httpError, redact } from './errors'
import { cleanRelayUrl } from './prefs'
import { estimateCost, formatCost } from './pricing'

describe('httpError', () => {
  const kind = (status: number | undefined, info: Parameters<typeof httpError>[2] = {}) => httpError(status, 'Vendor', info).kind
  it('maps statuses and vendor codes to what the user can do', () => {
    expect(kind(401)).toBe('auth')
    expect(kind(400, { message: 'API key not valid. Please pass a valid API key.' })).toBe('auth')
    expect(kind(403)).toBe('auth')
    expect(kind(404, { model: 'gpt-x' })).toBe('model')
    expect(kind(400, { message: 'The model `gpt-x` does not exist' })).toBe('model')
    expect(kind(429)).toBe('rate')
    expect(kind(429, { code: 'insufficient_quota', message: 'You exceeded your current quota' })).toBe('quota')
    expect(kind(400, { code: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' })).toBe('quota')
    expect(kind(402, { code: 'billing_error' })).toBe('quota')
    expect(kind(500)).toBe('server')
    expect(kind(503)).toBe('server')
    expect(kind(400, { message: 'messages: text content blocks must be non-empty' })).toBe('request')
  })
  it('names the model and never echoes a key', () => {
    expect(httpError(404, 'OpenAI', { model: 'gpt-x' }).message).toContain('“gpt-x”')
    const e = httpError(400, 'OpenAI', { message: 'Bad thing with key sk-proj-abcdef1234567890 and AIzaSyA1234567890abcdefgh' })
    expect(e.message).not.toMatch(/sk-proj-abcdef|AIzaSyA123/)
    expect(e.message).toContain('[key]')
  })
  it('suggests the relay only when OpenAI is unreachable without one', () => {
    expect(aiError('blocked', 'OpenAI', { relayHint: true }).message).toMatch(/relay URL/)
    expect(aiError('blocked', 'OpenAI').message).not.toMatch(/relay/)
  })
  it('shortens long vendor messages', () => {
    expect(redact('x'.repeat(500)).length).toBe(160)
  })
})

describe('relay URL', () => {
  it('accepts https (and http on localhost) only', () => {
    expect(cleanRelayUrl(' https://relay.example.com/v1/ ')).toBe('https://relay.example.com/v1')
    expect(cleanRelayUrl('http://localhost:8787/v1')).toBe('http://localhost:8787/v1')
    expect(cleanRelayUrl('http://relay.example.com')).toBeUndefined()
    expect(cleanRelayUrl('https://user:pw@relay.example.com')).toBeUndefined()
    expect(cleanRelayUrl('not a url')).toBeUndefined()
    expect(cleanRelayUrl('')).toBeUndefined()
  })
})

describe('cost estimates', () => {
  it('prices known models and skips unknown ones', () => {
    const u = { input: 1_000_000, cachedInput: 1_000_000, cacheWrite: 0, output: 100_000 }
    expect(estimateCost('gpt-6.1-terra', u)).toBeCloseTo(1 + 0.05 + 0.5)
    expect(estimateCost('claude-sonnet-5-5', { ...u, cacheWrite: 1_000_000 })).toBeCloseTo(2 + 0.2 + 2.5 + 1)
    expect(estimateCost('some-new-model', u)).toBeUndefined()
    expect(formatCost(0.001)).toBe('under 1¢')
    expect(formatCost(0.018)).toBe('≈ 2¢')
    expect(formatCost(1.234)).toBe('≈ $1.23')
  })
})
