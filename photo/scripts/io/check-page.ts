// Browser half of scripts/io/check.mjs: drives the real IO API in Chromium.
import { exportPhotos, importFiles, loadWorking, previewJpeg, setExportSink } from '../../src/io/api'
import { db } from '../../src/io/db'
import { decodeBlob } from '../../src/io/decoder'
import { resampleRgb16 } from '../../src/io/decode/resample'
import { linearToSrgb } from '../../src/io/decode/srgb'
import { insertJpegSegments } from '../../src/io/encode/jpeg'
import { serializeTiff, short } from '../../src/io/encode/tiffIfd'
import { encodeTiff16 } from '../../src/io/encode/tiff'
import { seams } from '../../src/io/seams'
import type { ExportFile } from '../../src/io/save'
import type { ExportOptions } from '../../src/io/types'
import { createEngine } from '../../src/engine'
import { apply, mul, XYZ_TO_P3, SRGB_TO_XYZ, type Mat3 } from '../../src/color/matrices'
import type { RenderedImage } from '../../src/engine/types'

declare global {
  interface Window {
    runCheck: (files: string[]) => Promise<unknown>
    saveOutput: (name: string, base64: string) => Promise<void>
  }
}

let peakHeap = 0
const sampleHeap = () => {
  const m = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
  if (m) peakHeap = Math.max(peakHeap, m.usedJSHeapSize)
}
setInterval(sampleHeap, 50)

const ms = (t: number) => Math.round(performance.now() - t)

async function fetchFile(url: string, name = url.split('/').pop()!): Promise<File> {
  const b = await (await fetch(url)).blob()
  return new File([b], decodeURIComponent(name), { lastModified: 1_700_000_000_000 })
}

/** Stand-in for the GPU engine while it's being built: area downscale + matrix + transfer curve. */
function cpuRender(d: Parameters<typeof seams.render>[1], o: Parameters<typeof seams.render>[2]): RenderedImage {
  const s = resampleRgb16(d.image.data, d.image.width, d.image.height, o.maxLongEdge)
  let m: Mat3 | undefined = d.color.space === 'camera' ? d.color.rgbCam : undefined
  if (o.colorSpace === 'display-p3') m = mul(mul(XYZ_TO_P3, SRGB_TO_XYZ), m ?? [1, 0, 0, 0, 1, 0, 0, 0, 1])
  const n = s.width * s.height
  const max = o.bitDepth === 16 ? 65535 : 255
  const out = o.bitDepth === 16 ? new Uint16Array(n * 4) : new Uint8ClampedArray(n * 4)
  const lut = new Float32Array(4097).map((_, i) => Math.round(linearToSrgb(i / 4096) * max))
  for (let i = 0; i < n; i++) {
    let rgb: [number, number, number] = [s.data[i * 3] / 65535, s.data[i * 3 + 1] / 65535, s.data[i * 3 + 2] / 65535]
    if (m) rgb = apply(m, rgb)
    for (let c = 0; c < 3; c++) out[i * 4 + c] = lut[Math.round(Math.min(1, Math.max(0, rgb[c])) * 4096)]
    out[i * 4 + 3] = max
  }
  return { width: s.width, height: s.height, data: out, bitDepth: o.bitDepth, colorSpace: o.colorSpace }
}

async function toBase64(b: Blob): Promise<string> {
  const u = new Uint8Array(await b.arrayBuffer())
  let s = ''
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000))
  return btoa(s)
}

