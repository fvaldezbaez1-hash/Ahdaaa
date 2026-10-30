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
    look('lush-green', 'Lush Green', 'Fresh, healthy greens and gentle depth.', ['landscape', 'green', 'foliage', 'vivid'], {
      wbShift: { temp: 0, tint: -4 },
      basic: { contrast: 8, shadows: 10, vibrance: 16 },
      curve: { rgb: tc(0, 0.02) },
      mixer: { hue: { yellow: 6 }, sat: { green: 18, yellow: 10 }, lum: { green: 8 } },
    }),
    look('misty', 'Misty', 'Softens haze into a calm, airy atmosphere.', ['landscape', 'fog', 'soft', 'cool', 'calm'], {
      wbShift: { temp: -6, tint: 0 },
      basic: { exposure: 0.08, contrast: -14, highlights: -10, dehaze: -20, saturation: -12 },
      curve: { rgb: tc(0.07, 0, 0.03) },
      grading: { shadows: w(200, 12) },
    }),
    look('desert-warm', 'Desert Warm', 'Sun-baked oranges and sand against a dusty sky.', ['landscape', 'warm', 'desert', 'earth'], {
      wbShift: { temp: 14, tint: -2 },
      basic: { contrast: 10, clarity: 8 },
      curve: { rgb: tc(0.02, 0.02) },
      mixer: { hue: { yellow: -8 }, sat: { orange: 12, yellow: 6, blue: -8 }, lum: { orange: -6 } },
      grading: { shadows: w(20, 15), highlights: w(35, 15) },
    }),
    look('alpine', 'Alpine', 'Clear, cool mountain air with crisp detail.', ['landscape', 'cool', 'mountain', 'crisp'], {
      wbShift: { temp: -8, tint: 0 },
      basic: { contrast: 12, whites: 8, clarity: 12, dehaze: 10, vibrance: 10 },
      curve: { rgb: tc(0, 0.025) },
      mixer: { sat: { blue: 12, green: -6 }, lum: { blue: -10, aqua: -6 } },
    }),
    look('autumn-fire', 'Autumn Fire', 'Turns greens toward amber for blazing fall foliage.', ['landscape', 'autumn', 'warm', 'foliage'], {
      wbShift: { temp: 8, tint: 0 },
      basic: { contrast: 10 },
      curve: { rgb: tc(0.01, 0.02) },
      mixer: { hue: { green: -24, yellow: -12 }, sat: { orange: 18, yellow: 14, red: 8, green: -10 }, lum: { orange: -4 } },
      grading: { highlights: w(35, 12) },
    }),
    look('ocean-blue', 'Ocean Blue', 'Clean aquas and deep sea blues.', ['landscape', 'sea', 'blue', 'cool', 'coast'], {
      wbShift: { temp: -6, tint: 0 },
      basic: { contrast: 8, clarity: 6, vibrance: 10 },
      curve: { rgb: tc(0, 0.02) },
      mixer: { hue: { aqua: 8 }, sat: { blue: 18, aqua: 16 }, lum: { blue: -10, aqua: -4 } },
      grading: { shadows: w(200, 15) },
    }),
    look('big-sky', 'Big Sky', 'Pulls detail back into a wide, bright sky and opens the land below.', ['landscape', 'sky', 'bright', 'balanced'], {
      basic: { contrast: 6, highlights: -45, shadows: 22, whites: 6, dehaze: 8, vibrance: 12 },
      curve: { rgb: tc(0, 0.015) },
      mixer: { sat: { blue: 12 }, lum: { blue: -14 } },
      effects: { vignette: -8 },
    }),
  ],
}
