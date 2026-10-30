// GLSL for every pass. Conventions: row 0 of every texture is the TOP of the
// image (only the final canvas draw flips); pixel (i, j) has its center at
// (i + 0.5, j + 0.5); colors are linear unless a name says "encoded".

import { LMS_TO_REC2020, OKLAB_M2, REC2020_TO_LMS, inv, type Mat3 } from '../color/matrices'
import { HUE_LUT_SIZE, CURVE_LUT_SIZE } from './params'
import { LUT_LOG_MAX, LUT_LOG_MIN, LUT_SIZE } from './tone'

const f = (x: number) => (Number.isInteger(x) ? x.toFixed(1) : String(x))
/** Row-major → GLSL's column-major constructor. */
const mat = (m: Mat3) => `mat3(${[m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]].map(f).join(', ')})`

/** Shared prelude without an output (MRT shaders declare their own). */
export const PRELUDE = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp usampler2D;
const float LOG2_MID = -2.4739312;
float encode1(float x) { x = max(x, 0.0); return x <= 0.0031308 ? 12.92 * x : 1.055 * pow(x, 1.0 / 2.4) - 0.055; }
vec3 encode(vec3 x) { return vec3(encode1(x.r), encode1(x.g), encode1(x.b)); }
float decode1(float e) { return e <= 0.04045 ? e / 12.92 : pow((e + 0.055) / 1.055, 2.4); }
vec3 decode(vec3 e) { return vec3(decode1(e.r), decode1(e.g), decode1(e.b)); }
float hash(uvec2 p) {
  uint h = p.x * 1664525u + p.y * 22695477u + 1013904223u;
  h ^= h >> 16; h *= 0x7feb352du; h ^= h >> 15; h *= 0x846ca68bu; h ^= h >> 16;
  return float(h) / 4294967295.0;
}
`
export const HEAD = `${PRELUDE}out vec4 outColor;
`

// Shared by develop (full res) and the low-res guide: white balance, clipped
// highlights kept neutral, in the source's own primaries.
const DEVELOP_FN = `
uniform vec3 u_wbMul;
uniform mat3 u_pre;
uniform bool u_raw;
vec3 developPixel(vec3 s) {
  vec3 v = s * u_wbMul;
  if (u_raw) {
    // Where the sensor clipped, the channels' true values are unknown lower bounds; after white
    // balance they'd turn pink/cyan. Raise clipped channels to the highest clipped level → neutral.
    vec3 k = smoothstep(vec3(0.94), vec3(0.995), s);
    float hi = max(max(k.r * u_wbMul.r, k.g * u_wbMul.g), k.b * u_wbMul.b);
    v = mix(v, max(v, vec3(hi)), k);
  }
  return u_pre * v;
}
`

/** Integer source → float, 1:1. */
export const CONVERT = () => `${HEAD}
uniform usampler2D u_src;
void main() { outColor = vec4(vec3(texelFetch(u_src, ivec2(gl_FragCoord.xy), 0).rgb) / 65535.0, 1.0); }`

/** Separable Mitchell–Netravali downscale along one axis (support scales with the ratio, so no aliasing). */
export const RESAMPLE = (intInput: boolean) => `${HEAD}
uniform ${intInput ? 'usampler2D' : 'sampler2D'} u_src;
uniform ivec2 u_srcSize;
uniform int u_axis;
uniform float u_ratio;     // output px per input px (≤ 1)
uniform float u_outOrigin; // absolute index of output px 0 along the axis
uniform float u_inOrigin;  // absolute index of input px 0 along the axis
float mitchell(float x) {
  x = abs(x);
  if (x < 1.0) return (7.0 * x * x * x - 12.0 * x * x + 16.0 / 3.0) / 6.0;
  if (x < 2.0) return (-7.0 / 3.0 * x * x * x + 12.0 * x * x - 20.0 * x + 32.0 / 3.0) / 6.0;
  return 0.0;
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  float c = (float(u_axis == 0 ? p.x : p.y) + u_outOrigin + 0.5) / u_ratio - u_inOrigin;
  float support = 2.0 / u_ratio;
  int n = u_axis == 0 ? u_srcSize.x : u_srcSize.y;
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int j = int(floor(c - support)); j <= int(ceil(c + support)); j++) {
    float w = mitchell((float(j) + 0.5 - c) * u_ratio);
    if (w == 0.0) continue;
    int jj = clamp(j, 0, n - 1);
    ivec2 q = u_axis == 0 ? ivec2(jj, p.y) : ivec2(p.x, jj);
    acc += w * ${intInput ? 'vec3(texelFetch(u_src, q, 0).rgb) / 65535.0' : 'texelFetch(u_src, q, 0).rgb'};
    wsum += w;
  }
  outColor = vec4(max(acc / wsum, 0.0), 1.0);
}`

/** Geometry + input transform: output px → source sample (bicubic) → white-balanced, in source primaries. a = coverage. */
export const DEVELOP = () => `${HEAD}${DEVELOP_FN}
uniform sampler2D u_src;
uniform ivec2 u_srcSize;
uniform vec2 u_srcOrigin;   // scaled-source px of texel 0
uniform float u_scale;      // scaled-source px per full-source px
uniform vec2 u_fullSize;
uniform mat3 u_toSource;    // output px → full-source px
uniform vec2 u_regionOrigin;
uniform bool u_exact;
vec3 fetch(ivec2 p) { return texelFetch(u_src, clamp(p, ivec2(0), u_srcSize - 1), 0).rgb; }
vec4 cr(float t) {
  float t2 = t * t, t3 = t2 * t;
  return vec4(-0.5 * t3 + t2 - 0.5 * t, 1.5 * t3 - 2.5 * t2 + 1.0, -1.5 * t3 + 2.0 * t2 + 0.5 * t, 0.5 * t3 - 0.5 * t2);
}
vec3 bicubic(vec2 P) {
  vec2 t = P - 0.5;
  vec2 fr = fract(t);
  ivec2 b = ivec2(floor(t)) - 1;
  vec4 wx = cr(fr.x), wy = cr(fr.y);
  vec3 acc = vec3(0.0);
  for (int j = 0; j < 4; j++) {
    vec3 row = vec3(0.0);
    for (int i = 0; i < 4; i++) row += wx[i] * fetch(b + ivec2(i, j));
    acc += wy[j] * row;
  }
  return acc;
}
void main() {
  vec2 q = gl_FragCoord.xy + u_regionOrigin;
  vec2 X = (u_toSource * vec3(q, 1.0)).xy;
  vec2 P = X * u_scale - u_srcOrigin;
  vec3 s = u_exact ? fetch(ivec2(floor(P))) : max(bicubic(P), 0.0);
  vec2 d = min(X, u_fullSize - X) * u_scale;
  float inside = clamp(min(d.x, d.y) + 0.5, 0.0, 1.0);
  outColor = vec4(developPixel(s), inside);
}`

/** Noise reduction, step 1: 2×2 average to half resolution (for chroma smoothing). */
export const HALF = () => `${HEAD}
uniform sampler2D u_src;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy) * 2;
  ivec2 m = textureSize(u_src, 0) - 1;
  vec3 c = texelFetch(u_src, min(p, m), 0).rgb + texelFetch(u_src, min(p + ivec2(1, 0), m), 0).rgb
    + texelFetch(u_src, min(p + ivec2(0, 1), m), 0).rgb + texelFetch(u_src, min(p + ivec2(1, 1), m), 0).rgb;
  outColor = vec4(c * 0.25, 1.0);
}`

/** Noise reduction, step 2: separable bilateral blur of color (luminance-edge-aware) at half resolution. */
export const CHROMA_BLUR = () => `${HEAD}
uniform sampler2D u_src;
uniform ivec2 u_dir;
uniform float u_sigma;
uniform int u_radius;
uniform vec3 u_luma;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 m = textureSize(u_src, 0) - 1;
  vec3 c0 = texelFetch(u_src, p, 0).rgb;
  float l0 = log2(max(dot(c0, u_luma), 1e-6));
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int i = -u_radius; i <= u_radius; i++) {
    vec3 c = texelFetch(u_src, clamp(p + u_dir * i, ivec2(0), m), 0).rgb;
    float dl = log2(max(dot(c, u_luma), 1e-6)) - l0;
    float w = exp(-float(i * i) / (2.0 * u_sigma * u_sigma) - dl * dl * 2.0);
    acc += w * c;
    wsum += w;
  }
  outColor = vec4(acc / wsum, 1.0);
}`

/** Noise reduction, step 3: bilateral luminance smoothing + smoothed chroma. Stays in source primaries. */
export const DENOISE = () => `${HEAD}
uniform sampler2D u_src;
uniform sampler2D u_chroma;
uniform vec3 u_luma;
uniform bool u_lumaOn;
uniform float u_sigmaS;
uniform float u_sigmaR;
uniform int u_radius;
uniform float u_lumaMix;
uniform float u_chromaMix;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 m = textureSize(u_src, 0) - 1;
  vec4 c0 = texelFetch(u_src, p, 0);
  float Y = dot(c0.rgb, u_luma);
  float Yf = Y;
  if (u_lumaOn) {
    // Bilateral in a square-root domain, where shot noise has about the same size at every brightness.
    float p0 = sqrt(max(Y, 0.0) + 1e-5);
    float acc = 0.0, wsum = 0.0;
    for (int j = -u_radius; j <= u_radius; j++)
      for (int i = -u_radius; i <= u_radius; i++) {
        float pv = sqrt(max(dot(texelFetch(u_src, clamp(p + ivec2(i, j), ivec2(0), m), 0).rgb, u_luma), 0.0) + 1e-5);
        float d = pv - p0;
        float w = exp(-float(i * i + j * j) / (2.0 * u_sigmaS * u_sigmaS) - d * d / (2.0 * u_sigmaR * u_sigmaR));
        acc += w * pv;
        wsum += w;
      }
    float pf = mix(p0, acc / wsum, u_lumaMix);
    Yf = pf * pf - 1e-5;
  }
  vec3 c = c0.rgb + (Yf - Y);
  if (u_chromaMix > 0.0) {
    vec3 s = texture(u_chroma, gl_FragCoord.xy * 0.5 / vec2(textureSize(u_chroma, 0))).rgb;
    float ys = dot(s, u_luma);
    if (ys > 1e-7) c = mix(c, s * (max(Yf, 0.0) / ys), u_chromaMix);
  }
  outColor = vec4(c, c0.a);
}`

/** Separable Gaussian. Mode 0: .r; 1: log2 luminance of linear rgb; 2: encoded luminance of linear rgb. */
export const BLUR = () => `${HEAD}
uniform sampler2D u_src;
uniform ivec2 u_dir;
uniform float u_sigma;
uniform int u_radius;
uniform int u_mode;
uniform vec3 u_luma;
float value(ivec2 q) {
  vec4 c = texelFetch(u_src, q, 0);
  if (u_mode == 1) return log2(max(dot(c.rgb, u_luma), 1e-10));
  if (u_mode == 2) return encode1(dot(c.rgb, u_luma));
  return c.r;
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 m = textureSize(u_src, 0) - 1;
  float acc = 0.0, wsum = 0.0;
  for (int i = -u_radius; i <= u_radius; i++) {
    float w = exp(-float(i * i) / (2.0 * u_sigma * u_sigma));
    acc += w * value(clamp(p + u_dir * i, ivec2(0), m));
    wsum += w;
  }
  outColor = vec4(acc / wsum, 0.0, 0.0, 1.0);
}`

/** Low-res guide input: centered log2 luminance (I) and dark channel relative to the airlight. */
export const GUIDE_IN = () => `${HEAD}${DEVELOP_FN}
uniform sampler2D u_src;
uniform mat3 u_toWorking;
uniform vec3 u_air;
void main() {
  vec3 c = u_toWorking * developPixel(texelFetch(u_src, ivec2(gl_FragCoord.xy), 0).rgb);
  float I = log2(max(dot(c, vec3(0.2627002, 0.6779981, 0.0593017)), 1e-6)) - LOG2_MID;
  vec3 r = c / u_air;
  outColor = vec4(I, max(min(r.r, min(r.g, r.b)), 0.0), 0.0, 1.0);
}`

/**
 * Box mean along one axis, over in-image samples only, with a radius per channel.
 * Mode 0: channels as they are; 1: (I, I², I, I²) from .r; 2: (I, t, I², I·t) with t = 1 − 0.95·.g.
 */
export const BOX = () => `${HEAD}
uniform sampler2D u_src;
uniform ivec2 u_dir;
uniform vec4 u_radius;
uniform int u_mode;
vec4 value(vec4 v) {
  if (u_mode == 1) return vec4(v.r, v.r * v.r, v.r, v.r * v.r);
  if (u_mode == 2) { float t = 1.0 - 0.95 * v.g; return vec4(v.r, t, v.r * v.r, v.r * t); }
  return v;
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 size = textureSize(u_src, 0);
  int rmax = int(max(max(u_radius.x, u_radius.y), max(u_radius.z, u_radius.w)));
  vec4 acc = vec4(0.0), n = vec4(0.0);
  for (int i = -rmax; i <= rmax; i++) {
    ivec2 q = p + u_dir * i;
    if (any(lessThan(q, ivec2(0))) || any(greaterThanEqual(q, size))) continue;
    vec4 m = step(vec4(abs(float(i))), u_radius);
    acc += m * value(texelFetch(u_src, q, 0));
    n += m;
  }
  outColor = acc / max(n, vec4(1.0));
}`

/** Min filter of .g along one axis (dark channel prior), keeps .r. */
export const MIN_FILTER = () => `${HEAD}
uniform sampler2D u_src;
uniform ivec2 u_dir;
uniform int u_radius;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 m = textureSize(u_src, 0) - 1;
  vec4 c = texelFetch(u_src, p, 0);
  float v = c.g;
  for (int i = -u_radius; i <= u_radius; i++) v = min(v, texelFetch(u_src, clamp(p + u_dir * i, ivec2(0), m), 0).g);
  outColor = vec4(c.r, v, 0.0, 1.0);
}`

/** Guided-filter coefficients. Mode 0: two self-guided scales (xy, zw). Mode 1: guide I, input t. */
export const GF_COEF = () => `${HEAD}
uniform sampler2D u_src;
uniform int u_mode;
uniform vec2 u_eps;
void main() {
  vec4 s = texelFetch(u_src, ivec2(gl_FragCoord.xy), 0);
  if (u_mode == 0) {
    float a1 = max(s.y - s.x * s.x, 0.0); a1 = a1 / (a1 + u_eps.x);
    float a2 = max(s.w - s.z * s.z, 0.0); a2 = a2 / (a2 + u_eps.y);
    outColor = vec4(a1, s.x - a1 * s.x, a2, s.z - a2 * s.z);
  } else {
    float a = (s.w - s.x * s.y) / (max(s.z - s.x * s.x, 0.0) + u_eps.x);
    outColor = vec4(a, s.y - a * s.x, 0.0, 1.0);
  }
}`

/**
 * The main per-pixel pass: local white balance, dehaze, exposure, local tone, tone curve,
 * color, point curve → output-linear. Every slider is the global value plus what the
 * local layers add here (u_lp0…3, summed per pixel by the LOCAL pass).
 */
export const TONE = (layers: boolean) => `${HEAD}
#define LAYERS ${layers ? 1 : 0}
uniform sampler2D u_scene;
uniform sampler2D u_fine;
uniform sampler2D u_coef;
uniform sampler2D u_haze;
uniform sampler2D u_toneLut;
uniform sampler2D u_hueLut;
uniform sampler2D u_curveLut;
uniform sampler2D u_lp0;
uniform sampler2D u_lp1;
uniform sampler2D u_lp2;
uniform sampler2D u_lp3;
uniform bool u_layersOn;
uniform mat3 u_toWorking;
uniform vec3 u_luma;
uniform mat3 u_toSource;
uniform vec2 u_regionOrigin;
uniform vec2 u_fullSize;
uniform float u_exposure;
uniform bool u_local;
uniform bool u_fineOn;
uniform float u_highlights;
uniform float u_shadows;
uniform float u_clarity;
uniform float u_texture;
uniform float u_dehaze;
uniform bool u_hazeOn;
uniform vec3 u_air;
uniform bool u_raw;
uniform vec3 u_curve3;      // contrast, whites, blacks (global + profile)
uniform float u_contrastExp;
uniform bool u_colorOn;
uniform bool u_hueOn;
uniform bool u_bw;
uniform float u_sat;
uniform float u_vib;
uniform bool u_gradeOn;
uniform vec4 u_grade[4];
uniform vec2 u_gradeShape;
uniform float u_fade;
uniform bool u_curveOn;
uniform mat3 u_toOutput;
uniform vec3 u_wbTemp;      // LMS log2 gains per unit of local temperature / tint
uniform vec3 u_wbTint;
const mat3 TO_LMS = ${mat(REC2020_TO_LMS)};
const mat3 FROM_LMS = ${mat(LMS_TO_REC2020)};
const mat3 M2 = ${mat(OKLAB_M2)};
const mat3 M2_INV = ${mat(inv(OKLAB_M2))};
vec3 toOklab(vec3 c) { vec3 l = TO_LMS * c; return M2 * (sign(l) * pow(abs(l), vec3(1.0 / 3.0))); }
vec3 fromOklab(vec3 lab) { vec3 l = M2_INV * lab; return FROM_LMS * (l * l * l); }

