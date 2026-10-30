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
    look('winter-crisp', 'Winter Crisp', 'Cold, clean air and bright, blue-white light.', ['seasonal', 'winter', 'cool', 'crisp'], {
      wbShift: { temp: -14, tint: 0 },
      basic: { contrast: 10, whites: 8, clarity: 8, saturation: -10 },
      curve: { rgb: tc(0, 0.02) },
      mixer: { sat: { blue: 10 } },
      grading: { shadows: w(215, 15) },
    }),
    look('harvest', 'Harvest', 'Rich ochres and deep earth tones.', ['seasonal', 'autumn', 'warm', 'earth'], {
      wbShift: { temp: 10, tint: 0 },
      basic: { contrast: 14, clarity: 8 },
      curve: { rgb: tc(0.02, 0.03) },
      mixer: { hue: { yellow: -8 }, sat: { orange: 12, yellow: 10, red: 6 }, lum: { yellow: -6 } },
      grading: { shadows: w(25, 12) },
      effects: { vignette: -14 },
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
