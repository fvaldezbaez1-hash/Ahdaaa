import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultRecipe } from '../edit/defaults'
import { editor } from '../state/editor'
import { MAX_ROUNDS, runAgent, type AgentEdit, type AgentOptions } from './agent'
import { AiError } from './errors'
import type { ChatMessage, Provider, TurnRequest, TurnResult } from './types'

const IMG = 'data:image/jpeg;base64,AAAA'
vi.mock('../io/api', () => ({ previewJpeg: vi.fn(async () => ({ dataUrl: IMG, width: 1024, height: 683 })) }))

type Step = Partial<TurnResult> | (() => never)
const usage = { input: 100, cachedInput: 0, cacheWrite: 0, output: 10 }

/** A provider that plays back scripted turns and records what it was sent. */
function scripted(steps: Step[]) {
  const seen: ChatMessage[][] = []
  const provider: Provider = {
    async turn(_cfg, req: TurnRequest) {
      seen.push(structuredClone(req.messages))
      const step = steps.shift()
      if (!step) throw new Error('no more steps')
      if (typeof step === 'function') step()
      const s = step as Partial<TurnResult>
      if (s.text) req.onText?.(s.text)
      return { text: '', toolCalls: [], stop: s.toolCalls?.length ? 'tool_use' : 'end', usage, native: { provider: 'mock', model: 'm', data: null }, ...s }
    },
    async testKey() {},
  }
  return { provider, seen }
}

const call = (args: object, name = 'set_adjustments') => ({ id: `c${Math.random()}`, name, args })
const set = (summary: string, changes: [string, number][]) => call({ summary, why: `${summary} because.`, changes: changes.map(([path, value]) => ({ path, value })) })

function run(provider: Provider, extra: Partial<AgentOptions> = {}) {
  const edits: AgentEdit[] = []
  let text = ''
  const promise = runAgent({
    provider,
    cfg: { apiKey: 'k' },
    vendor: 'Test',
    model: 'm',
    photoId: 'p1',
    history: [],
    userText: 'Warm it up',
    signal: new AbortController().signal,
    hooks: { onText: (d) => (text += d), onTextReset: (n) => (text = text.slice(0, text.length - n)), onPhase: () => {}, onEdit: (e) => edits.push(e) },
    ...extra,
  })
  return { promise, edits, text: () => text }
}

beforeEach(() => {
  editor.open('p1', defaultRecipe('display'), 'display')
})

