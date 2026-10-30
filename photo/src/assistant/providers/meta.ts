import type { AiProvider } from '../../state/settings'

// What the UI needs to know about each vendor, without loading its SDK.

export interface ProviderInfo {
  id: AiProvider
  /** Company name, used in sentences ("sent to OpenAI"). */
  vendor: string
  /** Picker label. */
  label: string
  /** Strong vision + tool-use model at a sensible price (the team's research picks; a bake-off will settle them). The user can override it. */
  defaultModel: string
  /** Suggestions for the model field. */
  models: string[]
  keyUrl: string
  keyPlaceholder: string
}

export const PROVIDERS: Record<AiProvider, ProviderInfo> = {
  openai: {
    id: 'openai',
    vendor: 'OpenAI',
    label: 'OpenAI · GPT',
    defaultModel: 'gpt-6.1-terra',
    models: ['gpt-6.1-terra', 'gpt-6.1-sol'],
    keyUrl: 'https://platform.openai.com/api-keys',
    keyPlaceholder: 'sk-…',
  },
  google: {
    id: 'google',
    vendor: 'Google',
    label: 'Google · Gemini',
    defaultModel: 'gemini-3.8-flash',
    models: ['gemini-3.8-flash', 'gemini-3.1-pro-preview', 'gemini-3.1-flash-lite'],
    keyUrl: 'https://aistudio.google.com/apikey',
    keyPlaceholder: 'AIza…',
  },
  anthropic: {
    id: 'anthropic',
    vendor: 'Anthropic',
    label: 'Anthropic · Claude',
    defaultModel: 'claude-sonnet-5-5',
    models: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'],
    keyUrl: 'https://platform.claude.com/settings/keys',
    keyPlaceholder: 'sk-ant-…',
  },
}

export const PROVIDER_IDS: AiProvider[] = ['openai', 'google', 'anthropic']

export const modelFor = (id: AiProvider, models: Partial<Record<AiProvider, string>>) => models[id]?.trim() || PROVIDERS[id].defaultModel