// ∫ smoothstep(x0, x1, t) dt from −∞ to x, and ∫ (1 − smoothstep(y0, y1, t)) dt from x to ∞.
float rampUp(float x, float x0, float x1) {
  float w = x1 - x0;
  if (x <= x0) return 0.0;
  if (x >= x1) return x - x1 + 0.5 * w;
  float t = (x - x0) / w;
  return w * (t * t * t - 0.5 * t * t * t * t);
}
float rampDown(float x, float y0, float y1) {
  float w = y1 - y0;
  if (x >= y1) return 0.0;
  if (x <= y0) return y0 - x + 0.5 * w;
  float t = (x - y0) / w;
  return w * (t * t * t - t + 0.5 * (1.0 - t * t * t * t));
}
float filmicLut(float x) {
  const float x0 = ${f(2 ** LUT_LOG_MIN)};
  if (x <= x0) return x * texelFetch(u_toneLut, ivec2(0), 0).r / x0;
  float fi = min((log2(x) - ${f(LUT_LOG_MIN)}) * ${f((LUT_SIZE - 1) / (LUT_LOG_MAX - LUT_LOG_MIN))}, ${f(LUT_SIZE - 1)});
  int i = int(fi);
  float a = texelFetch(u_toneLut, ivec2(i, 0), 0).r;
  float b = texelFetch(u_toneLut, ivec2(min(i + 1, ${LUT_SIZE - 1}), 0), 0).r;
  return mix(a, b, fi - float(i));
}
// Display sources: identity up to a knee, then roll off so xmax (what exposure can reach) maps to 1.
float shoulder(float x, float xmax) {
  if (xmax <= 1.0 || x <= 0.0) return min(x, 1.0);
  float knee = max(0.45, 1.0 - 0.5 * log2(xmax));
  if (x <= knee) return x;
  float t = min(1.0, (x - knee) / (xmax - knee));
  return knee + (1.0 - knee) * (1.0 - pow(1.0 - t, (xmax - knee) / (1.0 - knee)));
}
// Contrast S-curve with a fixed pivot (see tone.ts contrastCurve).
float contrastCurve(float p, float k) {
  if (k == 0.0 || p <= 0.0 || p >= 1.0) return p;
  const float S = 5.5;
  float s0 = 1.0 / (1.0 + exp(S * 0.5)), s1 = 1.0 / (1.0 + exp(-S * 0.5));
  float q = pow(p, u_contrastExp);
  float t;
  if (k > 0.0) t = (1.0 / (1.0 + exp(-S * (q - 0.5))) - s0) / (s1 - s0);
  else { float y = s0 + q * (s1 - s0); t = 0.5 + log(y / (1.0 - y)) / S; }
  return pow(clamp(q + abs(k) * (t - q), 0.0, 1.0), 1.0 / u_contrastExp);
}
// The global curve for one channel value: base curve, then contrast, whites, blacks (γ 2.2 domain).
float toneCurve(float x, float xmax, vec3 cwb) {
  float y = u_raw ? filmicLut(x) : shoulder(x, xmax);
  if (x <= 0.0 || cwb == vec3(0.0)) return y;
  float p = pow(clamp(y, 0.0, 1.0), 1.0 / 2.2);
  p = contrastCurve(p, cwb.x);
  p += cwb.y * 0.25 * p * p * p + cwb.z * 0.12 * pow(1.0 - min(p, 1.0), 5.0);
  return pow(clamp(p, 0.0, 1.0), 2.2);
}
// Adobe's hue-preserving RGB tone: curve the largest and smallest channel, interpolate the middle one.
vec3 rgbTone(vec3 c, float xmax, vec3 cwb) {
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
  float tmx = toneCurve(mx, xmax, cwb);
  if (mx - mn < 1e-9) return vec3(tmx);
  float tmn = toneCurve(mn, xmax, cwb);
  return tmn + (tmx - tmn) * (c - mn) / (mx - mn);
}
vec4 hueLut(float deg) {
  float fi = mod(deg + 360.0, 360.0);
  int i = int(fi) % ${HUE_LUT_SIZE};
  return mix(texelFetch(u_hueLut, ivec2(i, 0), 0), texelFetch(u_hueLut, ivec2((i + 1) % ${HUE_LUT_SIZE}, 0), 0), fract(fi));
}
float curve(float e, int ch) {
  float fi = clamp(e, 0.0, 1.0) * ${f(CURVE_LUT_SIZE - 1)};
  int i = int(fi);
  float a = texelFetch(u_curveLut, ivec2(i, 0), 0)[ch];
  float b = texelFetch(u_curveLut, ivec2(min(i + 1, ${CURVE_LUT_SIZE - 1}), 0), 0)[ch];
  return mix(a, b, fi - float(i));
}
void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  vec4 src = texelFetch(u_scene, px, 0);
  vec3 c = u_toWorking * src.rgb;
  float l0 = log2(max(dot(src.rgb, u_luma), 1e-10));
  vec2 uv = (u_toSource * vec3(gl_FragCoord.xy + u_regionOrigin, 1.0)).xy / u_fullSize;

  // Without layers these stay zero and the compiler folds every local term away.
  vec4 L0 = vec4(0.0), L1 = vec4(0.0), L2 = vec4(0.0), L3 = vec4(0.0);
