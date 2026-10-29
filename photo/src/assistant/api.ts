// Public API of the AI assistant module. OWNER: assistant agent — replace the
// stub bodies; keep these signatures (presets import them).
import type { PresetData, SourceKind } from '../edit/types'

/** True when the user has turned the AI on and saved a key for the chosen provider. */
export async function aiReady(): Promise<boolean> {
  return false
}

/**
 * Turn a description ("90s disposable camera") into a look. If `previewDataUrl`
 * is given, the AI can see the photo it will be applied to.
 */
export async function generatePreset(_description: string, _opts: { kind: SourceKind; previewDataUrl?: string; signal?: AbortSignal }): Promise<{ name: string; data: PresetData; explanation: string }> {
  throw new Error('AI is not set up yet')
}
