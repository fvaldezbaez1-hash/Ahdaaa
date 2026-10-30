import { look, tc, w, type CollectionDef } from './kit'

export const cinematic: CollectionDef = {
  id: 'cinematic',
  name: 'Cinematic',
  description: 'Movie-style grades: teal shadows, warm skin, wide contrast.',
  looks: [
    look('teal-orange', 'Teal & Orange', 'The classic blockbuster split: teal shadows and greens, warm skin.', ['cinematic', 'teal', 'orange', 'contrast'], {
      basic: { contrast: 14, highlights: -20, blacks: -8 },
      curve: { rgb: tc(0.02, 0.03) },
      mixer: { hue: { green: 20, blue: -8 }, sat: { green: -14, aqua: 10, blue: 4, orange: 4 } },
      grading: { shadows: w(185, 33), highlights: w(35, 21), balance: -10 },
      effects: { vignette: -14 },
    }),
    look('night-grade', 'Night Grade', 'Steel-blue night with warm pools of light.', ['cinematic', 'night', 'cool', 'moody'], {
      wbShift: { temp: -16, tint: 6 },
      basic: { exposure: -0.15, contrast: 18, vibrance: 14 },
      curve: { rgb: tc(0.02, 0.03, 0, -0.02) },
      mixer: { sat: { blue: 10, purple: 10 } },
      grading: { shadows: w(215, 27), highlights: w(30, 15) },
      effects: { grain: 14, vignette: -24 },
    }),
    look('faded-cine', 'Faded Cine', 'Washed, warm and quiet, like an old theatrical print.', ['cinematic', 'faded', 'matte', 'warm'], {
      wbShift: { temp: 6, tint: 0 },
      basic: { contrast: -12, saturation: -18 },
      curve: { rgb: tc(0.08, 0.02, 0.04) },
      grading: { shadows: w(200, 15) },
      effects: { fade: 20, grain: 12 },
    }),
    look('bleach-bypass', 'Bleach Bypass', 'Silvery, low-saturation and hard contrast.', ['cinematic', 'desaturated', 'contrast', 'gritty'], {
      basic: { contrast: 32, highlights: -10, blacks: -10, clarity: 14, saturation: -45 },
      curve: { rgb: tc(0, 0.05) },
      grading: { shadows: w(200, 9) },
    }),
    look('noir', 'Noir', 'Hard-boiled black and white: deep shadows and a heavy vignette.', ['cinematic', 'bw', 'noir', 'dark', 'dramatic'], {
      treatment: 'bw',
      basic: { exposure: -0.2, contrast: 36, blacks: -18, clarity: 10 },
      curve: { rgb: tc(0, 0.05, 0, -0.03) },
      mixer: { bw: { red: 10, blue: -15 } },
      effects: { grain: 22, vignette: -36 },
    }),
    look('big-screen', 'Big Screen', 'Glossy, high-contrast color with deep teal shadows.', ['cinematic', 'contrast', 'teal', 'bold'], {
      basic: { contrast: 22, blacks: -12, vibrance: 10 },
      curve: { rgb: tc(0, 0.04) },
      mixer: { hue: { orange: -3 }, sat: { blue: 8 } },
      grading: { shadows: w(195, 24), highlights: w(30, 18) },
      effects: { vignette: -12 },
    }),
    look('indie', 'Indie', 'Muted, slightly green and faded — small-film intimacy.', ['cinematic', 'muted', 'green', 'faded'], {
      wbShift: { temp: 4, tint: -6 },
      basic: { contrast: -6, saturation: -14 },
      curve: { rgb: tc(0.06, 0.015, 0.03) },
      mixer: { hue: { green: -10 }, sat: { green: -10 } },
      grading: { shadows: w(150, 15), highlights: w(45, 15) },
      effects: { grain: 16 },
    }),
    look('neo-noir', 'Neo-Noir', 'Cyan shadows, magenta highlights and inky blacks.', ['cinematic', 'night', 'neon', 'dark'], {
      basic: { exposure: -0.1, contrast: 26, blacks: -14 },
      curve: { rgb: tc(0, 0.04, 0, -0.02) },
      mixer: { sat: { red: 10 } },
      grading: { shadows: w(190, 30), highlights: w(320, 18) },
      effects: { vignette: -22 },
    }),
    look('desert-epic', 'Desert Epic', 'Amber heat against a teal sky, wide and dusty.', ['cinematic', 'warm', 'desert', 'epic'], {
      wbShift: { temp: 14, tint: -2 },
      basic: { contrast: 16, highlights: -25 },
      curve: { rgb: tc(0.02, 0.03) },
      mixer: { hue: { blue: -10 }, sat: { orange: 10, yellow: -4, blue: -6 } },
      grading: { shadows: w(185, 15), highlights: w(38, 24) },
      effects: { vignette: -10 },
    }),
    look('daydream', 'Daydream', 'Soft, glowing and lifted, with pastel violet and rose.', ['cinematic', 'dreamy', 'soft', 'pastel'], {
      basic: { exposure: 0.1, contrast: -16, highlights: -20, shadows: 16, clarity: -20, saturation: -8 },
      curve: { rgb: tc(0.06, 0, 0.04, 0.02) },
      grading: { shadows: w(250, 15), highlights: w(330, 15) },
      effects: { fade: 6 },
    }),
  ],
}