#if LAYERS
  if (u_layersOn) {
    L0 = texelFetch(u_lp0, px, 0);
    L1 = texelFetch(u_lp1, px, 0);
    L2 = texelFetch(u_lp2, px, 0);
    L3 = texelFetch(u_lp3, px, 0);
    // Local white balance: von Kries gains in OKLab's LMS, like a chromatic adaptation.
    if (L3.x != 0.0 || L3.y != 0.0) c = FROM_LMS * (exp2(L3.x * u_wbTemp + L3.y * u_wbTint) * (TO_LMS * c));
  }
#endif
  float exposure = u_exposure + L0.x;
  vec3 cwb = clamp(u_curve3 + vec3(L0.y, L1.x, L1.y), -1.0, 1.0);
  float highlights = clamp(u_highlights + L0.z, -1.0, 1.0), shadows = clamp(u_shadows + L0.w, -1.0, 1.0);
  float texture_ = clamp(u_texture + L1.z, -1.0, 1.0), clarity = clamp(u_clarity + L1.w, -1.0, 1.0);
  float dehaze = clamp(u_dehaze + L2.x, -1.0, 1.0);

  if (u_hazeOn && dehaze != 0.0) {
    vec2 ab = texture(u_haze, uv).rg;
    float tr = clamp(ab.x * (l0 - LOG2_MID) + ab.y, 0.05, 1.0);
    if (dehaze > 0.0) {
      float te = max(1.0 - dehaze * (1.0 - tr), 0.12);
      c = max((c - u_air * (1.0 - te)) / te, 0.0);
    } else c = mix(c, u_air, -dehaze * (0.25 + 0.5 * (1.0 - tr)));
  }
  c *= exp2(exposure);

  if (u_local) {
    // Edge-aware base (B, coarse) from the low-res guided filter applied to this pixel's own
    // luminance (fast guided filter: edges stay pixel-sharp). F = small Gaussian of the luminance;
    // the mid layer M applies its coefficients to F, so the clarity band F−M never holds fine detail.
    vec4 g = texture(u_coef, uv);
    float l = l0 + exposure;
    float F = u_fineOn ? texelFetch(u_fine, px, 0).r + exposure : l;
    float B = g.x * (l0 - LOG2_MID) + g.y + LOG2_MID + exposure;
    float M = g.z * (F - exposure - LOG2_MID) + g.w + LOG2_MID + exposure;
    float xb = B - LOG2_MID;
    float tb = xb + highlights * (highlights < 0.0 ? 0.75 : 0.5) * rampUp(xb, -1.0, 2.5)
                  + shadows * (shadows > 0.0 ? 0.7 : 0.5) * rampDown(xb, -5.0, 0.5);
    float ln = tb + LOG2_MID + (l - B);
    float mid = (F - M) * clarity * 1.3 / (1.0 + pow(xb / 3.0, 4.0));
    ln += mid / sqrt(1.0 + mid * mid);
    float d = l - F;
    float t = d * texture_ * (texture_ > 0.0 ? 1.2 * d * d / (d * d + 0.0009) : 0.9) * smoothstep(-8.0, -5.0, xb);
    ln += t / sqrt(1.0 + 4.0 * t * t);
    c *= exp2(ln - l);
  }

  float xmax = max(1.0, exp2(exposure));
  if (u_raw || xmax > 1.0 || cwb != vec3(0.0)) c = rgbTone(c, xmax, cwb);

  float sat = max(u_sat + L2.y, -1.0);
  if (u_colorOn || sat != u_sat || L3.z != 0.0 || L3.w != 0.0) {
    vec3 lab = toOklab(c);
    float L = lab.x, C = length(lab.yz), h = atan(lab.z, lab.y);
    float cw = smoothstep(0.0, 0.08, C);
    if (u_hueOn) {
      vec4 m = hueLut(degrees(h));
      if (u_bw) L *= 1.0 + m.w * cw;
      else { h += radians(m.x); C *= m.y; L *= 1.0 + m.z * cw; }
    }
    if (u_bw) C = 0.0;
    else {
      float hd = mod(degrees(h) + 360.0, 360.0);
      float skin = exp(-pow((hd - 50.0) / 22.0, 2.0));
      float v = u_vib > 0.0 ? 1.0 + u_vib * 0.9 * (1.0 - smoothstep(0.0, 0.22, C)) * (1.0 - 0.6 * skin)
                            : 1.0 + u_vib * 0.7 * (1.0 - 0.4 * smoothstep(0.0, 0.2, C));
      C *= max(v, 0.0) * max(1.0 + (sat > 0.0 ? 0.8 : 1.0) * sat, 0.0);
    }
    vec2 ab = C * vec2(cos(h), sin(h)) + L3.zw;
    if (u_gradeOn) {
      float tt = pow(clamp(L, 0.0, 1.0), u_gradeShape.x);
      float ws = pow(1.0 - tt, u_gradeShape.y), wh = pow(tt, u_gradeShape.y), wm = max(0.0, 1.0 - ws - wh);
      vec3 gs = ws * u_grade[0].xyz + wm * u_grade[1].xyz + wh * u_grade[2].xyz + u_grade[3].xyz;
      ab += gs.xy;
      L += gs.z;
    }
    L = u_fade + L * (1.0 - u_fade);
    c = fromOklab(vec3(L, ab));
  }

  if (u_curveOn) {
    vec3 e = encode(clamp(c, 0.0, 1.0));
    c = decode(vec3(curve(e.r, 0), curve(e.g, 1), curve(e.b, 2)));
  }
  outColor = vec4(u_toOutput * c, src.a);
}`

/** Neighborhood finishing on the output-linear image: gamut map, sharpen, vignette, grain, clipping. → encoded. */
export const FINISH = (layers: boolean) => `${HEAD}
#define LAYERS ${layers ? 1 : 0}
uniform sampler2D u_img;
uniform sampler2D u_sharp;
uniform ivec2 u_offset;      // inner tile offset inside the region textures
uniform vec2 u_tileOrigin;   // output px of target px 0
uniform vec2 u_outSize;
uniform vec3 u_outLuma;
uniform float u_knee;
uniform bool u_sharpOn;
uniform float u_sharpAmount;
uniform float u_sharpHalo;
uniform vec2 u_mask;
uniform float u_vig;
uniform vec4 u_vigShape;     // start, width, roundness, aspect
uniform float u_grain;
uniform vec3 u_grainShape;   // cell (full-res px), roughness, full-res px per output px
uniform bool u_clip;
uniform bool u_dither;
uniform bool u_layersOn;
uniform sampler2D u_lp2;     // local (dehaze, saturation, sharpness, noise)
uniform bool u_overlayOn;
uniform sampler2D u_overlay; // a layer's mask, tinted red for the masking tools

