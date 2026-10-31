// The on-device AI models Lumen can use, as plain data. Read by the app
// (src/ai/models.ts) and by the build (scripts/models/fetch.mjs, which
// downloads each `source`, checks it, converts it if needed, checks the result
// against `sha256` and puts it in public/models/ so GitHub Pages serves it from
// Lumen's own origin). No imports: Node loads this file directly.
//
// Only permissively licensed weights (Apache-2.0 / MIT / BSD). Photos never
// leave the device; the browser only ever downloads these files.

export type AiTask = 'person' | 'object' | 'subject' | 'depth' | 'inpaint' | 'denoise' | 'upscale'
export type Runtime = 'onnx' | 'mediapipe'

export interface ModelFile {
  /** Served at `models/<file>` next to the app. */
  file: string
  bytes: number
  sha256: string
  /** Where the build gets it: URLs tried in order until one matches `sha256`, then converted. */
  source: {
    urls: string[]
    bytes: number
    sha256: string
    /** Deterministic build-time conversion (scripts/models/convert.mjs). */
    convert?: 'fp16-weights' | 'srvgg-x2'
  }
}

export interface ModelEntry {
  id: string
  /** Short name for the Settings → AI models list. */
  name: string
  task: AiTask
  runtime: Runtime
  files: ModelFile[]
  licence: 'Apache-2.0' | 'MIT' | 'BSD-3-Clause'
  /** Project the weights come from. */
  upstream: string
  /** What the device should have. Phones: whether to offer it there at all. */
  hints: { minMemoryGB: number; webgpu: 'no' | 'recommended'; phones: boolean }
  /** Quality tier when a task has several models. */
  tier: 'fast' | 'quality'
  /** Ran in Lumen's headless check (scripts/ai/check.mjs). */
  tested: boolean
  notes?: string
}

const MP = 'https://storage.googleapis.com/mediapipe-models/'

