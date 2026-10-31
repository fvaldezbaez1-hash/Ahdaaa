// Build-time model conversions, all deterministic (the output's sha256 is
// pinned in src/ai/registry.ts like any download).
import { FLOAT, GraphBuilder, halfWeights } from './onnx.mjs'
import { readPth } from './pth.mjs'

/**
 * Real-ESRGAN SRVGGNetCompact (realesr-general-x4v3, BSD-3-Clause) from the
 * official .pth to ONNX. Input `input` [1,3,H,W] RGB 0…1; output `x2` is the
 * ×4 result area-averaged to ×2 (what Lumen's export upscale uses).
 */
export function srvggToOnnx(pth) {
  const sd = readPth(pth)
  const g = new GraphBuilder('realesr_general_x4v3_x2')
  const input = g.input('input', FLOAT, [1, 3, 'height', 'width'])
  let x = input
  let i = 0
  for (;;) {
    const w = sd.get(`body.${i}.weight`)
    if (!w) break
    const b = sd.get(`body.${i}.bias`)
    x = g.node('Conv', [x, g.weight(`body_${i}_w`, w.data, w.shape), g.weight(`body_${i}_b`, b.data, b.shape, false)], { kernel_shape: [3, 3], pads: [1, 1, 1, 1] })
    const slope = sd.get(`body.${i + 1}.weight`)
    if (slope?.shape.length === 1) {
      x = g.node('PRelu', [x, g.weight(`body_${i + 1}_slope`, slope.data, [slope.shape[0], 1, 1], false)])
      i += 2
    } else i += 1
  }
  if (i < 4) throw new Error('Unexpected SRVGG checkpoint layout')
  const up = g.node('DepthToSpace', [x], { blocksize: 4, mode: 'CRD' })
  const scales = g.weight('scales4', [1, 1, 4, 4], [4], false)
  const base = g.node('Resize', [input, '', scales], { mode: 'nearest', coordinate_transformation_mode: 'asymmetric', nearest_mode: 'floor' })
  const x4 = g.node('Add', [up, base])
  g.node('AveragePool', [x4], { kernel_shape: [2, 2], strides: [2, 2] }, 'x2')
  g.output('x2', FLOAT, [1, 3, 'height2', 'width2'])
  return g.build({ opset: 17, doc: 'Real-ESRGAN realesr-general-x4v3 (BSD-3-Clause, xinntao), converted by Lumen; output = x4 averaged to x2.' })
}

/** Store an ONNX model's large float weights as float16 (half the download). */
export function fp16Weights(onnx) {
  return halfWeights(onnx)
}

export const converters = {
  'srvgg-x2': srvggToOnnx,
  'fp16-weights': fp16Weights,
}
