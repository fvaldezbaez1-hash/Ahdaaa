// GLSL for local adjustments (masks, layer parameters) and retouching. The mask
// math mirrors masks.ts (unit-tested there). Same conventions as shaders.ts.

import { AI_RANGE_SIGMA, AI_SPATIAL_SIGMA } from './masks'
import { HEAD, PRELUDE } from './shaders'

const SS = `
float ss(float a, float b, float x) { float t = clamp((x - a) / max(b - a, 1e-6), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
`

/**
 * One mask of a layer, combined into the layer's running mask. Types: 0 linear, 1 radial,
 * 2 brush (pre-rasterized), 3 luminance range, 4 color range, 5 AI (low-res raster refined by
 * joint bilateral upsampling against the photo). Positions in source px.
 */
export const MASK = () => `${HEAD}${SS}
uniform sampler2D u_prev;
uniform sampler2D u_brush;
uniform sampler2D u_base;     // the photo as developed without local layers (output-linear)
uniform bool u_first;
uniform int u_mode;           // 0 add, 1 subtract, 2 intersect
uniform bool u_invert;
uniform int u_type;
uniform mat3 u_toSource;
uniform vec2 u_regionOrigin;
uniform vec4 u_a;
uniform vec4 u_b;
uniform float u_px;           // source px per output px (antialiasing width)
uniform vec3 u_outLuma;
uniform sampler2D u_raster;   // AI mask, 0…1, covering the whole source
uniform bool u_hasRaster;
uniform vec2 u_rasterSize;
uniform sampler2D u_scene;    // the photo in the region (source primaries) — the guide
uniform vec3 u_luma;
uniform mat3 u_fromSource;    // source px → output px
uniform vec2 u_fullSize;
float guide(vec2 q) {
  ivec2 i = clamp(ivec2(floor(q)), ivec2(0), textureSize(u_scene, 0) - 1);
  return log2(max(dot(texelFetch(u_scene, i, 0).rgb, u_luma), 1e-4));
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec2 X = (u_toSource * vec3(gl_FragCoord.xy + u_regionOrigin, 1.0)).xy;
  float v = 0.0;
  if (u_type == 0) {
    vec2 d = u_a.zw - u_a.xy;
    float l2 = dot(d, d);
    v = l2 < 1e-12 ? 1.0 : 1.0 - ss(0.0, 1.0, dot(X - u_a.xy, d) / l2);
  } else if (u_type == 1) {
    float c = cos(u_b.x), s = sin(u_b.x);
    vec2 d = X - u_a.xy;
    float dist = length(vec2((c * d.x + s * d.y) / u_a.z, (-s * d.x + c * d.y) / u_a.w));
    v = 1.0 - ss(1.0 - max(u_b.y, u_px / min(u_a.z, u_a.w)), 1.0, dist);
  } else if (u_type == 2) {
    v = texelFetch(u_brush, p, 0).r;
  } else if (u_type == 5) {
    if (u_hasRaster) {
      // 4×4 raster samples weighted by distance and by the photo's luminance where each sits
      // vs. here, so the edge follows hair and outlines at any resolution (see masks.ts aiMaskValue).
      vec2 R = X / u_fullSize * u_rasterSize;
      ivec2 b = ivec2(floor(R - 0.5)) - 1, last = ivec2(u_rasterSize) - 1;
      float here = guide(gl_FragCoord.xy), sum = 0.0, wsum = 0.0;
      for (int j = 0; j < 4; j++)
        for (int i = 0; i < 4; i++) {
          ivec2 c = clamp(b + ivec2(i, j), ivec2(0), last);
          vec2 ds = R - (vec2(b + ivec2(i, j)) + 0.5);
          vec2 q = (u_fromSource * vec3((vec2(c) + 0.5) / u_rasterSize * u_fullSize, 1.0)).xy - u_regionOrigin;
          float dl = guide(q) - here;
          float w = exp(-dot(ds, ds) / ${(2 * AI_SPATIAL_SIGMA ** 2).toFixed(4)} - dl * dl / ${(2 * AI_RANGE_SIGMA ** 2).toFixed(4)});
          sum += w * texelFetch(u_raster, c, 0).r;
          wsum += w;
        }
      v = sum / wsum;
    }
  } else {
    vec3 lin = max(texelFetch(u_base, p, 0).rgb, 0.0);
    if (u_type == 3) {
      float l = encode1(dot(lin, u_outLuma));
      float s = u_a.z * 0.3 + 0.002;
      v = ss(u_a.x - s, u_a.x, l) * (1.0 - ss(u_a.y, u_a.y + s, l));
    } else {
      vec3 e = min(encode(lin), 1.0);
      float mx = max(e.r, max(e.g, e.b)), mn = min(e.r, min(e.g, e.b)), dd = mx - mn;
      float h = 0.0, sat = 0.0;
      if (dd > 1e-9) {
        h = mx == e.r ? mod((e.g - e.b) / dd + 6.0, 6.0) : mx == e.g ? (e.b - e.r) / dd + 2.0 : (e.r - e.g) / dd + 4.0;
        h *= 1.0471976;
        sat = dd / mx;
      }
      float dist = length(sat * vec2(cos(h), sin(h)) - u_a.y * vec2(cos(u_a.x), sin(u_a.x)));
      float t = u_a.z * 0.5;
      v = 1.0 - ss(t, t + u_a.w * 0.4 + 0.01, dist);
    }
  }
  if (u_invert) v = 1.0 - v;
  float prev = u_first ? 0.0 : texelFetch(u_prev, p, 0).r;
  float m = u_first ? v : u_mode == 1 ? prev * (1.0 - v) : u_mode == 2 ? prev * v : max(prev, v);
  outColor = vec4(m, 0.0, 0.0, 1.0);
}`

