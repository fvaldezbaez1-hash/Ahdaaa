import type { AspectId, Geometry, Rect } from '../../edit/types'
import { editor } from '../../state/editor'
import { view } from '../view'
import { aspectRatio, DEFAULT_GEOMETRY, fitAspect, flip, frameSize, rotateQuarter, shrinkToFit, viewToCrop, type Box, type Size } from './geometry'

// The crop tool edits the geometry live (editor.preview) and records the whole
// session as one undo step on Done; Cancel puts the geometry back.
//
// `intent` is the crop the person last set by hand. Straightening shrinks it
// to stay on the photo, and straightening back restores it.

let start: Geometry | null = null
let intent: Rect | null = null
let src: Size = { w: 1, h: 1 }

export const isCropping = () => start !== null

/** Open the tool. `source` is the photo's oriented size (its aspect is what matters). */
export function enterCrop(source: Size) {
  const r = editor.getState().recipe
  if (!r || start) return
  src = source
  start = r.geometry
  intent = r.geometry.crop
  view.set({ tool: 'crop', zoom: 1, eyedropper: false, holding: false, leveling: false, grid: 'none' })
}

function label(a: Geometry, b: Geometry): string {
  const changes = [
    (JSON.stringify(a.crop) !== JSON.stringify(b.crop) || a.aspect !== b.aspect) && 'crop',
    a.angle !== b.angle && 'angle',
    a.rotate !== b.rotate && 'turn',
    (a.flipH !== b.flipH || a.flipV !== b.flipV) && 'mirror',
  ].filter(Boolean)
  // A turn or flip moves the crop rect too; name the gesture the person made.
  const only = changes.length === 1 ? changes[0] : changes.length === 2 && changes[0] === 'crop' && (changes[1] === 'turn' || changes[1] === 'mirror') ? changes[1] : null
  if (only === 'angle') return `Straighten ${b.angle > 0 ? '+' : ''}${b.angle.toFixed(1)}°`
  if (only === 'turn') return 'Rotate'
  if (only === 'mirror') return 'Flip'
  if (only === 'crop') return 'Crop'
  return 'Crop & straighten'
}

function close() {
  start = null
  intent = null
  view.set({ tool: null, leveling: false, grid: 'none' })
}

/** Done: keep the changes as one undo step. */
export function finishCrop() {
  const before = start
  const after = editor.getState().recipe?.geometry
  if (before && after) editor.commit(label(before, after))
  close()
}

/** Cancel: back to how the crop was when the tool opened. */
export function cancelCrop() {
  const before = start
  if (before) {
    editor.preview((r) => ({ ...r, geometry: before }))
    editor.commit('Crop')
  }
  close()
}

function update(fn: (g: Geometry, frame: Size) => Geometry) {
  editor.preview((r) => ({ ...r, geometry: fn(r.geometry, frameSize(src, r.geometry.rotate)) }))
}

export const cropFrame = (g: Geometry) => frameSize(src, g.rotate)

/** A drag of the crop box (view pixels). */
export function setCropBox(box: Box) {
  update((g, f) => {
    intent = viewToCrop(box, g.angle, f)
    return { ...g, crop: intent }
  })
}

export function setAngle(angle: number) {
  update((g, f) => ({ ...g, angle, crop: shrinkToFit(intent ?? g.crop, angle, f) }))
}

export function setAspect(aspect: AspectId) {
  update((g, f) => {
    const ratio = aspectRatio(aspect, f)
    const crop = ratio ? fitAspect(g.crop, ratio, g.angle, f) : g.crop
    intent = crop
    return { ...g, aspect, crop }
  })
}

export function rotateCrop(dir: 1 | -1) {
  update((g) => {
    if (intent) intent = rotateQuarter({ ...g, crop: intent }, dir).crop
    return rotateQuarter(g, dir)
  })
}

export function flipCrop(axis: 'h' | 'v') {
  update((g) => {
    if (intent) intent = flip({ ...g, crop: intent }, axis).crop
    return flip(g, axis)
  })
}

export function resetCrop() {
  intent = DEFAULT_GEOMETRY.crop
  update(() => DEFAULT_GEOMETRY)
}

/** Outside the tool: turn the photo a quarter turn as its own undo step. */
export function rotateQuick(dir: 1 | -1) {
  editor.apply((r) => ({ ...r, geometry: rotateQuarter(r.geometry, dir) }), dir === 1 ? 'Rotate right' : 'Rotate left')
}
