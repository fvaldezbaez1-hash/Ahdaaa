import { look, tc, w, type CollectionDef } from './kit'

export const seasonal: CollectionDef = {
  id: 'seasonal',
  name: 'Seasonal',
  description: 'Looks tuned to the light of each season.',
  looks: [
    look('spring-bloom', 'Spring Bloom', 'Fresh young greens and flowering pinks.', ['seasonal', 'spring', 'fresh', 'flowers'], {
      wbShift: { temp: 2, tint: 0 },
      basic: { exposure: 0.08, contrast: -4, vibrance: 12 },
      curve: { rgb: tc(0.03, 0.01, 0.01, 0.01) },
      mixer: { hue: { green: -8 }, sat: { green: 6, magenta: 12, red: 4 }, lum: { green: 8 } },
      grading: { highlights: w(340, 8) },
    }),
    look('summer-haze', 'Summer Haze', 'Hot, hazy and golden.', ['seasonal', 'summer', 'warm', 'haze'], {
      wbShift: { temp: 12, tint: 2 },
      basic: { exposure: 0.08, contrast: -8, dehaze: -10, saturation: -4 },
      curve: { rgb: tc(0.06, 0, 0.03, 0.02) },
      grading: { highlights: w(45, 18) },
    }),
    look('autumn-gold', 'Autumn Gold', 'Golden leaves and mellow late-season light.', ['seasonal', 'autumn', 'golden', 'warm'], {
      wbShift: { temp: 10, tint: 0 },
      basic: { contrast: 8 },
      curve: { rgb: tc(0.02, 0.02) },
      mixer: { hue: { green: -16, yellow: -6 }, sat: { yellow: 14, orange: 12, green: -8 } },
      grading: { highlights: w(40, 15) },
    }),
    look('winter-crisp', 'Winter Crisp', 'Cold, clean air and bright, blue-white light.', ['seasonal', 'winter', 'cool', 'crisp'], {
      wbShift: { temp: -14, tint: 0 },
      basic: { contrast: 10, whites: 8, clarity: 8, saturation: -10 },
      curve: { rgb: tc(0, 0.02) },
      mixer: { sat: { blue: 10 } },
      grading: { shadows: w(215, 15) },
    }),
    look('snowlight', 'Snowlight', 'Bright, clean snow that stays white instead of gray.', ['seasonal', 'winter', 'snow', 'bright'], {
      wbShift: { temp: -6, tint: 0 },
      basic: { exposure: 0.2, highlights: -25, shadows: 10, whites: 14, saturation: -8 },
      curve: { rgb: tc(0.015, 0.01, 0, 0.02) },
      grading: { highlights: w(205, 6) },
    }),
    look('harvest', 'Harvest', 'Rich ochres and deep earth tones.', ['seasonal', 'autumn', 'warm', 'earth'], {
      wbShift: { temp: 10, tint: 0 },
      basic: { contrast: 14, clarity: 8 },
      curve: { rgb: tc(0.02, 0.03) },
      mixer: { hue: { yellow: -8 }, sat: { orange: 12, yellow: 10, red: 6 }, lum: { yellow: -6 } },
      grading: { shadows: w(25, 12) },
      effects: { vignette: -14 },
    }),
    look('rainy-season', 'Rainy Season', 'Damp, muted greens under a heavy sky.', ['seasonal', 'rain', 'muted', 'green', 'moody'], {
      wbShift: { temp: -6, tint: 0 },
      basic: { contrast: 8, dehaze: -4, saturation: -14 },
      curve: { rgb: tc(0.04, 0.02, 0.02, -0.02) },
      mixer: { hue: { green: 8 }, sat: { green: -6 } },
      grading: { shadows: w(190, 18) },
    }),
    look('blossom', 'Blossom', 'Pink-tinted highlights and soft petals.', ['seasonal', 'spring', 'pink', 'soft'], {
      wbShift: { temp: 2, tint: 6 },
      basic: { exposure: 0.1, contrast: -10, clarity: -8 },
      curve: { rgb: tc(0.04, 0, 0.02, 0.02) },
      mixer: { sat: { magenta: 14, red: 4 } },
      grading: { highlights: w(340, 15) },
    }),
    look('frost', 'Frost', 'Icy cyan, pale color and a crisp edge.', ['seasonal', 'winter', 'icy', 'cool', 'muted'], {
      wbShift: { temp: -16, tint: -2 },
      basic: { contrast: 8, highlights: -15, clarity: 6, saturation: -24 },
      curve: { rgb: tc(0.04, 0.02, 0.02) },
      grading: { shadows: w(190, 21), highlights: w(195, 12) },
    }),
    look('holiday', 'Holiday', 'Cozy warmth with festive reds and evergreen.', ['seasonal', 'winter', 'warm', 'festive'], {
      wbShift: { temp: 8, tint: 0 },
      basic: { contrast: 12, vibrance: 10 },
      curve: { rgb: tc(0.02, 0.025) },
      mixer: { sat: { red: 12, green: 8 }, lum: { red: -4 } },
      grading: { highlights: w(38, 15) },
      effects: { vignette: -16 },
    }),
  ],
}