/** Brush segments as instanced quads; each instance reads its segment (region px) from a texture. */
export const SEGMENT_VERT = () => `${PRELUDE}
uniform sampler2D u_segs;
uniform int u_start;
uniform vec2 u_size;
uniform float u_r;
flat out vec4 v_seg;
void main() {
  int i = u_start + gl_InstanceID;
  vec4 s = texelFetch(u_segs, ivec2(i % 4096, i / 4096), 0);
  v_seg = s;
  vec2 lo = min(s.xy, s.zw) - u_r - 1.0, hi = max(s.xy, s.zw) + u_r + 1.0;
  int id = gl_VertexID;
  vec2 corner = vec2(id == 1 || id == 2 || id == 4 ? 1.0 : 0.0, id == 2 || id == 4 || id == 5 ? 1.0 : 0.0);
  gl_Position = vec4(mix(lo, hi, corner) / u_size * 2.0 - 1.0, 0.0, 1.0);
}`

/** Fragment stage for segments: distance to the segment the quad was built from. */
export const SEGMENT_FRAG = () => `${HEAD}${SS}
flat in vec4 v_seg;
uniform float u_r;
uniform float u_inner;
void main() {
  vec2 p = gl_FragCoord.xy, a = v_seg.xy, d = v_seg.zw - v_seg.xy;
  float l2 = dot(d, d);
  float t = l2 > 0.0 ? clamp(dot(p - a, d) / l2, 0.0, 1.0) : 0.0;
  outColor = vec4(1.0 - ss(u_inner, u_r, length(p - a - t * d)), 0.0, 0.0, 1.0);
}`

/** Composite one stroke (× flow) into the brush mask; blending does screen / erase. */
export const STROKE = () => `${HEAD}
uniform sampler2D u_stroke;
uniform float u_flow;
void main() { outColor = vec4(texelFetch(u_stroke, ivec2(gl_FragCoord.xy), 0).r * u_flow); }`

/** Layers handled per LOCAL pass (more are added with blending). */
export const LAYERS_PER_PASS = 8

/** Up to 8 layers' contributions (mask × their 16 numbers) summed into the 4 local-parameter targets. */
export const LOCAL = () => `${PRELUDE}
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
layout(location = 2) out vec4 o2;
layout(location = 3) out vec4 o3;
${Array.from({ length: LAYERS_PER_PASS }, (_, i) => `uniform sampler2D u_m${i};`).join('\n')}
uniform vec4 u_v[${LAYERS_PER_PASS * 4}];
uniform int u_n;
void add(float m, int i) {
  o0 += u_v[i * 4] * m;
  o1 += u_v[i * 4 + 1] * m;
  o2 += u_v[i * 4 + 2] * m;
  o3 += u_v[i * 4 + 3] * m;
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  o0 = o1 = o2 = o3 = vec4(0.0);
${Array.from({ length: LAYERS_PER_PASS }, (_, i) => `  if (u_n > ${i}) add(texelFetch(u_m${i}, p, 0).r, ${i});`).join('\n')}
}`

