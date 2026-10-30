import { look, tc, w, type CollectionDef } from './kit'

export const street: CollectionDef = {
  id: 'street',
  name: 'Street',
  description: 'Gritty contrast and muted color for life on the street.',
  looks: [
    look('gritty', 'Gritty', 'Textured, warm-gray grit with grain and a dark edge.', ['street', 'gritty', 'contrast', 'grain'], {
      wbShift: { temp: 3, tint: 0 },
      basic: { contrast: 26, blacks: -12, texture: 14, clarity: 22, saturation: -20 },
      curve: { rgb: tc(0.02, 0.04) },
      effects: { grain: 20, vignette: -18 },
    }),
    look('urban-cool', 'Urban Cool', 'Cool steel tones and muted color for city streets.', ['street', 'cool', 'urban', 'muted'], {
      wbShift: { temp: -10, tint: 0 },
      basic: { contrast: 14, clarity: 8, saturation: -14 },
      curve: { rgb: tc(0.02, 0.02) },
      grading: { shadows: w(205, 18), highlights: w(210, 6) },
    }),
    look('neon-street', 'Neon Street', 'Glowing signs: punchy purples, magentas and blues.', ['street', 'night', 'neon', 'vivid'], {
      basic: { exposure: -0.1, contrast: 18, blacks: -10, vibrance: 20 },
      curve: { rgb: tc(0, 0.03) },
      mixer: { hue: { blue: 8 }, sat: { purple: 20, magenta: 20, blue: 14, aqua: 10 } },
      grading: { shadows: w(250, 18) },
      effects: { vignette: -16 },
    }),
    look('documentary', 'Documentary', 'Honest color and contrast that stay out of the story’s way.', ['street', 'documentary', 'natural', 'muted'], {
      basic: { contrast: 14, highlights: -12, blacks: -6, clarity: 8, saturation: -10 },
      curve: { rgb: tc(0, 0.025) },
      effects: { grain: 10 },
    }),
    look('late-light', 'Late Light', 'Low afternoon sun raking across the street.', ['street', 'warm', 'golden', 'contrast'], {
      wbShift: { temp: 12, tint: 0 },
      basic: { contrast: 14, highlights: -20, clarity: 8 },
      curve: { rgb: tc(0, 0.03) },
      grading: { shadows: w(215, 15), highlights: w(38, 21) },
      effects: { vignette: -14 },
    }),
  ],
}
