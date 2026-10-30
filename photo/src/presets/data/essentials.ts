import { look, tc, w, type CollectionDef } from './kit'

export const essentials: CollectionDef = {
  id: 'essentials',
  name: 'Essentials',
  description: 'Everyday finishing touches that suit almost any photo.',
  looks: [
    look('clean', 'Clean', 'A light polish: recovered highlights, open shadows and a touch of color.', ['natural', 'everyday', 'subtle'], {
      basic: { contrast: 8, highlights: -20, shadows: 14, whites: 6, blacks: -4, vibrance: 10, clarity: 5 },
      curve: { rgb: tc(0, 0.012) },
    }),
    look('punchy', 'Punchy', 'Bold contrast and lively color without going neon.', ['vivid', 'contrast', 'bold'], {
      basic: { contrast: 22, highlights: -22, shadows: 12, blacks: -8, vibrance: 22, saturation: 4, clarity: 10 },
      curve: { rgb: tc(0, 0.03) },
    }),
    look('soft', 'Soft', 'Low contrast and gentle tones for a calm, forgiving finish.', ['soft', 'low contrast', 'gentle'], {
      basic: { contrast: -14, highlights: -25, shadows: 18, clarity: -8, saturation: -6 },
      curve: { rgb: tc(0.03, 0, 0.02) },
      effects: { fade: 4 },
    }),
    look('matte', 'Matte', 'Lifted blacks, softened whites and quieter color.', ['matte', 'faded', 'muted'], {
      wbShift: { temp: 3, tint: 0 },
      basic: { contrast: -4, saturation: -10 },
      curve: { rgb: tc(0.08, 0.02, 0.03) },
      grading: { shadows: w(30, 6) },
      effects: { vignette: -8 },
    }),
    look('bright', 'Bright', 'Opens up the whole frame while keeping highlights intact.', ['bright', 'light', 'airy'], {
      wbShift: { temp: -2, tint: 0 },
      basic: { exposure: 0.15, contrast: -8, highlights: -30, shadows: 28, whites: 8, saturation: -4 },
      curve: { rgb: tc(0.015, 0, 0, 0.02) },
    }),
    look('hushed', 'Hushed', 'Darker, cooler and quieter — a restrained mood.', ['moody', 'dark', 'muted', 'cool'], {
      wbShift: { temp: -4, tint: 0 },
      basic: { exposure: -0.12, contrast: 10, highlights: -30, shadows: -4, blacks: -6, saturation: -16 },
      curve: { rgb: tc(0.02, 0.02, 0.02, -0.02) },
      grading: { shadows: w(210, 8) },
      effects: { vignette: -20 },
    }),
    look('crisp', 'Crisp', 'Sharper edges, firm contrast and clean, slightly cool color.', ['sharp', 'clean', 'detail'], {
      wbShift: { temp: -3, tint: 0 },
      basic: { contrast: 12, whites: 6, blacks: -6, texture: 12, clarity: 14, dehaze: 4, vibrance: 8 },
      curve: { rgb: tc(0, 0.015) },
    }),
    look('natural', 'Natural', 'True-to-life color with just enough tonal balance.', ['natural', 'subtle', 'true to life'], {
      basic: { highlights: -15, shadows: 10, vibrance: 6 },
      curve: { rgb: tc(0, 0.01) },
      mixer: { sat: { orange: -3 } },
    }),
    look('deep', 'Deep', 'Rich, dense tones with weight in the shadows and darker blues.', ['rich', 'dark', 'contrast'], {
      basic: { exposure: -0.08, contrast: 14, shadows: -6, blacks: -12, vibrance: 6, saturation: 6 },
      curve: { rgb: tc(0, 0.03, 0, -0.03) },
      mixer: { lum: { blue: -10, aqua: -6 } },
      effects: { vignette: -10 },
    }),
    look('gentle', 'Gentle', 'Warm, soft and low-key: a kind finish for people and places.', ['soft', 'warm', 'portrait'], {
      wbShift: { temp: 4, tint: 1 },
      basic: { contrast: -6, highlights: -18, shadows: 12, vibrance: 4 },
      curve: { rgb: tc(0.03, 0, 0.02) },
      grading: { highlights: w(45, 4) },
    }),
  ],
}