export const RING_SAMPLES = 32

/** Heal: log color difference (destination − source) on a ring just outside the spot, per angle. */
export const RING = () => `${HEAD}
uniform sampler2D u_img;
uniform vec2 u_size;
uniform vec2 u_dst;
uniform vec2 u_src;
uniform float u_r;
void main() {
  float a = 6.2831853 * (gl_FragCoord.x - 0.5) / ${RING_SAMPLES}.0;
  vec3 d = vec3(0.0), s = vec3(0.0);
  for (int i = 0; i < 3; i++)
    for (int j = -1; j <= 1; j++) {
      float b = a + float(j) * 0.06;
      vec2 o = vec2(cos(b), sin(b)) * u_r * (1.08 + 0.12 * float(i));
      d += texture(u_img, (u_dst + o) / u_size).rgb;
      s += texture(u_img, (u_src + o) / u_size).rgb;
    }
  outColor = vec4(log2(max(d / 9.0, 1e-5)) - log2(max(s / 9.0, 1e-5)), 1.0);
}`

/**
 * Clone / heal one spot over its bounding box. Heal = the source texture times the harmonic
 * (Poisson-disk) interpolation of the ring's color ratio — seamless cloning on a circle.
 */
export const SPOT = () => `${HEAD}${SS}
uniform sampler2D u_img;
uniform sampler2D u_ring;
uniform vec2 u_size;
uniform vec2 u_origin;
uniform vec2 u_dst;
uniform vec2 u_src;
uniform float u_r;
uniform float u_feather;
uniform float u_opacity;
uniform bool u_heal;
void main() {
  vec2 p = gl_FragCoord.xy + u_origin;
  vec4 d = texelFetch(u_img, ivec2(p), 0);
  vec2 v = p - u_dst;
  float dist = length(v);
  float a = (1.0 - ss(u_r * (1.0 - max(u_feather, 1.0 / u_r)), u_r, dist)) * u_opacity;
  if (a <= 0.0) { outColor = d; return; }
  vec3 s = texture(u_img, (p - u_dst + u_src) / u_size).rgb;
  if (u_heal) {
    // Poisson kernel of the disk; ρ is capped so the 32 ring samples stay smooth near the edge.
    float rho = min(dist / u_r, 0.8), phi = atan(v.y, v.x);
    vec3 num = vec3(0.0);
    float den = 0.0;
    for (int k = 0; k < ${RING_SAMPLES}; k++) {
      float P = (1.0 - rho * rho) / (1.0 - 2.0 * rho * cos(phi - 6.2831853 * float(k) / ${RING_SAMPLES}.0) + rho * rho);
      num += P * texelFetch(u_ring, ivec2(k, 0), 0).rgb;
      den += P;
    }
    s = exp2(log2(max(s, 1e-5)) + num / den);
  }
  outColor = vec4(mix(d.rgb, s, a), d.a);
}`

/** Copy a texture into a rectangle of the target (drawn with that rectangle as viewport). */
export const COPY = () => `${HEAD}
uniform sampler2D u_src;
uniform ivec2 u_origin;
void main() { outColor = texelFetch(u_src, ivec2(gl_FragCoord.xy) - u_origin, 0); }`

/**
 * Removal, step 1 (one pixel): the noise level k (σ = k·√v per channel) of the source around the
 * area, from 192 samples on a ring — a trimmed mean of |high-pass|/√v (see masks.ts noiseLevel).
 */
