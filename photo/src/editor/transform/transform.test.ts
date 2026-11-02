import { describe, expect, it } from 'vitest'
import { defaultRecipe } from '../../edit/defaults'
import type { UprightGuide } from '../../edit/types'
import { makeSpace } from '../masks/space'
import { addGuide, guideDirection, hitGuide, MAX_GUIDES, moveGuide, removeGuide } from './guides'

const src = { width: 1000, height: 500 }
const space = (angle = 0) => makeSpace(src, { ...defaultRecipe('display').geometry, angle }, { w: 1000, h: 500 })
const g = (x1: number, y1: number, x2: number, y2: number): UprightGuide => ({ x1, y1, x2, y2 })

describe('guided upright lines', () => {
  it('keeps at most four lines, dropping the oldest', () => {
    let list: UprightGuide[] = []
    for (let i = 0; i < 6; i++) list = addGuide(list, g(i / 10, 0.1, i / 10, 0.9))
    expect(list).toHaveLength(MAX_GUIDES)
    expect(list[0].x1).toBe(0.2)
    expect(list[3].x1).toBe(0.5)
  })

  it('moves an end or the whole line, in mask coordinates', () => {
    const list = [g(0.1, 0.1, 0.1, 0.9), g(0.2, 0.5, 0.8, 0.5)]
    expect(moveGuide(list, { i: 0, part: 'p1' }, { x: 0.1, y: 0.1 }, { x: 0.12, y: 0.05 })[0]).toEqual(g(0.12, 0.05, 0.1, 0.9))
    expect(moveGuide(list, { i: 0, part: 'p2' }, { x: 0.1, y: 0.9 }, { x: 0.15, y: 0.95 })[0]).toEqual(g(0.1, 0.1, 0.15, 0.95))
    const moved = moveGuide(list, { i: 1, part: 'line' }, { x: 0.5, y: 0.5 }, { x: 0.6, y: 0.4 })
    expect(moved[1].x1).toBeCloseTo(0.3)
    expect(moved[1].y2).toBeCloseTo(0.4)
    expect(moved[0]).toBe(list[0])
    expect(removeGuide(list, 0)).toEqual([list[1]])
  })

  it('hits an end before the line, the newest line first', () => {
    const s = space()
    const list = [g(0.1, 0.1, 0.1, 0.9), g(0.1, 0.5, 0.9, 0.5)]
    // (100, 250) is on both lines: the newer one (index 1) wins, at its end.
    expect(hitGuide(list, s, { x: 103, y: 252 }, 10)).toEqual({ i: 1, part: 'p1' })
    expect(hitGuide(list, s, { x: 100, y: 52 }, 10)).toEqual({ i: 0, part: 'p1' })
    expect(hitGuide(list, s, { x: 100, y: 448 }, 10)).toEqual({ i: 0, part: 'p2' })
    expect(hitGuide(list, s, { x: 500, y: 253 }, 10)).toEqual({ i: 1, part: 'line' })
    // The line is thinner to hit than the ends.
    expect(hitGuide(list, s, { x: 500, y: 258 }, 10)).toBeNull()
    expect(hitGuide([], s, { x: 0, y: 0 }, 10)).toBeNull()
  })

  it('reads lines as vertical or horizontal as they show on screen', () => {
    const steep = g(0.5, 0.1, 0.52, 0.9)
    expect(guideDirection(steep, space())).toBe('vertical')
    expect(guideDirection(g(0.1, 0.5, 0.9, 0.55), space())).toBe('horizontal')
    // A quarter turn swaps them.
    const turned = makeSpace(src, { ...defaultRecipe('display').geometry, rotate: 1 }, { w: 500, h: 1000 })
    expect(guideDirection(steep, turned)).toBe('horizontal')
  })
})
