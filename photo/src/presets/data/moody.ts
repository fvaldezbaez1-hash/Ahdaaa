import { look, tc, w, type CollectionDef } from './kit'

export const moody: CollectionDef = {
  id: 'moody',
  name: 'Moody',
  description: 'Dark, rich and atmospheric.',
  looks: [
    look('dark-rich', 'Dark & Rich', 'Deep tones and dense color, darker toward the edges.', ['moody', 'dark', 'rich', 'contrast'], {
      basic: { exposure: -0.2, contrast: 18, highlights: -30, blacks: -10, vibrance: 6, saturation: -6 },
      curve: { rgb: tc(0.02, 0.035, 0.02, -0.03) },
      grading: { shadows: w(30, 12) },
      effects: { vignette: -22 },
    }),
    look('storm', 'Storm', 'Brooding cold skies and hard contrast.', ['moody', 'sky', 'cool', 'dramatic'], {
      wbShift: { temp: -10, tint: 0 },
      basic: { contrast: 24, highlights: -50, clarity: 20, dehaze: 14, saturation: -22 },
      curve: { rgb: tc(0.02, 0.04, 0, -0.03) },
      mixer: { lum: { blue: -16 } },
      grading: { shadows: w(210, 18) },
      effects: { vignette: -24 },
    }),
    look('melancholy', 'Melancholy', 'Blue-gray, quiet and wistful.', ['moody', 'muted', 'cool', 'blue'], {
      wbShift: { temp: -8, tint: 0 },
      basic: { contrast: -4, saturation: -28 },
      curve: { rgb: tc(0.06, 0.02, 0.03, -0.02) },
      grading: { shadows: w(215, 18), highlights: w(200, 6) },
    }),
    look('forest-dark', 'Forest Dark', 'Deep olive greens and a damp, earthy mood.', ['moody', 'green', 'forest', 'dark'], {
      wbShift: { temp: 0, tint: -4 },
      basic: { exposure: -0.15, contrast: 16 },
      curve: { rgb: tc(0.03, 0.03, 0.02, -0.03) },
      mixer: { hue: { green: -12 }, sat: { green: -14, yellow: -10 }, lum: { green: -16 } },
      grading: { shadows: w(150, 18), highlights: w(45, 12) },
      effects: { vignette: -24 },
    }),
    look('ember', 'Ember', 'Smoldering reds and oranges in deep darkness.', ['moody', 'warm', 'red', 'dark'], {
      wbShift: { temp: 10, tint: 0 },
      basic: { exposure: -0.15, contrast: 18 },
      curve: { rgb: tc(0.02, 0.035, 0, -0.03) },
      mixer: { sat: { orange: 10, red: 10, blue: -20, green: -16 } },
      grading: { shadows: w(15, 21), highlights: w(35, 18) },
      effects: { vignette: -26 },
    }),
  ],
}
