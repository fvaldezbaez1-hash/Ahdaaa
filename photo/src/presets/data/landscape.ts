import { look, tc, w, type CollectionDef } from './kit'

export const landscape: CollectionDef = {
  id: 'landscape',
  name: 'Landscape',
  description: 'Deep skies, rich color and detail from foreground to horizon.',
  looks: [
    look('golden-hour', 'Golden Hour', 'Leans into low, warm sun: golden light and glowing color.', ['landscape', 'warm', 'golden', 'sunset'], {
      wbShift: { temp: 18, tint: 3 },
      basic: { contrast: 6, highlights: -30, shadows: 16, vibrance: 14 },
      curve: { rgb: tc(0.01, 0.02) },
      mixer: { sat: { orange: 6, yellow: 8 } },
      grading: { shadows: w(20, 9), highlights: w(40, 21) },
      effects: { vignette: -10 },
    }),
    look('blue-hour', 'Blue Hour', 'Deep twilight blues with a touch of violet.', ['landscape', 'cool', 'blue', 'twilight', 'night'], {
      wbShift: { temp: -20, tint: 6 },
      basic: { exposure: -0.1, contrast: 10, highlights: -20, vibrance: 12 },
      curve: { rgb: tc(0.02, 0.02, 0, -0.02) },
      mixer: { sat: { blue: 10, purple: 8 } },
      grading: { shadows: w(230, 21), highlights: w(260, 9) },
    }),
    look('dramatic-sky', 'Dramatic Sky', 'Holds bright skies, darkens blues and adds depth to clouds.', ['landscape', 'sky', 'dramatic', 'contrast'], {
      basic: { contrast: 20, highlights: -55, shadows: 14, blacks: -10, clarity: 18, dehaze: 14, vibrance: 10 },
      curve: { rgb: tc(0, 0.03) },
      mixer: { sat: { blue: 10 }, lum: { blue: -20, aqua: -10 } },
      effects: { vignette: -16 },
    }),
    look('misty', 'Misty', 'Softens haze into a calm, airy atmosphere.', ['landscape', 'fog', 'soft', 'cool', 'calm'], {
      wbShift: { temp: -6, tint: 0 },
      basic: { exposure: 0.08, contrast: -14, highlights: -10, dehaze: -20, saturation: -12 },
      curve: { rgb: tc(0.07, 0, 0.03) },
      grading: { shadows: w(200, 12) },
    }),
    look('autumn-fire', 'Autumn Fire', 'Turns greens toward amber for blazing fall foliage.', ['landscape', 'autumn', 'warm', 'foliage'], {
      wbShift: { temp: 8, tint: 0 },
      basic: { contrast: 10 },
      curve: { rgb: tc(0.01, 0.02) },
      mixer: { hue: { green: -24, yellow: -12 }, sat: { orange: 18, yellow: 14, red: 8, green: -10 }, lum: { orange: -4 } },
      grading: { highlights: w(35, 12) },
    }),
  ],
}
