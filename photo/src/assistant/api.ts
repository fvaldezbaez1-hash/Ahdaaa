// Public API of the AI assistant module (the presets screen uses these).
import type { PresetData, SourceKind } from '../edit/types'
import { loadSettings } from '../state/settings'
import { AiError, aiError } from './errors'
import { loadPrefs } from './prefs'
import { presetSystemPrompt } from './prompt'
import { devMock, loadProvider } from './providers'
import { modelFor, PROVIDERS } from './providers/meta'
import { CREATE_LOOK, parseAdjustments, PRESET_TOOL, toPresetData, ToolInputError } from './schema'

/** True when the user has turned the AI on and saved a key for the chosen provider. */
export async function aiReady(): Promise<boolean> {
  if (devMock()) return true
  const s = await loadSettings()
  return s.ai.enabled && !!s.ai.keys[s.ai.provider]?.trim()
}

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase())

/**
 * Turn a description ("90s disposable camera") into a look. If `previewDataUrl`
 * is given, the AI can see the photo it will be applied to. Throws `AiError`
 * with a message ready to show.
 */
export async function generatePreset(description: string, opts: { kind: SourceKind; previewDataUrl?: string; signal?: AbortSignal }): Promise<{ name: string; data: PresetData; explanation: string }> {
  const s = await loadSettings()
  const id = s.ai.provider
  const vendor = PROVIDERS[id].vendor
  const apiKey = s.ai.keys[id]?.trim() ?? ''
  if (!devMock() && (!s.ai.enabled || !apiKey)) throw aiError('setup', vendor)
  const want = description.trim().slice(0, 500)
  if (!want) throw new AiError('request', 'Describe the look you want first.')

  const provider = await loadProvider(id).catch(() => {
    throw aiError('network', vendor)
  })
  const kindNote = opts.kind === 'raw' ? 'RAW' : 'JPEG'
  const res = await provider.turn(
    { apiKey, baseURL: id === 'openai' ? (await loadPrefs()).openaiBaseUrl : undefined },
    {
      model: modelFor(id, s.ai.models),
      system: presetSystemPrompt(),
      tools: [PRESET_TOOL],
      toolChoice: 'required',
      maxOutputTokens: 8000,
      signal: opts.signal,
      messages: [
        {
          role: 'user',
          text: `Create a look: ${want}${opts.previewDataUrl ? `\nThe attached ${kindNote} photo is the first one it will be applied to.` : ''}`,
          images: opts.previewDataUrl ? [opts.previewDataUrl] : undefined,
        },
      ],
    },
  )
  const call = res.toolCalls.find((c) => c.name === CREATE_LOOK)
  if (!call) throw new AiError('output', `${vendor} didn't return a look. Try describing it differently.`)
  let parsed
  try {
    parsed = parseAdjustments(call.args, opts.kind, true).value
  } catch (e) {
    if (e instanceof ToolInputError) throw new AiError('output', `${vendor} returned a look Lumen couldn't use. Try again.`)
    throw e
  }
  const data = toPresetData(parsed)
  if (Object.keys(data).length === 0) throw new AiError('output', `${vendor} returned an empty look. Try describing it differently.`)
  return { name: parsed.summary || titleCase(want).slice(0, 40), data, explanation: parsed.why || res.text.trim() }
}
