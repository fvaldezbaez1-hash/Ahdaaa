// Runs in headless Chromium (see check.mjs): drives the real merge code and the app's decode path.
import { decodeFile } from '../../src/io/api'
import { readLumenDng, writeDng } from '../../src/io/dng'
import { mul, diag, type Mat3 } from '../../src/color/matrices'

declare global {
  interface Window {
    saveOutput(name: string, b64: string): Promise<void>
    runCheck(plan: { raw: string; jpegs: string[]; steps: string[] }): Promise<unknown>
  }
}

async function b64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

window.runCheck = async (plan) => {
  const log: Record<string, unknown>[] = []
  if (plan.steps.includes('libraw')) {
    const { default: LibRaw } = await import('libraw-wasm')
    const buf = new Uint8Array(await (await (await fetch(plan.raw)).blob()).arrayBuffer())
    const base = { outputBps: 16, gamm: [1, 1], useCameraWb: true, outputColor: 0, userQual: 3, highlight: 0, halfSize: true }
    for (const [name, extra] of [['noAutoBright true', { noAutoBright: true }], ['noAutoBright false', { noAutoBright: false }], ['gamm 0.999', { noAutoBright: true, gamm: [0.999, 1.001] }], ['gamm 1 0', { noAutoBright: true, gamm: [1, 0] }], ['thr 0.0000001', { noAutoBright: true, autoBrightThr: 0.0000001 }], ['bright 1', { noAutoBright: true, bright: 1 }]] as const) {
      const raw = new LibRaw()
      await raw.open(buf.slice(), { ...base, ...extra } as never)
      const img = await raw.imageData()
      const d = img!.data as Uint16Array
      const m = [0, 0, 0]
      for (let i = 0; i < d.length; i++) m[i % 3] += d[i]
      log.push({ step: `libraw ${name}`, size: `${img!.width}x${img!.height}`, mean: m.map((x) => Math.round(x / (d.length / 3))) })
      if (name === 'noAutoBright true') await window.saveOutput('wasm-half.bin', await b64(new Blob([d.buffer as ArrayBuffer])))
      raw.dispose()
    }
    return log
  }
  const t0 = performance.now()
  const src = await decodeFile(await (await fetch(plan.raw)).blob(), { fileName: 'x.ARW', quality: 'full', maxLongEdge: 1600 })
  log.push({ step: 'decode source', ms: Math.round(performance.now() - t0), size: `${src.image.width}x${src.image.height}`, raw: src.raw })
  if (plan.steps.includes('dng')) {
    const shot = src.raw!.shotMul
    const camXyz = src.raw!.camXyz as Mat3
    const W = src.image.width, H = src.image.height, n = W * H
    const native = new Uint16Array(src.image.data.length)
    // Native camera data with headroom for LibRaw's white balance (it multiplies by cam_mul / min).
    const mn = Math.min(...shot)
    for (let i = 0; i < n * 3; i++) native[i] = Math.round((src.image.data[i] / shot[i % 3]) * mn)
    const quarter = Uint16Array.from(native, (v) => v >> 2)
    const variants: [string, Uint16Array, Parameters<typeof writeDng>[1]][] = [
      ['E make Lumen, native/4, neutral 1/shot', quarter, { width: W, height: H, colorMatrix: camXyz, asShotNeutral: [1 / shot[0], 1, 1 / shot[2]], baselineExposure: 0, meta: { ...src.meta, make: 'Lumen', model: 'HDR merge' }, uniqueCameraModel: 'Lumen HDR' }],
      ['A real make, WB data, neutral 1', src.image.data, { width: W, height: H, colorMatrix: mul(diag(shot), camXyz), baselineExposure: 0, meta: src.meta, uniqueCameraModel: 'Lumen HDR' }],
      ['B real make, native data, neutral 1/shot', native, { width: W, height: H, colorMatrix: camXyz, asShotNeutral: [1 / shot[0], 1, 1 / shot[2]], baselineExposure: 0, meta: src.meta, uniqueCameraModel: 'Lumen HDR' }],
      ['C make Lumen, WB data, neutral 1', src.image.data, { width: W, height: H, colorMatrix: mul(diag(shot), camXyz), baselineExposure: 0, meta: { ...src.meta, make: 'Lumen', model: 'HDR merge' }, uniqueCameraModel: 'Lumen HDR' }],
      ['D make Lumen, native data, neutral 1/shot', native, { width: W, height: H, colorMatrix: camXyz, asShotNeutral: [1 / shot[0], 1, 1 / shot[2]], baselineExposure: 0, meta: { ...src.meta, make: 'Lumen', model: 'HDR merge' }, uniqueCameraModel: 'Lumen HDR' }],
    ]
    for (const [name, data, info] of variants) {
      const blob = writeDng(data, info)
      const back = await decodeFile(blob, { fileName: 'merge.dng', quality: 'full' })
      const own = readLumenDng(await blob.arrayBuffer())!
      let maxDiff = 0, sumDiff = 0, ownDiff = 0
      const sums = [0, 0, 0, 0, 0, 0]
      const low = [0, 0, 0, 0, 0, 0]
      for (let i = 0; i < src.image.data.length; i++) {
        const d = Math.abs(back.image.data[i] - src.image.data[i])
        maxDiff = Math.max(maxDiff, d)
        sumDiff += d
        ownDiff = Math.max(ownDiff, Math.abs(own.data[i] - data[i]))
        sums[i % 3] += back.image.data[i]
        sums[3 + (i % 3)] += src.image.data[i]
        if (src.image.data[i] < 8000 && back.image.data[i] < 60000) {
          low[i % 3] += back.image.data[i]
          low[3 + (i % 3)] += data[i]
        }
      }
      log.push({ step: `dng ${name}`, maxDiff, meanDiff: +(sumDiff / src.image.data.length).toFixed(2), ratio: [0, 1, 2].map((c) => +(sums[c] / sums[3 + c]).toFixed(4)), lowRatioVsWritten: [0, 1, 2].map((c) => +(low[c] / low[3 + c]).toFixed(4)), ownReaderMaxDiff: ownDiff, shotMul: back.raw?.shotMul, asShot: back.raw?.asShot, camXyz0: back.raw?.camXyz.slice(0, 3), make: back.meta.make, model: back.meta.model, lens: back.meta.lens })
    }
  }
  return log
}