export const NOISE_LEVEL = () => `${HEAD}
uniform sampler2D u_img;
uniform vec4 u_ring;   // x0, y0, x1, y1 (texture px)
vec3 ratio(vec2 p) {
  ivec2 m = textureSize(u_img, 0) - 2, i = clamp(ivec2(floor(p)), ivec2(1), m);
  vec3 v = texelFetch(u_img, i, 0).rgb, n = vec3(0.0);
  for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++)
      if (x != 0 || y != 0) n += texelFetch(u_img, i + ivec2(x, y), 0).rgb;
  return abs(v - n / 8.0) / sqrt(max(v, 1e-6));
}
vec2 ringPoint(int k) {
  float w = u_ring.z - u_ring.x, h = u_ring.w - u_ring.y, t = (float(k) + 0.5) / 192.0 * 2.0 * (w + h);
  if (t < w) return vec2(u_ring.x + t, u_ring.y);
  t -= w;
  if (t < h) return vec2(u_ring.z, u_ring.y + t);
  t -= h;
  if (t < w) return vec2(u_ring.z - t, u_ring.w);
  return vec2(u_ring.x, u_ring.w - (t - w));
}
void main() {
  vec3 m1 = vec3(0.0);
  for (int k = 0; k < 192; k++) m1 += ratio(ringPoint(k));
  m1 /= 192.0;
  vec3 sum = vec3(0.0), n = vec3(0.0);
  for (int k = 0; k < 192; k++) {
    vec3 r = ratio(ringPoint(k)), keep = step(r, 2.5 * m1);
    sum += r * keep;
    n += keep;
  }
  outColor = vec4(sum / max(n, vec3(1.0)) * 1.2533141 / 1.0606602, 1.0);
}`

/**
 * Removal, step 2: the inpainted fill (bicubic from its own resolution) plus grain at the
 * surroundings' noise level, blended in through the strokes' mask, over the area's bounding box.
 */
export const REMOVE = () => `${HEAD}${SS}
uniform sampler2D u_img;
uniform sampler2D u_mask;    // strokes over the bounding box
uniform sampler2D u_level;   // 1×1 noise level
uniform usampler2D u_fill;
uniform ivec2 u_fillSize;
uniform vec4 u_rect;         // the fill's rectangle in texture px: x, y, w, h
uniform vec2 u_origin;       // bounding box origin in texture px
uniform vec2 u_abs;          // scaled-source px of texel 0 (grain is anchored to the photo, not the tile)
vec3 fill(ivec2 i) { return vec3(texelFetch(u_fill, clamp(i, ivec2(0), u_fillSize - 1), 0).rgb) / 65535.0; }
vec4 cr(float t) {
  float t2 = t * t, t3 = t2 * t;
  return vec4(-0.5 * t3 + t2 - 0.5 * t, 1.5 * t3 - 2.5 * t2 + 1.0, -1.5 * t3 + 2.0 * t2 + 0.5 * t, 0.5 * t3 - 0.5 * t2);
}
float gauss(uvec2 q, uint seed) { return (hash(q + seed) + hash(q + seed + 101u) + hash(q + seed + 211u) - 1.5) * 2.0; }
void main() {
  vec2 p = gl_FragCoord.xy + u_origin;
  vec4 d = texelFetch(u_img, ivec2(p), 0);
  vec2 f = (p - u_rect.xy) / u_rect.zw;
  float m = texelFetch(u_mask, ivec2(gl_FragCoord.xy), 0).r;
  m *= step(0.0, f.x) * step(f.x, 1.0) * step(0.0, f.y) * step(f.y, 1.0);
  if (m <= 0.0) { outColor = d; return; }
  vec2 t = f * vec2(u_fillSize) - 0.5, fr = fract(t);
  ivec2 b = ivec2(floor(t)) - 1;
  vec4 wx = cr(fr.x), wy = cr(fr.y);
  vec3 c = vec3(0.0);
  for (int j = 0; j < 4; j++) {
    vec3 row = vec3(0.0);
    for (int i = 0; i < 4; i++) row += wx[i] * fill(b + ivec2(i, j));
    c += wy[j] * row;
  }
  c = max(c, 0.0);
  uvec2 q = uvec2(p + u_abs + 65536.0);
  c += vec3(gauss(q, 0u), gauss(q, 7u), gauss(q, 13u)) * texelFetch(u_level, ivec2(0), 0).rgb * sqrt(c);
  outColor = vec4(mix(d.rgb, max(c, 0.0), m), d.a);
}`

/** AI noise reduction: the source blended with its denoised copy (same window, same scale). */
export const BLEND = () => `${HEAD}
uniform sampler2D u_a;
uniform sampler2D u_b;
uniform float u_t;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  outColor = mix(texelFetch(u_a, p, 0), texelFetch(u_b, p, 0), u_t);
}`
