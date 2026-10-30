import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultRecipe } from '../edit/defaults'
import { editor } from '../state/editor'
import { updateSettings } from '../state/settings'
import { aiReady, generatePreset } from './api'
import { chat, condense, type AssistantTurn } from './chat'
import { AiError, aiError } from './errors'
import type { Provider, TurnRequest, TurnResult } from './types'

vi.mock('../io/api', () => ({ previewJpeg: vi.fn(async () => ({ dataUrl: 'data:image/jpeg;base64,AAAA', width: 1024, height: 683 })) }))

const turns: (Partial<TurnResult> | Error)[] = []
const requests: TurnRequest[] = []
const fake: Provider = {
  async turn(_cfg, req) {
    requests.push(req)
    const t = turns.shift()
    if (!t) throw new Error('no scripted turn')
    if (t instanceof Error) throw t
    return { text: '', toolCalls: [], stop: 'end', usage: { input: 1000, cachedInput: 0, cacheWrite: 0, output: 100 }, native: { provider: 'mock', model: 'm', data: null }, ...t }
  },
  async testKey() {},
}
vi.mock('./providers', () => ({ devMock: () => false, loadProvider: async () => fake }))

const edit = (changes: [string, number][], name = 'set_adjustments', extra: object = {}) => ({
  id: 'c1',
  name,
  args: { summary: 'Brighter', why: 'Light helps.', changes: changes.map(([path, value]) => ({ path, value })), ...extra },
})
const reply = (photoId: string) => chat.get(photoId).turns.at(-1) as AssistantTurn

beforeEach(async () => {
  turns.length = 0
  requests.length = 0
  await updateSettings({ ai: { enabled: true, provider: 'openai', keys: { openai: 'sk-test' }, models: {} } })
  editor.open('p1', defaultRecipe('display'), 'display')
  chat.clear('p1')
})

describe('chat', () => {
  it('shows the reply, the change card and the cost', async () => {
    turns.push({ toolCalls: [edit([['basic.exposure', 0.3]])] }, { text: 'Brighter now.' })
    await chat.send('p1', '  Brighten it  ')
    const [user, ai] = chat.get('p1').turns
    expect(user).toMatchObject({ role: 'user', text: 'Brighten it' })
    expect(ai).toMatchObject({ role: 'assistant', text: 'Brighter now.', pending: false, ask: 'Brighten it' })
    if (ai.role !== 'assistant') return
    expect(ai.edit?.status).toBe('open')
    expect(ai.edit?.diff.map((i) => i.path)).toEqual(['basic.exposure'])
    expect(ai.cost).toBeGreaterThan(0)
    expect(chat.get('p1').busy).toBe(false)
    expect(requests[0].model).toBe('gpt-6.1-terra')
  })

  it('undoes with the editor while the edit is the latest step', async () => {
    turns.push({ toolCalls: [edit([['basic.exposure', 0.3]])] }, { text: 'Done.' })
    await chat.send('p1', 'Brighten')
    chat.undo('p1', reply('p1').id)
    expect(editor.getState().recipe?.basic.exposure).toBe(0)
    expect(editor.getState().history[0].label).toBe('Undo')
    expect(reply('p1').edit?.status).toBe('undone')
  })

  it('reverts only the AI’s values after later manual edits', async () => {
    turns.push({ toolCalls: [edit([['basic.exposure', 0.3], ['basic.contrast', 15]])] }, { text: 'Done.' })
    await chat.send('p1', 'Pop')
    editor.apply((r) => ({ ...r, basic: { ...r.basic, contrast: 40, clarity: 10 } }), 'Contrast')
    chat.undo('p1', reply('p1').id)
    const b = editor.getState().recipe?.basic
    expect(b).toMatchObject({ exposure: 0, contrast: 40, clarity: 10 })
    expect(editor.getState().history[0].label).toBe('Undo AI · Brighter')
  })

  it('remembers earlier turns as text, including what happened to edits', async () => {
    turns.push({ toolCalls: [edit([['basic.exposure', 0.3]])] }, { text: 'Brighter.' })
    await chat.send('p1', 'Brighten')
    chat.undo('p1', reply('p1').id)
    turns.push({ text: 'Okay.' })
    await chat.send('p1', 'Thanks')
    const history = requests.at(-1)?.messages.slice(0, 2)
    expect(history).toEqual([
      { role: 'user', text: 'Brighten' },
      { role: 'assistant', text: 'Brighter.\n[Changed: Exposure 0.00 → +0.30. The user undid this edit.]' },
    ])
    expect(condense(chat.get('p1').turns).every((m) => m.role !== 'user' || !('images' in m))).toBe(true)
  })

  it('shows friendly errors and asks for setup without a key', async () => {
    turns.push(aiError('rate', 'OpenAI'))
    await chat.send('p1', 'Pop')
    expect(reply('p1').error).toMatchObject({ kind: 'rate', message: expect.stringMatching(/OpenAI is limiting requests/) })

    await updateSettings((s) => ({ ai: { ...s.ai, keys: {} } }))
    await chat.send('p1', 'Pop')
    expect(reply('p1').error?.kind).toBe('setup')
    expect(await aiReady()).toBe(false)
  })

  it('drops the partial text of a refused answer', async () => {
    turns.push(new AiError('refusal', 'OpenAI declined this request.'))
    await chat.send('p1', 'Something odd')
    expect(reply('p1')).toMatchObject({ text: '', error: { kind: 'refusal' } })
  })
})

describe('generatePreset', () => {
  it('returns a validated, clamped look', async () => {
    turns.push({
      toolCalls: [{ id: 'l1', name: 'create_look', args: { name: 'Night Teal', why: 'Cool shadows, warm lights.', changes: [{ path: 'wb.temp', value: -400 }, { path: 'grading.shadows.hue', value: 200 }, { path: 'basic.contrast', value: 500 }], curves: null } }],
    })
    const out = await generatePreset('cinematic night', { kind: 'raw', previewDataUrl: 'data:image/jpeg;base64,BBBB' })
    expect(out).toEqual({
      name: 'Night Teal',
      explanation: 'Cool shadows, warm lights.',
      data: { wbShift: { temp: -100, tint: 0 }, grading: { shadows: { hue: 200, sat: 0, lum: 0 } }, basic: { contrast: 100 } },
    })
    const req = requests[0]
    expect(req.tools.map((t) => t.name)).toEqual(['create_look'])
    expect(req.toolChoice).toBe('required')
    const msg = req.messages[0]
    expect(msg.role === 'user' && msg.images).toEqual(['data:image/jpeg;base64,BBBB'])
    expect(msg.role === 'user' && msg.text).toMatch(/^Create a look: cinematic night/)
  })

  it('fails clearly when no usable look comes back', async () => {
    turns.push({ text: 'Here is an idea…' })
    await expect(generatePreset('dreamy', { kind: 'display' })).rejects.toThrow(/didn't return a look/)
    turns.push({ toolCalls: [{ id: 'l2', name: 'create_look', args: { name: 'Empty', why: '', changes: [] } }] })
    await expect(generatePreset('dreamy', { kind: 'display' })).rejects.toThrow(/empty look/)
    await expect(generatePreset('   ', { kind: 'display' })).rejects.toThrow(/Describe the look/)
  })
})
