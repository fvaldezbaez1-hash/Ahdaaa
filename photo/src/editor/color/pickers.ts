import type { ColorRange, LensCorrection } from '../../edit/types'
import { hueSat } from '../../engine/masks'
import { uid } from '../../io/db'
import { editor } from '../../state/editor'
import { toast } from '../../ui/toast'
import { newRange, wrapHue } from '../math/colorRange'
import { pickPoint } from '../math/levels'
import { view, type PickKind } from '../view'

// Clicking the photo with one of the Phase 4 pickers: the color is read from
// the photo as developed (display-encoded RGB 0…1, measured as the engine
// measures it) and turned into one undo step.

export const PICK_HINTS: Record<PickKind, string> = {
  color: 'Click a color to adjust',
  colorAgain: 'Click the color this range should follow',
  skin: 'Click a typical skin tone',
  black: 'Click something that should be black',
  gray: 'Click something that should be neutral gray',
  white: 'Click something that should be white',
  fringe: 'Click a purple or green fringe along an edge',
}

const nextName = (ranges: ColorRange[], base: string) => {
  let n = 1
  while (ranges.some((r) => r.name === `${base} ${n}`)) n++
  return `${base} ${n}`
}

/** A fringe hue range of ±30° around the picked hue (as [from, to], to may pass 360). */
const around = (h: number): [number, number] => [Math.round(wrapHue(h - 30)), Math.round(wrapHue(h - 30) + 60)]

export function applyPick(kind: PickKind, rgb: [number, number, number]) {
  const { h, s } = hueSat(...rgb)
  const sat = s * 100
  if (kind === 'color' || kind === 'skin') {
    if (sat < 3) {
      toast('That spot has almost no color. Pick a colored area.')
      return
    }
    const r = editor.getState().recipe
    if (!r) return
    const skin = kind === 'skin'
    const range = newRange(uid(), skin ? nextName(r.colorEditor, 'Skin tone') : nextName(r.colorEditor, 'Color'), h, sat, skin)
    editor.apply((x) => ({ ...x, colorEditor: [...x.colorEditor, range] }), skin ? 'Color editor: skin tone' : 'Color editor: new color')
    view.set({ colorRange: range.id })
  } else if (kind === 'colorAgain') {
    const ranges = editor.getState().recipe?.colorEditor ?? []
    // The panel shows the last range when none is selected.
    const id = (ranges.find((c) => c.id === view.get().colorRange) ?? ranges.at(-1))?.id
    if (!id) return
    editor.apply(
      (x) => ({
        ...x,
        colorEditor: x.colorEditor.map((c) => {
          if (c.id !== id) return c
          const d = Math.round(sat) - c.sat
          return { ...c, hue: Math.round(h), sat: Math.round(sat), satLow: Math.max(0, c.satLow + d), satHigh: Math.min(100, c.satHigh + d) }
        }),
      }),
      'Color editor: pick color',
    )
  } else if (kind === 'fringe') {
    const purple = h >= 200 || h < 30
    editor.apply((x) => {
      const d: LensCorrection['defringe'] = { ...x.lens.defringe }
      if (purple) Object.assign(d, { purple: Math.max(d.purple, 5), purpleHue: around(h) })
      else Object.assign(d, { green: Math.max(d.green, 5), greenHue: around(h) })
      return { ...x, lens: { ...x.lens, defringe: d } }
    }, purple ? 'Defringe: purple' : 'Defringe: green')
  } else {
    editor.apply((x) => ({ ...x, levels: pickPoint(x.levels, kind, rgb) }), `Levels: ${kind} point`)
  }
}