describe('runAgent', () => {
  it('applies a refined edit as ONE undo step and shows the model the result', async () => {
    const { provider, seen } = scripted([
      { text: 'Warming it.', toolCalls: [set('Warmer', [['wb.temp', 30], ['basic.exposure', 0.4]])] },
      { toolCalls: [set('Less warm', [['wb.temp', 18]])] },
      { text: 'Done: warmer and a touch brighter.' },
    ])
    const r = run(provider)
    const res = await r.promise
    expect(res.rounds).toBe(3)
    expect(res.text).toBe('Warming it.\n\nDone: warmer and a touch brighter.')
    expect(r.text()).toBe(res.text)

    const st = editor.getState()
    expect(st.recipe?.wb).toMatchObject({ temp: 18, preset: 'custom' })
    expect(st.recipe?.basic.exposure).toBe(0.4)
    expect(st.history.map((h) => h.label)).toEqual(['AI · Warmer', 'Opened'])

    expect(r.edits).toHaveLength(1)
    const e = r.edits[0]
    expect(e.summary).toBe('Warmer')
    expect(e.versionAfter).toBe(st.version)
    expect(e.diff.filter((i) => !i.hidden).map((i) => `${i.label} ${i.fromText}→${i.toText}`)).toEqual(['Temperature 0→+18', 'Exposure 0.00→+0.40'])
    expect(e.why).toBe('Warmer because. Less warm because.')

    // First request: the photo and the settings; later rounds: results plus a fresh preview.
    const first = seen[0][0]
    expect(first.role === 'user' && first.images).toEqual([IMG])
    expect(first.role === 'user' && first.text).toMatch(/^Warm it up\n---\nCurrent settings: profile=color/)
    const tool = seen[1][2]
    expect(tool.role).toBe('tool')
    if (tool.role !== 'tool') return
    expect(tool.results[0].content).toMatch(/^Applied\. Settings now: .*wb\.temp=30/)
    expect(tool.images).toEqual([IMG])

    editor.undo()
    expect(editor.getState().recipe).toEqual(defaultRecipe('display'))
  })

  it(`stops after ${MAX_ROUNDS} rounds`, async () => {
    const { provider, seen } = scripted([
      { toolCalls: [set('A', [['basic.contrast', 10]])] },
      { toolCalls: [set('B', [['basic.contrast', 20]])] },
      { toolCalls: [set('C', [['basic.contrast', 30]])] },
      { text: 'never asked' },
    ])
    const r = run(provider)
    await r.promise
    expect(seen).toHaveLength(MAX_ROUNDS)
    expect(editor.getState().recipe?.basic.contrast).toBe(30)
    expect(editor.getState().history[0].label).toBe('AI · A')
    // The last check tells the model it can't change anything more.
    const lastTool = seen[2].at(-1)
    expect(lastTool?.role === 'tool' && lastTool.text).toMatch(/no more changes/)
  })

  it('answers questions without touching the photo', async () => {
    const { provider } = scripted([{ text: 'The highlights are close to clipping.' }])
    const before = editor.getState().version
    const r = run(provider)
    expect((await r.promise).text).toBe('The highlights are close to clipping.')
    expect(editor.getState().version).toBe(before)
    expect(r.edits).toHaveLength(0)
  })

  it('reports bad tool calls back to the model instead of applying them', async () => {
    const { provider, seen } = scripted([{ toolCalls: [call({}, 'delete_photo'), set('Ok', [['basic.nope', 1]])] }, { text: 'Sorry.' }])
    await run(provider).promise
    const tool = seen[1].at(-1)
    if (tool?.role !== 'tool') throw new Error('expected tool results')
    expect(tool.results[0]).toMatchObject({ isError: true, content: expect.stringMatching(/^Not applied: There is no tool called "delete_photo"/) })
    expect(tool.results[1].content).toMatch(/Unknown slider "basic\.nope" skipped/)
    expect(editor.getState().history[0].label).toBe('Opened')
  })

  it('keeps what was applied when the request is stopped part-way', async () => {
    const controller = new AbortController()
    const { provider } = scripted([
      { toolCalls: [set('Brighter', [['basic.exposure', 0.5]])] },
      () => {
        controller.abort()
        throw new AiError('aborted', 'Stopped.')
      },
    ])
    const r = run(provider, { signal: controller.signal })
    await expect(r.promise).rejects.toMatchObject({ kind: 'aborted' })
    expect(editor.getState().recipe?.basic.exposure).toBe(0.5)
    expect(editor.getState().history[0].label).toBe('AI · Brighter')
    expect(r.edits[0].diff.find((i) => i.path === 'basic.exposure')?.toText).toBe('+0.50')
  })

  it('never runs tool calls cut off by the output limit', async () => {
    const { provider } = scripted([{ toolCalls: [set('Half', [['basic.exposure', 2]])], stop: 'max_tokens' }])
    await expect(run(provider).promise).rejects.toMatchObject({ kind: 'output' })
    expect(editor.getState().recipe?.basic.exposure).toBe(0)
  })

  it('retries a malformed answer once and withdraws its streamed text', async () => {
    const { provider } = scripted([
      () => {
        throw new AiError('output', 'bad json')
      },
      { text: 'Fine now.' },
    ])
    const r = run(provider)
    expect((await r.promise).text).toBe('Fine now.')
    expect(r.text()).toBe('Fine now.')
  })

  it('gives up when the user switches to another photo', async () => {
    const { provider } = scripted([{ toolCalls: [set('X', [['basic.exposure', 1]])] }])
    const r = run(provider)
    editor.open('p2', defaultRecipe('display'), 'display')
    await expect(r.promise).rejects.toMatchObject({ kind: 'aborted' })
    expect(editor.getState().recipe?.basic.exposure).toBe(0)
  })
})
