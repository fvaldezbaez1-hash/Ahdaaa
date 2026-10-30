import type { AiProvider } from '../state/settings'

// The vendor-neutral conversation the agent loop works with. Each provider
// adapter translates it to its own API and back.

export interface ToolCall {
  id: string
  name: string
  /** Parsed JSON arguments, not yet validated. */
  args: unknown
}

export interface ToolResult {
  callId: string
  name: string
  content: string
  isError?: boolean
}

/**
 * The provider's own record of an assistant turn. Replayed verbatim to the same
 * provider and model, because thinking blocks, reasoning items and thought
 * signatures must round-trip unchanged within a tool-use loop.
 */
export interface NativeTurn {
  provider: AiProvider | 'mock'
  model: string
  data: unknown
}

export type ChatMessage =
  /** `images` are JPEG data URLs. */
  | { role: 'user'; text: string; images?: string[] }
  | { role: 'assistant'; text: string; toolCalls?: ToolCall[]; native?: NativeTurn }
  /** Tool results, optionally followed by a note and a fresh preview. */
  | { role: 'tool'; results: ToolResult[]; text?: string; images?: string[] }

export type JsonSchema = Record<string, unknown>

export interface ToolSpec {
  name: string
  description: string
  /** Canonical JSON schema: optional properties are simply not `required`. */
  parameters: JsonSchema
}

export interface Usage {
  /** Uncached input tokens. */
  input: number
  cachedInput: number
  cacheWrite: number
  /** Includes reasoning / thinking tokens. */
  output: number
}

export const NO_USAGE: Usage = { input: 0, cachedInput: 0, cacheWrite: 0, output: 0 }

export function addUsage(a: Usage, b: Usage): Usage {
  return { input: a.input + b.input, cachedInput: a.cachedInput + b.cachedInput, cacheWrite: a.cacheWrite + b.cacheWrite, output: a.output + b.output }
}

export interface TurnRequest {
  model: string
  system: string
  messages: ChatMessage[]
  tools: ToolSpec[]
  /** 'required' forces a tool call where the vendor allows it; otherwise the prompt has to ask for one. */
  toolChoice?: 'auto' | 'required'
  maxOutputTokens?: number
  signal?: AbortSignal
  onText?: (delta: string) => void
}

export interface TurnResult {
  text: string
  toolCalls: ToolCall[]
  stop: 'end' | 'tool_use' | 'max_tokens'
  usage: Usage
  native: NativeTurn
}

export interface ProviderConfig {
  apiKey: string
  /** OpenAI only: a relay that forwards to api.openai.com. */
  baseURL?: string
  /** Injected in tests. */
  fetch?: typeof fetch
}

export interface Provider {
  /** One model call. Throws `AiError` (refusals included). */
  turn(cfg: ProviderConfig, req: TurnRequest): Promise<TurnResult>
  /** The smallest real request: proves the key, the model id and billing. */
  testKey(cfg: ProviderConfig, model: string, signal?: AbortSignal): Promise<void>
}
