import { aiError } from '../errors'
import { CREATE_LOOK, SET_ADJUSTMENTS } from '../schema'
import type { ChatMessage, Provider, ToolCall, TurnRequest, TurnResult } from '../types'

// DEVELOPMENT ONLY (never bundled in production builds): a scripted
// "model" so the panel can be exercised and screenshotted without an API key.
// Enable with localStorage['lumen.ai.mock'] = '1' in a dev build.

interface Script {
  match: RegExp
  intro: string
  done: string
  args?: Record<string, unknown>
}

const SCRIPTS: Script[] = [
  {
    match: /improve|wrong|feedback|what would/i,
    intro: 'The exposure is close, but the highlights in the sky are near clipping and the shadows are a little heavy. The colors lean slightly cool. I’d recover the highlights, open the shadows a touch and warm it up a little. Want me to do that?',
    done: '',
  },
  {
    match: /pop|punch|vivid/i,
    intro: 'I’ll add contrast and richer color without going neon.',
    done: 'Done. More contrast and local detail, richer color, and the highlights stay safe.',
    args: { summary: 'More pop', why: 'Vibrance boosts dull colors more than strong ones, so skin and sky stay natural while the rest gets richer. Clarity adds mid-tone contrast, which reads as crisp.', changes: [{ path: 'basic.contrast', value: 18 }, { path: 'basic.clarity', value: 14 }, { path: 'basic.vibrance', value: 24 }, { path: 'basic.highlights', value: -22 }, { path: 'basic.blacks', value: -8 }] },
  },
  {
    match: /golden|warm/i,
    intro: 'Going for low, warm, soft light.',
    done: 'Here’s a warm golden-hour version: warmer light, softer highlights and a gentle vignette to frame the subject.',
    args: { summary: 'Golden hour', why: 'Golden hour is low, warm, soft light. Temperature and Tint copy its color; lowering Highlights keeps bright areas from blowing out, and the vignette darkens the edges like a low sun does.', changes: [{ path: 'wb.temp', value: 22 }, { path: 'wb.tint', value: 6 }, { path: 'basic.highlights', value: -28 }, { path: 'basic.shadows', value: 12 }, { path: 'basic.vibrance', value: 12 }, { path: 'effects.vignette', value: -14 }] },
  },
  {
    match: /mood|dark|drama/i,
    intro: 'Darker and calmer, with deeper shadows.',
    done: 'Made it moodier: lower exposure, deeper shadows, muted color and darker edges. Masks for darkening just the sky are coming soon.',
    args: { summary: 'Moodier', why: 'Mood comes from what you hide. Lower exposure and blacks deepen the shadows, less saturation calms the color, and a vignette pulls the eye inward.', changes: [{ path: 'basic.exposure', value: -0.35 }, { path: 'basic.contrast', value: 12 }, { path: 'basic.blacks', value: -14 }, { path: 'basic.saturation', value: -12 }, { path: 'effects.vignette', value: -22 }] },
  },
  {
    match: /black|b&w|mono/i,
    intro: 'Converting to black & white with strong tonal separation.',
    done: 'Black & white with strong contrast; blue skies go darker so bright subjects stand out.',
    args: { summary: 'Black & white', why: 'In black and white, contrast between shapes matters most. Darkening blues deepens the sky; lifting oranges keeps skin luminous.', treatment: 'bw', changes: [{ path: 'basic.contrast', value: 28 }, { path: 'mixer.bw.blue', value: -30 }, { path: 'mixer.bw.orange', value: 15 }] },
  },
  {
    match: /white balance|cast/i,
    intro: 'There’s a slight blue-green cast.',
    done: 'Neutralized the cast: a touch warmer and a little more magenta. Whites now read white.',
    args: { summary: 'Fix white balance', why: 'A cool, green cast comes from the light source. Warming and adding a bit of magenta cancels it, so neutral surfaces read neutral.', changes: [{ path: 'wb.temp', value: 9 }, { path: 'wb.tint', value: 5 }] },
  },
  {
    match: /straight|horizon|tilt/i,
    intro: 'The horizon tilts slightly to the left.',
    done: 'Leveled the horizon by 1.4°.',
    args: { summary: 'Straighten', why: 'A level horizon feels calm and intentional; even a one-degree tilt reads as a mistake.', changes: [{ path: 'geometry.angle', value: 1.4 }] },
  },
  {
    match: /skin|portrait/i,
    intro: 'Keeping skin natural.',
    done: 'Softer, more natural skin: slightly less orange saturation, a bit brighter, less texture.',
    args: { summary: 'Natural skin', why: 'Skin lives mostly in the orange band. Lowering its saturation a little and lifting its luminance evens out redness; a touch less texture softens without blurring.', changes: [{ path: 'mixer.sat.orange', value: -8 }, { path: 'mixer.lum.orange', value: 8 }, { path: 'basic.texture', value: -10 }] },
  },
]

const FALLBACK: Script = {
  match: /./,
  intro: 'A gentle, balanced improvement.',
  done: 'A gentle lift: slightly brighter, recovered highlights and a bit more depth.',
  args: { summary: 'Gentle lift', why: 'Small moves in exposure, highlights and contrast add polish without changing the character of the photo.', changes: [{ path: 'basic.exposure', value: 0.15 }, { path: 'basic.highlights', value: -18 }, { path: 'basic.contrast', value: 8 }] },
}

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(aiError('aborted', 'Mock'))
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => (clearTimeout(t), reject(aiError('aborted', 'Mock'))), { once: true })
  })

async function speak(text: string, req: TurnRequest) {
  for (const word of text.match(/\S+\s*/g) ?? []) {
    await wait(18, req.signal)
    req.onText?.(word)
  }
}

const lastUserText = (messages: ChatMessage[]) => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'user') return m.text.split('\n---')[0]
  }
  return ''
}

const usage = { input: 6200, cachedInput: 0, cacheWrite: 0, output: 380 }

export const mockProvider: Provider = {
  async turn(_cfg, req): Promise<TurnResult> {
    await wait(500, req.signal)
    const native = { provider: 'mock' as const, model: req.model, data: null }
    const ask = lastUserText(req.messages)
    const script = SCRIPTS.find((s) => s.match.test(ask)) ?? FALLBACK
    if (req.tools.some((t) => t.name === CREATE_LOOK)) {
      const call: ToolCall = { id: 'mock-look', name: CREATE_LOOK, args: { name: 'Mock Look', ...script.args } }
      return { text: '', toolCalls: [call], stop: 'tool_use', usage, native }
    }
    if (req.messages[req.messages.length - 1].role === 'tool') {
      await speak(script.done, req)
      return { text: script.done, toolCalls: [], stop: 'end', usage: { ...usage, cachedInput: 6000 }, native }
    }
    await speak(script.intro, req)
    const toolCalls: ToolCall[] = script.args ? [{ id: `mock-${Date.now()}`, name: SET_ADJUSTMENTS, args: script.args }] : []
    return { text: script.intro, toolCalls, stop: toolCalls.length ? 'tool_use' : 'end', usage, native }
  },

  async testKey(_cfg, _model, signal) {
    await wait(400, signal)
  },
}
