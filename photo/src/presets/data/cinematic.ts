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
  ],
}