window.runCheck = async (urls: string[]) => {
  const report: Record<string, unknown> = {}
  let engine = 'real'
  try {
    createEngine(new OffscreenCanvas(1, 1)).dispose()
  } catch {
    engine = 'cpu stand-in (engine not implemented yet)'
    seams.render = async (_recipe, d, o) => cpuRender(d, o)
  }
  report.engine = engine
  // Per-stage timings of exports (decode → render → encode).
  const stages: Record<string, number> = {}
  const timed = <A extends unknown[], R>(name: string, fn: (...a: A) => Promise<R>) => async (...a: A): Promise<R> => {
    const t0 = performance.now()
    try {
      return await fn(...a)
    } finally {
      stages[name] = ms(t0)
    }
  }
  seams.decode = timed('decode', seams.decode)
  seams.render = timed('render', seams.render)
  seams.encode = timed('encode', seams.encode)
  await Promise.all([db.photos.clear(), db.originals.clear(), db.thumbs.clear()])

  // Extra inputs: a JPEG tagged "rotate 90° CW" and a 16-bit TIFF made from a JPEG.
  const files = await Promise.all(urls.map((u) => fetchFile(u)))
  const jpeg = files.find((f) => /\.jpg$/i.test(f.name))!
  const rotated = insertJpegSegments(new Uint8Array(await jpeg.arrayBuffer()), serializeTiff({ tags: [short(0x0112, 6)] }, false))
  files.push(new File(rotated, 'rotated-6.jpg', { lastModified: 1 }))
  const bmp = await createImageBitmap(jpeg)
  const cv = new OffscreenCanvas(bmp.width, bmp.height)
  const cx = cv.getContext('2d')!
  cx.drawImage(bmp, 0, 0)
  const px8 = cx.getImageData(0, 0, bmp.width, bmp.height).data
  const px16 = new Uint16Array(px8.length).map((_, i) => px8[i] * 257)
  files.push(new File([await encodeTiff16(px16, bmp.width, bmp.height)], 'sixteen.tif', { lastModified: 2 }))
  files.push(new File(['not an image'], 'bad.jpg'), files[0]) // undecodable + duplicate

  // Import
  const times: Record<string, number> = {}
  let t = performance.now(), last = ''
  const r = await importFiles(files, {
    onProgress: (p) => {
      if (last) times[last] = ms(t)
      t = performance.now()
      last = p.current ?? ''
    },
  })
  report.import = { added: r.added.length, skipped: r.skipped, notices: r.notices, msPerFile: times }
  const recs = await db.photos.bulkGet(r.added)
  report.records = await Promise.all(recs.map(async (p) => {
    const th = await db.thumbs.get(p!.id)
    return { name: p!.fileName, kind: p!.kind, size: `${p!.width}x${p!.height}`, thumb: `${th!.width}x${th!.height}`, thumbBytes: th!.blob.size, asShot: p!.raw?.asShot, meta: p!.meta }
  }))
  for (const p of recs) await window.saveOutput(`thumb-${p!.fileName}.jpg`, await toBase64((await db.thumbs.get(p!.id))!.blob))
  const byName = (n: string) => recs.find((p) => p!.fileName === n)!.id

  // Working images
  const arw = byName('example-sony.ARW')
  t = performance.now()
  const w1 = await loadWorking(arw)
  const tw1 = ms(t)
  t = performance.now()
  const w2 = await loadWorking(arw, 2048)
  report.working = { arw: `${w1.image.width}x${w1.image.height}`, ms: tw1, cachedDownscale: `${w2.image.width}x${w2.image.height}`, cachedMs: ms(t) }
  t = performance.now()
  const nef = await loadWorking(byName('iss030e122639.NEF'), 2560)
  report.workingNef = { size: `${nef.image.width}x${nef.image.height}`, ms: ms(t) }

  // Embedded-preview fallback on the same ARW
  t = performance.now()
  const pv = await decodeBlob(await fetchFile(urls.find((u) => /ARW$/.test(u))!), { fileName: 'example-sony.ARW', quality: 'full', maxLongEdge: 4096, previewOnly: true })
  report.embeddedPreview = { size: `${pv.image.width}x${pv.image.height}`, full: `${pv.fullWidth}x${pv.fullHeight}`, kind: pv.kind, notice: pv.notice, ms: ms(t) }

  // AI preview
  t = performance.now()
  const pj = await previewJpeg(arw, recs[0]!.recipe, 1024)
  report.previewJpeg = { size: `${pj.width}x${pj.height}`, bytes: pj.dataUrl.length, ms: ms(t) }

  // Exports through the test sink
  const out: ExportFile[] = []
  setExportSink({ write: async (f) => void out.push(f), finish: async () => undefined })
  const base: ExportOptions = { format: 'jpeg', quality: 92, colorSpace: 'srgb', keepMetadata: true, stripLocation: true }
  const runs: [string, string[], ExportOptions][] = [
    ['ARW → JPEG full-res sRGB', [arw], base],
    ['ARW → JPEG 2048 P3', [arw], { ...base, longEdge: 2048, colorSpace: 'display-p3' }],
    ['ARW → PNG 2048 P3', [arw], { ...base, format: 'png', longEdge: 2048, colorSpace: 'display-p3' }],
    ['ARW → TIFF16 3000 P3', [arw], { ...base, format: 'tiff16', longEdge: 3000, colorSpace: 'display-p3' }],
    ['ARW → TIFF16 full-res', [arw], { ...base, format: 'tiff16' }],
    ['all → JPEG 1600 (batch)', r.added, { ...base, longEdge: 1600, keepMetadata: false }],
  ]
  const exports: unknown[] = []
  for (const [label, ids, o] of runs) {
    out.length = 0
    t = performance.now()
    const res = await exportPhotos(ids, o)
    const elapsed = ms(t)
    exports.push({ label, ms: elapsed, stages: { ...stages }, ...res, files: out.map((f) => ({ name: f.name, bytes: f.blob.size })) })
    for (const f of out) if (f.blob.size < 40e6 && ids.length === 1) await window.saveOutput(`${label.replace(/\W+/g, '_')}-${f.name}`, await toBase64(f.blob))
  }
  setExportSink(null)
  report.exports = exports
  sampleHeap()
  report.peakMainHeapMB = Math.round(peakHeap / 1e6)
  return report
}
