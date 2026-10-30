import type { AiProvider } from '../../state/settings'
import type { Provider } from '../types'

// Each vendor's SDK is loaded only when that vendor is used.

/** Dev builds only: a scripted provider for working on the UI without a key. */
export const devMock = (): boolean => import.meta.env.DEV && typeof localStorage !== 'undefined' && localStorage.getItem('lumen.ai.mock') === '1'

export async function loadProvider(id: AiProvider): Promise<Provider> {
  // `import.meta.env.DEV` is false in production builds, so the mock is never bundled.
  if (import.meta.env.DEV && devMock()) return (await import('./mock')).mockProvider
  switch (id) {
    case 'openai':
      return (await import('./openai')).openaiProvider
    case 'google':
      return (await import('./google')).googleProvider
    case 'anthropic':
      return (await import('./anthropic')).anthropicProvider
  }
}
