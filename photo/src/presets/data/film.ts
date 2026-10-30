import { lin, look, pts, tc, w, type CollectionDef } from './kit'

export const film: CollectionDef = {
  id: 'film',
  name: 'Film',
  description: 'Color film character: grain, gentle highlight roll-off and lifted blacks.',
  looks: [
    look('warm-400', 'Warm 400', 'Warm, forgiving color-negative feel with creamy highlights and fine grain.', ['film', 'warm', 'portrait', 'grain'], {
      wbShift: { temp: 8, tint: 2 },
      basic: { contrast: -6, highlights: -18, shadows: 10, vibrance: 4, saturation: -4 },
      curve: { rgb: tc(0.04, 0.01, 0.03) },
      mixer: { hue: { green: -10 }, sat: { green: -15, blue: -8 }, lum: { orange: 4 } },
      grading: { shadows: w(195, 12), highlights: w(40, 12) },
      effects: { grain: 16 },
    }),
    look('vivid-100', 'Vivid 100', 'Saturated slide-style color with clean whites and a fine grain.', ['film', 'vivid', 'saturated', 'landscape'], {
      basic: { contrast: 18, blacks: -10, vibrance: 18, saturation: 6 },
      curve: { rgb: tc(0, 0.04, 0, -0.01) },
      mixer: { sat: { blue: 12, green: 8, red: 6 } },
      grading: { shadows: w(220, 9) },
      effects: { grain: 6 },
    }),
    look('pastel-400', 'Pastel 400', 'Bright, pastel color like generously exposed negative film.', ['film', 'pastel', 'bright', 'soft'], {
      wbShift: { temp: 4, tint: 4 },
      basic: { exposure: 0.1, contrast: -14, highlights: -25, shadows: 18, saturation: -14 },
      curve: { rgb: tc(0.06, 0, 0.04, 0.03) },
      mixer: { hue: { green: -8 }, sat: { green: -20 }, lum: { blue: 10 } },
      grading: { highlights: w(20, 9) },
      effects: { grain: 14 },
    }),
    look('tungsten-800', 'Tungsten 800', 'Cool, cinematic night film: cyan shadows and warm practical lights.', ['film', 'night', 'cool', 'cinematic', 'grain'], {
      wbShift: { temp: -24, tint: 4 },
      basic: { contrast: 8 },
      curve: { rgb: tc(0.03, 0.02, 0.02) },
      mixer: { sat: { orange: 6 } },
      grading: { shadows: w(190, 21), highlights: w(30, 9) },
      effects: { grain: 26, vignette: -12 },
    }),
    look('expired', 'Expired', 'Drifting color, faded blacks and heavy grain from a roll left too long.', ['film', 'vintage', 'faded', 'grain', 'lo-fi'], {
      wbShift: { temp: 6, tint: 8 },
      basic: { contrast: -8, saturation: -10 },
      curve: { rgb: tc(0.08, 0.02, 0.05), r: lin(0.02, 0.98), g: pts(0, 0.03, 0.5, 0.5, 1, 0.95), b: pts(0, 0.07, 0.5, 0.48, 1, 0.9) },
      grading: { highlights: w(60, 15) },
      effects: { grain: 30, vignette: -14 },
    }),
  ],
}
