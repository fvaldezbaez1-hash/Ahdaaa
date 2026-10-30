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
    look('nordic', 'Nordic', 'Cool, clean and restrained northern light.', ['travel', 'cool', 'muted', 'minimal'], {
      wbShift: { temp: -10, tint: 0 },
      basic: { contrast: 6, highlights: -15, shadows: 10, saturation: -16 },
      curve: { rgb: tc(0.04, 0.01, 0.01) },
      mixer: { sat: { green: -14, yellow: -10 } },
      grading: { shadows: w(205, 12) },
    }),
    look('safari', 'Safari', 'Dusty earth, dry grass and warm afternoon haze.', ['travel', 'warm', 'earth', 'wildlife'], {
      wbShift: { temp: 12, tint: -2 },
      basic: { contrast: 8, clarity: 6 },
      curve: { rgb: tc(0.03, 0.02) },
      mixer: { hue: { green: -16, yellow: -6 }, sat: { green: -20, orange: 8, blue: -10 } },
      grading: { shadows: w(30, 12), highlights: w(40, 15) },
    }),
    look('old-town', 'Old Town', 'Warm stone, soft blacks and a nostalgic edge.', ['travel', 'warm', 'city', 'nostalgic'], {
      wbShift: { temp: 6, tint: 0 },
      basic: { contrast: 6, clarity: 8, saturation: -8 },
      curve: { rgb: tc(0.04, 0.02, 0.02) },
      mixer: { sat: { orange: 6, red: 4 } },
      grading: { shadows: w(30, 12), highlights: w(45, 12) },
      effects: { vignette: -14 },
    }),
    look('market', 'Market', 'Vivid produce, spices and fabric, with crisp detail.', ['travel', 'vivid', 'color', 'street'], {
      basic: { contrast: 12, clarity: 10, vibrance: 24, saturation: 6 },
      curve: { rgb: tc(0, 0.025) },
      mixer: { sat: { red: 8, yellow: 8, orange: 4 } },
    }),
    look('coastal', 'Coastal', 'Breezy, bright blues and soft sand tones.', ['travel', 'beach', 'bright', 'cool', 'airy'], {
      wbShift: { temp: -6, tint: 0 },
      basic: { exposure: 0.1, highlights: -25, shadows: 16, saturation: -4 },
      curve: { rgb: tc(0.03, 0, 0.01, 0.02) },
      mixer: { sat: { aqua: 14, blue: 10 }, lum: { blue: 6 } },
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
