// Thin WebGL2 helpers: capability check, programs with cached uniform
// locations, render targets, uploads and a full-screen triangle.

import type { Mat3 } from '../color/matrices'

export type Format = 'rgba16f' | 'rgba32f' | 'r16f' | 'rgba8'

export interface Texture {
  tex: WebGLTexture
  width: number
  height: number
}

export interface Target extends Texture {
  fbo: WebGLFramebuffer
  format: Format
  linear: boolean
}

export interface Caps {
  /** EXT_color_buffer_float: 32-bit float render targets (and readback). */
  float32: boolean
  /** OES_texture_float_linear. */
  float32Linear: boolean
  maxTexture: number
  /** Largest render target edge (texture, renderbuffer and viewport limits). */
  maxTarget: number
}

const VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`

export function detectCaps(gl: WebGL2RenderingContext): Caps | null {
  const float32 = !!gl.getExtension('EXT_color_buffer_float')
  const half = !!gl.getExtension('EXT_color_buffer_half_float')
  if (!float32 && !half) return null
  const float32Linear = !!gl.getExtension('OES_texture_float_linear')
  const vp = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array
  const maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
  const caps = { float32, float32Linear, maxTexture, maxTarget: Math.min(maxTexture, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number, vp[0], vp[1]) }
  // Some drivers advertise the extension but can't render RGBA16F: check for real.
  const gpu = new Gpu(gl, caps)
  const t = gpu.target(4, 4, 'rgba16f')
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
  gpu.free(t)
  gpu.dispose()
  return ok ? caps : null
}

export class Program {
  private locs = new Map<string, WebGLUniformLocation | null>()
  readonly prog: WebGLProgram
  private gl: WebGL2RenderingContext

  constructor(gl: WebGL2RenderingContext, frag: string, vert = VERT) {
    this.gl = gl
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
        const log = gl.getShaderInfoLog(s)
        const numbered = src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n')
        throw new Error(`Shader compile failed: ${log}\n${numbered}`)
      }
      return s
    }
    const p = gl.createProgram()!
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vert))
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, frag))
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(`Program link failed: ${gl.getProgramInfoLog(p)}`)
    this.prog = p
  }

  private loc(name: string) {
    let l = this.locs.get(name)
    if (l === undefined) {
      l = this.gl.getUniformLocation(this.prog, name)
      this.locs.set(name, l)
    }
    return l
  }

  /** float / vec2 / vec3 / vec4 by argument count. */
  f(name: string, ...v: number[]): this {
    const l = this.loc(name), gl = this.gl
    if (v.length === 1) gl.uniform1f(l, v[0])
    else if (v.length === 2) gl.uniform2f(l, v[0], v[1])
    else if (v.length === 3) gl.uniform3f(l, v[0], v[1], v[2])
    else gl.uniform4f(l, v[0], v[1], v[2], v[3])
    return this
  }

  i(name: string, ...v: number[]): this {
    const l = this.loc(name), gl = this.gl
    if (v.length === 1) gl.uniform1i(l, v[0])
    else if (v.length === 2) gl.uniform2i(l, v[0], v[1])
    else gl.uniform4i(l, v[0], v[1], v[2], v[3])
    return this
  }

  b(name: string, v: boolean): this {
    this.gl.uniform1i(this.loc(name), v ? 1 : 0)
    return this
  }

  /** Row-major 3×3 (as in color/matrices.ts). */
  m3(name: string, m: Mat3 | readonly number[]): this {
    this.gl.uniformMatrix3fv(this.loc(name), true, m as number[])
    return this
  }

  v4a(name: string, data: Float32Array): this {
    this.gl.uniform4fv(this.loc(name), data)
    return this
  }

  tex(name: string, t: Texture, unit: number): this {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, t.tex)
    gl.uniform1i(this.loc(name), unit)
    return this
  }
}

/** Texture unit for creating / uploading textures (passes bind 0…10). */
const SCRATCH_UNIT = 15

// Sized internal formats (GL enum values, so this module loads without a WebGL global).
const INTERNAL: Record<Format, number> = { rgba16f: 0x881a, rgba32f: 0x8814, r16f: 0x822d, rgba8: 0x8058 }

export class Gpu {
  readonly gl: WebGL2RenderingContext
  readonly caps: Caps
  private programs = new Map<string, Program>()
  private vao: WebGLVertexArrayObject
  private pool: Target[] = []

  constructor(gl: WebGL2RenderingContext, caps: Caps) {
    this.gl = gl
    this.caps = caps
    this.vao = gl.createVertexArray()!
  }

  /**
   * Creating or uploading a texture binds it to the active unit; do that on a unit passes never
   * use, so a texture made between a pass's tex() calls and its draw can't replace one of them.
   */
  private scratchUnit() {
    this.gl.activeTexture(this.gl.TEXTURE0 + SCRATCH_UNIT)
  }

  program(key: string, frag: () => string, vert?: () => string): Program {
    let p = this.programs.get(key)
    if (!p) {
      p = new Program(this.gl, frag(), vert?.())
      this.programs.set(key, p)
    }
    this.gl.useProgram(p.prog)
    return p
  }

  /** Best available format: 32-bit only where renderable; single-channel falls back to RGBA. */
  private resolve(format: Format): Format {
    if (format === 'rgba32f' && !this.caps.float32) return 'rgba16f'
    if (format === 'r16f' && !this.caps.float32) return 'rgba16f'
    return format
  }

  private texture(width: number, height: number, internal: number, linear: boolean): WebGLTexture {
    const gl = this.gl
    this.scratchUnit()
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texStorage2D(gl.TEXTURE_2D, 1, internal, width, height)
    const f = linear ? gl.LINEAR : gl.NEAREST
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return tex
  }

  /** A render target; reuses a pooled one of the same size and format. */
  target(width: number, height: number, format: Format, linear = false): Target {
    const fmt = this.resolve(format)
    const lin = linear && (fmt !== 'rgba32f' || this.caps.float32Linear)
    const i = this.pool.findIndex((t) => t.width === width && t.height === height && t.format === fmt && t.linear === lin)
    if (i >= 0) return this.pool.splice(i, 1)[0]
    const gl = this.gl
    const tex = this.texture(width, height, INTERNAL[fmt], lin)
    const fbo = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    return { tex, fbo, width, height, format: fmt, linear: lin }
  }

  /** Return a target to the pool (kept small; the rest is deleted). */
  free(t: Target | null | undefined) {
    if (!t) return
    this.pool.push(t)
    while (this.pool.length > 12) this.destroy(this.pool.shift()!)
  }

  destroy(t: Target | Texture | null | undefined) {
    if (!t) return
    this.gl.deleteTexture(t.tex)
    if ('fbo' in t) this.gl.deleteFramebuffer(t.fbo)
  }

  /** Drop pooled targets (after an export, so its big tiles don't linger). */
  trim() {
    this.pool.forEach((t) => this.destroy(t))
    this.pool = []
  }

  /** RGB 16-bit integer texture from a window of an interleaved Uint16 image (no conversion, full precision). */
  uploadRgb16(data: Uint16Array, rowLength: number, x: number, y: number, width: number, height: number): Texture {
    const gl = this.gl
    this.scratchUnit()
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGB16UI, width, height)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2)
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, rowLength)
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, x)
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, y)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGB_INTEGER, gl.UNSIGNED_SHORT, data)
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0)
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0)
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
    this.nearest()
    return { tex, width, height }
  }

  /** 8-bit single-channel texture (0…1 in the shader, texelFetch). */
  uploadR8(data: Uint8Array, width: number, height: number): Texture {
    const gl = this.gl
    this.scratchUnit()
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8, width, height)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RED, gl.UNSIGNED_BYTE, data)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
    this.nearest()
    return { tex, width, height }
  }

  /** Float texture (sampled with texelFetch). channels: 1 → R32F, 3 → RGB32F, 4 → RGBA32F. */
  uploadFloat(data: Float32Array, width: number, height: number, channels: 1 | 3 | 4, existing?: Texture): Texture {
    const gl = this.gl
    const [internal, format] = channels === 1 ? [gl.R32F, gl.RED] : channels === 3 ? [gl.RGB32F, gl.RGB] : [gl.RGBA32F, gl.RGBA]
    this.scratchUnit()
    let tex = existing?.width === width && existing.height === height ? existing.tex : null
    if (!tex) {
      if (existing) gl.deleteTexture(existing.tex)
      tex = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texStorage2D(gl.TEXTURE_2D, 1, internal, width, height)
      this.nearest()
    } else gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, format, gl.FLOAT, data)
    return { tex, width, height }
  }

  private nearest() {
    const gl = this.gl
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  }

  /** Run the bound program over a target (or the canvas when null). */
  draw(target: Target | null, width?: number, height?: number) {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null)
    gl.viewport(0, 0, width ?? target!.width, height ?? target!.height)
    gl.bindVertexArray(this.vao)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  /** Run the bound program over part of a target (viewport = that rectangle, so nothing else is touched). */
  drawRect(target: Target, x: number, y: number, width: number, height: number) {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo)
    gl.viewport(x, y, width, height)
    gl.bindVertexArray(this.vao)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  /** Instanced draw with a custom vertex shader (it builds its own geometry from gl_VertexID / gl_InstanceID). */
  drawInstanced(target: Target, vertices: number, instances: number) {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo)
    gl.viewport(0, 0, target.width, target.height)
    gl.bindVertexArray(this.vao)
    gl.drawArraysInstanced(gl.TRIANGLES, 0, vertices, instances)
  }

  /** Blending for the next draws: add (a + b), max, screen (a + b − ab), erase (b·(1 − a)). */
  blend(mode: 'none' | 'add' | 'max' | 'screen' | 'erase') {
    const gl = this.gl
    if (mode === 'none') {
      gl.disable(gl.BLEND)
      return
    }
    gl.enable(gl.BLEND)
    gl.blendEquation(mode === 'max' ? gl.MAX : gl.FUNC_ADD)
    if (mode === 'add') gl.blendFunc(gl.ONE, gl.ONE)
    else if (mode === 'screen') gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR)
    else if (mode === 'erase') gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_COLOR)
  }

  private dummyTex: Target | null = null
  /** A 1×1 texture to bind to samplers a pass doesn't use (never a pass's own target). */
  dummy(): Target {
    if (!this.dummyTex) {
      this.dummyTex = this.target(1, 1, 'rgba16f')
      this.clear(this.dummyTex)
    }
    return this.dummyTex
  }

  clear(target: Target, r = 0, g = 0, b = 0, a = 0) {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo)
    gl.viewport(0, 0, target.width, target.height)
    gl.clearColor(r, g, b, a)
    gl.clear(gl.COLOR_BUFFER_BIT)
  }

  /** A framebuffer writing several same-size targets at once (layout(location = i) outputs). */
  multi(targets: Target[]): WebGLFramebuffer {
    const gl = this.gl
    const fbo = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    targets.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t.tex, 0))
    gl.drawBuffers(targets.map((_, i) => gl.COLOR_ATTACHMENT0 + i))
    return fbo
  }

  drawMulti(fbo: WebGLFramebuffer, width: number, height: number) {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.viewport(0, 0, width, height)
    gl.bindVertexArray(this.vao)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  /** Read a target back: RGBA8 → bytes, float targets → Float32. */
  read(t: Target, x = 0, y = 0, width = t.width, height = t.height): Uint8Array | Float32Array {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo)
    if (t.format === 'rgba8') {
      const out = new Uint8Array(width * height * 4)
      gl.readPixels(x, y, width, height, gl.RGBA, gl.UNSIGNED_BYTE, out)
      return out
    }
    const out = new Float32Array(width * height * 4)
    // Without EXT_color_buffer_float, half-float targets may only be readable as HALF_FLOAT.
    if (!this.caps.float32 && gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_TYPE) === gl.HALF_FLOAT) {
      const half = new Uint16Array(width * height * 4)
      gl.readPixels(x, y, width, height, gl.RGBA, gl.HALF_FLOAT, half)
      for (let i = 0; i < half.length; i++) out[i] = halfToFloat(half[i])
      return out
    }
    gl.readPixels(x, y, width, height, gl.RGBA, gl.FLOAT, out)
    return out
  }

  dispose() {
    this.destroy(this.dummyTex)
    this.dummyTex = null
    this.trim()
    this.programs.forEach((p) => this.gl.deleteProgram(p.prog))
    this.programs.clear()
    this.gl.deleteVertexArray(this.vao)
  }
}

function halfToFloat(h: number): number {
  const e = (h >> 10) & 0x1f, m = h & 0x3ff, s = h & 0x8000 ? -1 : 1
  if (e === 0) return s * m * 2 ** -24
  if (e === 31) return m ? NaN : s * Infinity
  return s * (1 + m / 1024) * 2 ** (e - 15)
}
