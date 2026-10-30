import { look, tc, w, type CollectionDef } from './kit'

export const travel: CollectionDef = {
  id: 'travel',
  name: 'Travel',
  description: 'Bright, inviting color that feels like being there.',
  looks: [
    look('postcard', 'Postcard', 'Bright and inviting: blue skies, clear water, clean light.', ['travel', 'vivid', 'blue', 'sky'], {
      wbShift: { temp: 2, tint: 0 },
      basic: { contrast: 10, highlights: -20, shadows: 12, vibrance: 22 },
      curve: { rgb: tc(0, 0.02) },
      mixer: { sat: { blue: 12, aqua: 10 }, lum: { blue: -8 } },
    }),
    look('wanderlust', 'Wanderlust', 'Warm, softly faded travel-journal color.', ['travel', 'warm', 'faded', 'soft'], {
      wbShift: { temp: 8, tint: 2 },
      basic: { contrast: -4, vibrance: 8, saturation: -6 },
      curve: { rgb: tc(0.05, 0.01, 0.02) },
      mixer: { hue: { green: -6 }, sat: { green: -10 } },
      grading: { shadows: w(190, 15), highlights: w(40, 15) },
    }),
    look('tropical', 'Tropical', 'Turquoise water and lush greens under warm sun.', ['travel', 'beach', 'aqua', 'vivid', 'summer'], {
      wbShift: { temp: 4, tint: 0 },
      basic: { contrast: 8, vibrance: 16 },
      curve: { rgb: tc(0, 0.02) },
      mixer: { hue: { blue: -10 }, sat: { aqua: 24, blue: 10, green: 12 } },
    }),
    look('mediterranean', 'Mediterranean', 'Sun-warmed walls under a deep blue sky.', ['travel', 'warm', 'blue', 'summer'], {
      wbShift: { temp: 8, tint: 0 },
      basic: { contrast: 12, highlights: -20 },
      curve: { rgb: tc(0, 0.02) },
      mixer: { sat: { blue: 16, orange: 8, yellow: 6 }, lum: { blue: -14 } },
      grading: { highlights: w(42, 12) },
    }),
    look('road-trip', 'Road Trip', 'Faded, sunny roadside color with a little grain.', ['travel', 'retro', 'warm', 'faded'], {
      wbShift: { temp: 10, tint: 2 },
      basic: { contrast: 4, saturation: -10 },
      curve: { rgb: tc(0.06, 0.02, 0.03) },
      mixer: { hue: { blue: -8 }, sat: { blue: -6 } },
      grading: { shadows: w(180, 15), highlights: w(42, 21) },
      effects: { grain: 14, vignette: -12 },
    }),
  ],
}