export const MODELS: readonly ModelEntry[] = [
  {
    id: 'mp-selfie-multiclass',
    name: 'People and their parts',
    task: 'person',
    runtime: 'mediapipe',
    licence: 'Apache-2.0',
    upstream: 'https://ai.google.dev/edge/mediapipe/solutions/vision/image_segmenter',
    files: [
      { file: 'selfie_multiclass_256x256-c6748b12.tflite', bytes: 16371837, sha256: 'c6748b1253a99067ef71f7e26ca71096cd449baefa8f101900ea23016507e0e0', source: { urls: [`${MP}image_segmenter/selfie_multiclass_256x256/float32/1/selfie_multiclass_256x256.tflite`], bytes: 16371837, sha256: 'c6748b1253a99067ef71f7e26ca71096cd449baefa8f101900ea23016507e0e0' } },
      { file: 'hair_segmenter-2628cf3c.tflite', bytes: 781618, sha256: '2628cf3ce5f695f604cbea2841e00befcaa3624bf80caf3664bef2656d59bf84', source: { urls: [`${MP}image_segmenter/hair_segmenter/float32/1/hair_segmenter.tflite`], bytes: 781618, sha256: '2628cf3ce5f695f604cbea2841e00befcaa3624bf80caf3664bef2656d59bf84' } },
    ],
    hints: { minMemoryGB: 2, webgpu: 'no', phones: true },
    tier: 'fast',
    tested: true,
    notes: 'Selfie multiclass 256×256 (background, hair, body skin, face skin, clothes, accessories) plus the hair segmenter.',
  },
  {
    id: 'mp-interactive',
    name: 'Select object (detailed)',
    task: 'object',
    runtime: 'mediapipe',
    licence: 'Apache-2.0',
    upstream: 'https://ai.google.dev/edge/mediapipe/solutions/vision/interactive_segmenter',
    files: [{ file: 'interactive_segmentation-38431bc6.task', bytes: 30525312, sha256: '38431bc66b883404e8397f74c3579404315b9b52b04a46c6346fe906a7309b03', source: { urls: [`${MP}interactive_segmenter_v2/magic_touch/int8/1/interactive_segmentation.task`], bytes: 30525312, sha256: '38431bc66b883404e8397f74c3579404315b9b52b04a46c6346fe906a7309b03' } }],
    hints: { minMemoryGB: 2, webgpu: 'no', phones: true },
    tier: 'quality',
    tested: true,
    notes:
      'Magic Touch v2 (int8): positive and negative clicks, cleaner masks than v1, but MediaPipe 1.2 re-runs its encoder on every click ' +
      '(≈ 9 s per click on a desktop CPU), so it is not the default.',
  },
  {
    id: 'mp-magic-touch',
    name: 'Select object',
    task: 'object',
    runtime: 'mediapipe',
    licence: 'Apache-2.0',
    upstream: 'https://ai.google.dev/edge/mediapipe/solutions/vision/interactive_segmenter',
    files: [{ file: 'magic_touch-e24338a7.tflite', bytes: 6227884, sha256: 'e24338a717c1b7ad8d159666677ef400babb7f33b8ad60c4d96db4ecf694cd25', source: { urls: [`${MP}interactive_segmenter/magic_touch/float32/1/magic_touch.tflite`], bytes: 6227884, sha256: 'e24338a717c1b7ad8d159666677ef400babb7f33b8ad60c4d96db4ecf694cd25' } }],
    hints: { minMemoryGB: 1, webgpu: 'no', phones: true },
    tier: 'fast',
    tested: true,
    notes: 'Magic Touch v1, the default: ≈ 0.5 s per click. Positive clicks select together; a negative click removes what a click there would select.',
  },
  {
    id: 'u2netp',
    name: 'Subject (fast)',
    task: 'subject',
    runtime: 'onnx',
    licence: 'Apache-2.0',
    upstream: 'https://github.com/xuebinqin/U-2-Net',
    files: [{ file: 'u2netp-309c8469.onnx', bytes: 4574861, sha256: '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8', source: { urls: ['https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx'], bytes: 4574861, sha256: '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8' } }],
    hints: { minMemoryGB: 1, webgpu: 'no', phones: true },
    tier: 'fast',
    tested: true,
    notes: 'U²-Netp salient object detection at 320×320 (ONNX export from the rembg project).',
  },
  {
    id: 'isnet-general',
    name: 'Subject (detailed)',
    task: 'subject',
    runtime: 'onnx',
    licence: 'Apache-2.0',
    upstream: 'https://github.com/xuebinqin/DIS',
    files: [{ file: 'isnet-general-use-fp16w-88876142.onnx', bytes: 90652906, sha256: '8887614264c5c2ee936718269e6adb16bafab3260d5c6e8a4845bc65b9842f43', source: { urls: ['https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx'], bytes: 178648008, sha256: '60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a', convert: 'fp16-weights' } }],
    hints: { minMemoryGB: 6, webgpu: 'recommended', phones: false },
    tier: 'quality',
    tested: true,
    notes: 'IS-Net (DIS) general-use at 1024×1024; weights stored as float16 (computes in float32).',
  },
  {
    id: 'depth-anything-v2-small',
    name: 'Depth (for Sky)',
    task: 'depth',
    runtime: 'onnx',
    licence: 'Apache-2.0',
    upstream: 'https://github.com/DepthAnything/Depth-Anything-V2',
    files: [{ file: 'depth_anything_v2_vits-fp16w-97c0daee.onnx', bytes: 50049582, sha256: '97c0daee356c3a6d0c5587b7d7c4ab114cc6470e4582d60d335b141ea0ef7a9c', source: { urls: ['https://github.com/fabio-sim/Depth-Anything-ONNX/releases/download/v2.0.0/depth_anything_v2_vits.onnx'], bytes: 99373606, sha256: 'd2b11a11c1d4a12b47608fa65a17ee9a4c605b55ee1730c8e3b526304f2562be', convert: 'fp16-weights' } }],
    hints: { minMemoryGB: 3, webgpu: 'recommended', phones: true },
    tier: 'quality',
    tested: true,
    notes: 'Depth Anything V2 Small (the Apache-2.0 size; Base/Large are non-commercial) at 518×518.',
  },
  {
    id: 'migan-512',
    name: 'Remove objects',
    task: 'inpaint',
    runtime: 'onnx',
    licence: 'MIT',
    upstream: 'https://github.com/Picsart-AI-Research/MI-GAN',
    files: [{ file: 'migan_pipeline_v2-6f1f3530.onnx', bytes: 28079181, sha256: '6f1f3530a1a2324b19752018ce756088b07973cda8d7d890034ace5c8a48c40b', source: {
      urls: [
        'https://huggingface.co/andraniksargsyan/migan/resolve/main/migan_pipeline_v2.onnx',
        // Byte-identical mirrors of the authors' file (same sha256), for when Hugging Face is unreachable.
        'https://github.com/xushengfeng/eSearch/releases/download/13.1.6/migan_pipeline_v2.onnx',
        'https://github.com/marrasen/marraw-models/releases/download/models-v1/migan-pipeline-v2.onnx',
      ],
      bytes: 28079181,
      sha256: '6f1f3530a1a2324b19752018ce756088b07973cda8d7d890034ace5c8a48c40b',
    } }],
    hints: { minMemoryGB: 2, webgpu: 'no', phones: true },
    tier: 'fast',
    tested: true,
    notes: 'MI-GAN 512 Places2 ONNX pipeline (uint8 image + mask in, composite out).',
  },
  {
    id: 'scunet-real',
    name: 'Denoise',
    task: 'denoise',
    runtime: 'onnx',
    licence: 'Apache-2.0',
    upstream: 'https://github.com/cszn/SCUNet',
    files: [{ file: 'scunet_color_real_psnr_fp16-83bd516b.onnx', bytes: 40325163, sha256: '83bd516b28c9d6a3fb733d33fc81c840407764d82d273d43b98903bd21e231cc', source: {
      urls: ['https://github.com/simmmmm/Numa/releases/download/models/scunet_color_real_psnr_fp16.onnx'],
      bytes: 40325163,
      sha256: '83bd516b28c9d6a3fb733d33fc81c840407764d82d273d43b98903bd21e231cc',
    } }],
    hints: { minMemoryGB: 4, webgpu: 'recommended', phones: true },
    tier: 'quality',
    tested: true,
    notes:
      'SCUNet "real PSNR" (blind real-noise model). Third-party ONNX export; all 540 tensors were checked equal (to float16) to the official ' +
      'scunet_color_real_psnr.pth (sha256 fa78899b…, github.com/cszn/KAIR/releases/download/v1.0/). Heavy: tiled, minutes per photo without WebGPU.',
  },
  {
    id: 'realesr-general-x4v3',
    name: 'Super Resolution',
    task: 'upscale',
    runtime: 'onnx',
    licence: 'BSD-3-Clause',
    upstream: 'https://github.com/xinntao/Real-ESRGAN',
    files: [{ file: 'realesr-general-x4v3-x2-012e5a87.onnx', bytes: 2445995, sha256: '012e5a87d1cab65744c626c62ff6234bf29eedcdb7f81a68f7a00370abdfb0c5', source: {
      urls: ['https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-x4v3.pth'],
      bytes: 4885111,
      sha256: '8dc7edb9ac80ccdc30c3a5dca6616509367f05fbc184ad95b731f05bece96292',
      convert: 'srvgg-x2',
    } }],
    hints: { minMemoryGB: 4, webgpu: 'recommended', phones: true },
    tier: 'fast',
    tested: true,
    notes: 'Converted from the official PyTorch weights by scripts/models/convert.mjs: ×4 network, averaged to ×2; float16 weights.',
  },
]

export function modelEntry(id: string): ModelEntry | undefined {
  return MODELS.find((m) => m.id === id)
}

/** Download size of a model (all its files). */
export const modelBytes = (m: ModelEntry): number => m.files.reduce((n, f) => n + f.bytes, 0)
