import type { Usage } from './types'

// List prices in US$ per million tokens (Oct 2026), for the cost hints only:
// the vendor's bill is the truth. Unknown models show no estimate.
// Sources: Anthropic pricing page; OpenAI and Google figures via the team's
// research notes (Gemini 3.8 Flash is an introductory price until 31 Dec 2026).

interface Price {
  input: number
  output: number
  /** Cached input as a fraction of the input price. */
  cached: number
  /** Cache writes as a multiple of the input price. */
  write: number
}

const PRICES: [RegExp, Price][] = [
  [/^gpt-6\.1-terra/, { input: 1, output: 5, cached: 0.05, write: 1.25 }],
  [/^gpt-6\.1-sol/, { input: 2, output: 10, cached: 0.05, write: 1.25 }],
  [/^gpt-6-luna/, { input: 0.1, output: 0.5, cached: 0.1, write: 1.25 }],
  [/^gpt-6-astra/, { input: 10, output: 50, cached: 0.1, write: 1.25 }],
  [/^gemini-3\.8-flash/, { input: 0.75, output: 3.75, cached: 0.1, write: 1 }],
  [/^gemini-4-argon/, { input: 2, output: 10, cached: 0.05, write: 1 }],
  [/^gemini-3\.1-flash-lite/, { input: 0.25, output: 1.5, cached: 0.1, write: 1 }],
  [/^gemini-3\.1-pro/, { input: 2, output: 12, cached: 0.1, write: 1 }],
  [/^claude-sonnet-5/, { input: 2, output: 10, cached: 0.1, write: 1.25 }],
  [/^claude-opus-5-5/, { input: 4, output: 20, cached: 0.1, write: 1.25 }],
  [/^claude-opus-5/, { input: 5, output: 25, cached: 0.1, write: 1.25 }],
  [/^claude-haiku-5-5/, { input: 0.1, output: 0.5, cached: 0.1, write: 1.25 }],
  [/^claude-fable-5/, { input: 10, output: 50, cached: 0.025, write: 1.25 }],
]

const priceOf = (model: string) => PRICES.find(([re]) => re.test(model))?.[1]

/** Estimated cost in US$, or undefined for a model we have no price for. */
export function estimateCost(model: string, u: Usage): number | undefined {
  const p = priceOf(model)
  if (!p) return undefined
  return (u.input * p.input + u.cachedInput * p.input * p.cached + u.cacheWrite * p.input * p.write + u.output * p.output) / 1e6
}

/** A typical request: two rounds, each with a 1024 px preview, the second mostly cached, short replies. */
const TYPICAL: Usage = { input: 9000, cachedInput: 6000, cacheWrite: 0, output: 1500 }

export const typicalCost = (model: string) => estimateCost(model, TYPICAL)

export function formatCost(usd: number): string {
  if (usd < 0.005) return 'under 1¢'
  if (usd < 1) return `≈ ${Math.round(usd * 100)}¢`
  return `≈ $${usd.toFixed(2)}`
}