// Hue-preserving gamut map: desaturate toward the pixel's own luminance, softly from u_knee.
vec3 gamutMap(vec3 c) {
  float Y = dot(c, u_outLuma);
  if (Y >= 1.0) return vec3(1.0);
  if (Y <= 0.0) return vec3(0.0);
  vec3 d = c - Y;
  vec3 lim = vec3(1e9);
  for (int i = 0; i < 3; i++) {
    if (d[i] > 1e-9) lim[i] = (1.0 - Y) / d[i];
    else if (d[i] < -1e-9) lim[i] = -Y / d[i];
  }
  float s = 1.0 / min(lim.x, min(lim.y, lim.z));
  if (s <= u_knee) return c;
  float k = u_knee < 1.0 ? u_knee + (1.0 - u_knee) * tanh((s - u_knee) / (1.0 - u_knee)) : 1.0;
  return Y + d * (k / s);
}
float vnoise(vec2 x) {
  vec2 i = floor(x), fr = x - i;
  vec2 u = fr * fr * fr * (fr * (fr * 6.0 - 15.0) + 10.0);
  uvec2 b = uvec2(ivec2(i) + 65536);
  float a = hash(b), bb = hash(b + uvec2(1, 0)), c = hash(b + uvec2(0, 1)), d = hash(b + uvec2(1, 1));
  return mix(mix(a, bb, u.x), mix(c, d, u.x), u.y) * 2.0 - 1.0;
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy) + u_offset;
  vec4 s = texelFetch(u_img, p, 0);
  vec3 e = encode(gamutMap(s.rgb));
  if (u_sharpOn) {
    float amount = u_sharpAmount, nr = 0.0;
#if LAYERS
    if (u_layersOn) {
      vec4 l2 = texelFetch(u_lp2, p, 0);
      amount += l2.z;
      nr = clamp(l2.w, 0.0, 1.0);
    }
#endif
    float d = encode1(dot(s.rgb, u_outLuma)) - texelFetch(u_sharp, p, 0).r;
    float grad = 0.0;
    if (u_mask.y > 0.0 || nr > 0.0) {
      float gx = texelFetch(u_sharp, p + ivec2(1, 0), 0).r - texelFetch(u_sharp, p - ivec2(1, 0), 0).r;
      float gy = texelFetch(u_sharp, p + ivec2(0, 1), 0).r - texelFetch(u_sharp, p - ivec2(0, 1), 0).r;
      grad = length(vec2(gx, gy));
    }
    if (amount > 0.0) {
      float m = u_mask.y > 0.0 ? smoothstep(u_mask.x, u_mask.y, grad) : 1.0;
      e += amount * d / (1.0 + abs(d) / u_sharpHalo) * m;
    } else e += max(amount, -1.0) * d; // negative sharpness: soften toward the blurred luminance
    // Local noise reduction: smooth flat areas, keep edges.
    if (nr > 0.0) e -= 0.9 * nr * d * (1.0 - smoothstep(0.02, 0.08, grad));
  }
  vec2 q = gl_FragCoord.xy + u_tileOrigin;
  if (u_vig != 0.0) {
    vec2 v = abs(q / u_outSize - 0.5) * 2.0;
    vec2 circle = v * vec2(u_vigShape.w, 1.0) / max(u_vigShape.w, 1.0) * 1.41421;
    vec2 r = mix(v, circle, max(u_vigShape.z, 0.0));
    float n = 2.0 + 6.0 * max(-u_vigShape.z, 0.0);
    float dist = pow(pow(r.x, n) + pow(r.y, n), 1.0 / n) / pow(2.0, 1.0 / n) * 1.41421;
    float mk = smoothstep(u_vigShape.x, u_vigShape.x + u_vigShape.y, dist);
    // Highlight priority: bright areas darken less, so a vignetted sky doesn't turn muddy gray.
    float hl = smoothstep(0.6, 1.0, max(e.r, max(e.g, e.b)));
    e = u_vig < 0.0 ? e * (1.0 + 0.85 * u_vig * mk * (1.0 - 0.5 * hl)) : e + (1.0 - e) * 0.85 * u_vig * mk;
  }
  if (u_grain > 0.0) {
    vec2 gp = q * u_grainShape.z / u_grainShape.x;
    float n1 = vnoise(gp), n2 = vnoise(gp * 2.31 + 17.3);
    float n = mix(n1, 0.55 * n1 + 0.85 * n2, u_grainShape.y);
    float lum = clamp(dot(e, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
    e += n * u_grain * (0.25 + 3.0 * lum * (1.0 - lum));
  }
  if (u_clip && s.a > 0.0) {
    float mx = max(e.r, max(e.g, e.b));
    if (mx >= 0.999) e = vec3(1.0, 0.0, 0.0);
    else if (mx <= 0.002) e = vec3(0.0, 0.3, 1.0);
  }
#if LAYERS
  if (u_overlayOn) e = mix(e, vec3(0.95, 0.12, 0.12), 0.5 * texelFetch(u_overlay, p, 0).r);
#endif
  if (u_dither) e += (hash(uvec2(q)) + hash(uvec2(q) + 7919u) - 1.0) / 255.0;
  outColor = vec4(clamp(e, 0.0, 1.0), s.a);
}`

/** Canvas: place the (before/after) image, flip to GL's bottom-up framebuffer, dither to 8 bits. */
export const PRESENT = () => `${HEAD}
uniform sampler2D u_after;
uniform sampler2D u_before;
uniform vec4 u_rect;    // x, y, w, h in canvas px (top-left origin)
uniform float u_split;  // image x (0…1) left of which "before" shows
uniform float u_canvasH;
void main() {
  vec2 p = vec2(gl_FragCoord.x, u_canvasH - gl_FragCoord.y);
  vec2 uv = (p - u_rect.xy) / u_rect.zw;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) { outColor = vec4(0.0); return; }
  vec4 c = uv.x < u_split ? texture(u_before, uv) : texture(u_after, uv);
  uvec2 h = uvec2(gl_FragCoord.xy);
  c.rgb = clamp(c.rgb + (hash(h) + hash(h + 7919u) - 1.0) / 255.0, 0.0, 1.0);
  outColor = vec4(c.rgb * c.a, c.a);
}`

/** Bilinear downsample (histogram). */
export const DOWNSAMPLE = () => `${HEAD}
uniform sampler2D u_src;
uniform vec2 u_size;
void main() { outColor = texture(u_src, gl_FragCoord.xy / u_size); }`
