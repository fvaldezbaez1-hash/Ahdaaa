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
    look('overcast', 'Overcast', 'Flat gray-day light, kept soft and honest.', ['street', 'soft', 'cool', 'muted'], {
      wbShift: { temp: -6, tint: 0 },
      basic: { contrast: -6, clarity: 6, saturation: -14 },
      curve: { rgb: tc(0.05, 0.015, 0.02) },
      grading: { shadows: w(210, 12) },
    }),
    look('neon-street', 'Neon Street', 'Glowing signs: punchy purples, magentas and blues.', ['street', 'night', 'neon', 'vivid'], {
      basic: { exposure: -0.1, contrast: 18, blacks: -10, vibrance: 20 },
      curve: { rgb: tc(0, 0.03) },
      mixer: { hue: { blue: 8 }, sat: { purple: 20, magenta: 20, blue: 14, aqua: 10 } },
      grading: { shadows: w(250, 18) },
      effects: { vignette: -16 },
    }),
    look('rainy-day', 'Rainy Day', 'Wet, cool streets where a red umbrella still pops.', ['street', 'rain', 'cool', 'moody'], {
      wbShift: { temp: -8, tint: 0 },
      basic: { contrast: 6, dehaze: -6, saturation: -12 },
      curve: { rgb: tc(0.05, 0.02, 0.02) },
      mixer: { sat: { red: 10 } },
      grading: { shadows: w(200, 18), highlights: w(190, 6) },
    }),
    look('documentary', 'Documentary', 'Honest color and contrast that stay out of the story’s way.', ['street', 'documentary', 'natural', 'muted'], {
      basic: { contrast: 14, highlights: -12, blacks: -6, clarity: 8, saturation: -10 },
      curve: { rgb: tc(0, 0.025) },
      effects: { grain: 10 },
    }),
    look('contrasty', 'Contrasty', 'Hard light, bright whites and deep blacks.', ['street', 'contrast', 'bold', 'graphic'], {
      basic: { contrast: 34, whites: 12, blacks: -18, clarity: 12, saturation: -4 },
      curve: { rgb: tc(0, 0.05) },
      effects: { vignette: -10 },
    }),
    look('muted-street', 'Muted Street', 'Quiet, desaturated color with soft blacks.', ['street', 'muted', 'faded', 'calm'], {
      basic: { contrast: -4, vibrance: -6, saturation: -24 },
      curve: { rgb: tc(0.05, 0.01, 0.02) },
      mixer: { sat: { red: -10 } },
      grading: { shadows: w(30, 9) },
    }),
    look('late-light', 'Late Light', 'Low afternoon sun raking across the street.', ['street', 'warm', 'golden', 'contrast'], {
      wbShift: { temp: 12, tint: 0 },
      basic: { contrast: 14, highlights: -20, clarity: 8 },
      curve: { rgb: tc(0, 0.03) },
      grading: { shadows: w(215, 15), highlights: w(38, 21) },
      effects: { vignette: -14 },
    }),
    look('shadow-play', 'Shadow Play', 'Deep shadows that turn light and shape into the subject.', ['street', 'dark', 'contrast', 'graphic'], {
      basic: { exposure: -0.05, contrast: 24, highlights: -10, shadows: -20, blacks: -16, saturation: -8 },
      curve: { rgb: tc(0, 0.05, 0, -0.03) },
      effects: { vignette: -20 },
    }),
  ],
}
