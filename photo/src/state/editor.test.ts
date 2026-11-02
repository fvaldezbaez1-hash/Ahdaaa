import { describe, expect, it } from 'vitest'
import { defaultRecipe } from '../edit/defaults'
import { editor } from './editor'

const exposure = (v: number) => editor.apply((r) => ({ ...r, basic: { ...r.basic, exposure: v } }), `Exposure ${v}`)

describe('undo steps across sessions', () => {
  it('restores saved steps onto the same recipe, so undo works after a reload', () => {
    editor.open('p1', defaultRecipe('display'), 'display')
    exposure(1)
    exposure(2)
    editor.undo()
    const saved = JSON.parse(JSON.stringify(editor.snapshot()))
    expect(saved.past).toHaveLength(1)
    expect(saved.future).toHaveLength(1)

    // "Reload": open the stored recipe with an empty history, then restore.
    editor.open('p1', saved.recipe, 'display')
    expect(editor.getState().canUndo).toBe(false)
    editor.restore(saved)
    expect(editor.getState().canUndo).toBe(true)
    expect(editor.getState().canRedo).toBe(true)
    editor.undo()
    expect(editor.getState().recipe!.basic.exposure).toBe(0)
    editor.redo()
    editor.redo()
    expect(editor.getState().recipe!.basic.exposure).toBe(2)
  })

  it('ignores steps that lead elsewhere, belong to another photo, or arrive after new edits', () => {
    editor.open('p2', defaultRecipe('display'), 'display')
    exposure(1)
    const saved = JSON.parse(JSON.stringify(editor.snapshot()))

    editor.open('p2', defaultRecipe('display'), 'display') // the photo changed elsewhere since
    editor.restore(saved)
    expect(editor.getState().canUndo).toBe(false)

    editor.open('p3', saved.recipe, 'display')
    editor.restore(saved)
    expect(editor.getState().canUndo).toBe(false)

    editor.open('p2', saved.recipe, 'display')
    exposure(3)
    editor.restore(saved)
    expect(editor.getState().history[0].label).toBe('Exposure 3')
  })
})
