// Presets lab: loaded by sheet.mjs in headless Chromium. Renders looks with the
// real engine into contact sheets. Exposes window.lab.
import LibRaw from 'libraw-wasm'
import { createEngine } from '/src/engine/index.ts'
import { boxReduce } from '/src/engine/image.ts'
import { defaultRecipe } from '/src/edit/defaults.ts'
import { mat3 } from '/src/color/matrices.ts'
import { tempTintFromMultipliers } from '/src/color/wb.ts'
import { applyPreset, builtinPresets, collections, VARIATIONS } from '/src/presets/catalog.ts'

const photos = {}
const canvas = document.createElement('canvas')
const engine = createEngine(canvas)
const toLinear = new Float32Array(256).map((_, i) => {
  const e = i / 255
  return e <= 0.04045 ? e / 12.92 : ((e + 0.055) / 1.055) ** 2.4
})
const CELL = { w: 216, h: 144 }

function small(image, edge) {
  const k = Math.max(1, Math.floor(Math.max(image.width, image.height) / edge))
  return { ...boxReduce(image, k), fullWidth: image.fullWidth ?? image.width }
}

async function loadJpeg(name, url) {
  const bmp = await createImageBitmap(await (await fetch(url)).blob(), { colorSpaceConversion: 'none' })
  const c = new OffscreenCanvas(bmp.width, bmp.height)
  const ctx = c.getContext('2d')
  ctx.drawImage(bmp, 0, 0)
  const px = ctx.getImageData(0, 0, bmp.width, bmp.height).data
  const data = new Uint16Array(bmp.width * bmp.height * 3)
  for (let i = 0, j = 0; i < px.length; i += 4, j += 3) for (let k = 0; k < 3; k++) data[j + k] = Math.round(toLinear[px[i + k]] * 65535)
  photos[name] = { image: small({ width: bmp.width, height: bmp.height, data }, 300), color: { kind: 'display', space: 'srgb-linear' } }
}

async function loadRaw(name, url) {
  const raw = new LibRaw()
  await raw.open(new Uint8Array(await (await fetch(url)).arrayBuffer()), { outputBps: 16, gamm: [1, 1], noAutoBright: true, useCameraWb: true, outputColor: 0, userQual: 3, halfSize: true })
  const meta = await raw.metadata(true)
  const img = await raw.imageData()
  raw.dispose()
  const c = meta.color_data
  const rgbCam = mat3([0, 1, 2].map((r) => [0, 1, 2].map((k) => c.rgb_cam[r][k])))
  const camXyz = mat3([0, 1, 2].map((r) => [0, 1, 2].map((k) => c.cam_xyz[r][k])))
  const shotMul = [c.cam_mul[0] / c.cam_mul[1], 1, c.cam_mul[2] / c.cam_mul[1]]
  const data = img.data instanceof Uint16Array ? img.data : new Uint16Array(img.data.buffer)
  photos[name] = { image: small({ width: img.width, height: img.height, data, fullWidth: img.width * 2 }, 300), color: { kind: 'raw', space: 'camera', rgbCam, camXyz, shotMul }, asShot: tempTintFromMultipliers(camXyz, shotMul) }
}

/** Draw one render of `recipe` on photo `name` into ctx, fitted in the cell at (x, y). */
function cell(ctx, name, recipe, x, y) {
  const p = photos[name]
  engine.setSource(p.image, p.color)
  const s = Math.min(CELL.w / p.image.width, CELL.h / p.image.height)
  const w = Math.round(p.image.width * s), h = Math.round(p.image.height * s)
  engine.resize(w, h)
  engine.render(recipe)
  ctx.drawImage(canvas, x + (CELL.w - w) / 2, y + (CELL.h - h) / 2)
}

const base = (name) => defaultRecipe(photos[name].color.kind, photos[name].asShot)

async function sheet(rows, names) {
  const label = 150, gap = 4
  const c = new OffscreenCanvas(label + names.length * (CELL.w + gap), rows.length * (CELL.h + gap))
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#111'
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.font = '13px sans-serif'
  rows.forEach((row, i) => {
    const y = i * (CELL.h + gap)
    ctx.fillStyle = '#eee'
    row.label.split('\n').forEach((t, j) => ctx.fillText(t, 6, y + 20 + j * 16))
    names.forEach((n, j) => {
      const r = row.recipe(n)
      cell(ctx, n, r, label + j * (CELL.w + gap), y)
    })
  })
  const blob = await c.convertToBlob({ type: 'image/png' })
  const b = new Uint8Array(await blob.arrayBuffer())
  let s = ''
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return btoa(s)
}

/** All looks of a collection, plus the unedited photo on top. */
function collectionSheet(id, names) {
  const coll = collections().find((c) => c.id === id)
  const byId = new Map(builtinPresets().map((p) => [p.id, p]))
  const rows = [{ label: 'Original', recipe: base }]
  for (const pid of coll.presetIds) {
    const p = byId.get(pid)
    rows.push({ label: `${p.name}\n${pid}`, recipe: (n) => applyPreset(base(n), p, 100, 'original', photos[n].color.kind) })
  }
  return sheet(rows, names)
}

/** One look: amounts and variations. */
function lookSheet(id, names) {
  const p = builtinPresets().find((x) => x.id === id)
  const rows = [{ label: 'Original', recipe: base }]
  for (const a of [50, 100, 200]) rows.push({ label: `${p.name} ${a}%`, recipe: (n) => applyPreset(base(n), p, a, 'original', photos[n].color.kind) })
  for (const v of VARIATIONS.slice(1)) rows.push({ label: `${p.name}\n${v.label}`, recipe: (n) => applyPreset(base(n), p, 100, v.id, photos[n].color.kind) })
  return sheet(rows, names)
}

window.lab = { loadJpeg, loadRaw, collectionSheet, lookSheet, ids: () => collections().map((c) => c.id), supported: engine.supported }
window.ready = true
