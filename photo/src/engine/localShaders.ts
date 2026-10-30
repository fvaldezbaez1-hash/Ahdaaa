// GLSL for local adjustments (masks, layer parameters) and retouching. The mask
// math mirrors masks.ts (unit-tested there). Same conventions as shaders.ts.

import { HEAD, PRELUDE } from './shaders'

const SS = `
float ss(float a, float b, float x) { float t = clamp((x - a) / max(b - a, 1e-6), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
`

/**
 * One mask of a layer, combined into the layer's running mask. Types: 0 linear, 1 radial,
 * 2 brush (pre-rasterized), 3 luminance range, 4 color range. Positions in source px.
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

/** One layer's contribution (mask × its 16 numbers) added into the 4 local-parameter targets. */
export const LOCAL = () => `${PRELUDE}
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
layout(location = 2) out vec4 o2;
layout(location = 3) out vec4 o3;
uniform sampler2D u_mask;
uniform vec4 u_v[4];
void main() {
  float m = texelFetch(u_mask, ivec2(gl_FragCoord.xy), 0).r;
  o0 = u_v[0] * m;
  o1 = u_v[1] * m;
  o2 = u_v[2] * m;
  o3 = u_v[3] * m;
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
