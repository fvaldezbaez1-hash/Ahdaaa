import { look, tc, w, type CollectionDef } from './kit'

export const food: CollectionDef = {
  id: 'food',
  name: 'Food',
  description: 'Fresh, appetizing color and clean whites.',
  looks: [
    look('fresh', 'Fresh', 'Clean, bright and appetizing with crisp greens.', ['food', 'fresh', 'bright', 'clean'], {
      wbShift: { temp: -2, tint: 0 },
      basic: { exposure: 0.1, highlights: -20, shadows: 12, clarity: 6, vibrance: 14 },
      curve: { rgb: tc(0, 0.015, 0, 0.01) },
      mixer: { sat: { green: 10, red: 6 } },
    }),
    look('bright-table', 'Bright Table', 'Airy whites and soft shadows for a light tabletop.', ['food', 'bright', 'airy', 'white'], {
      wbShift: { temp: -3, tint: 0 },
      basic: { exposure: 0.18, contrast: -8, highlights: -30, shadows: 22, whites: 10, saturation: -4 },
      curve: { rgb: tc(0.02, 0, 0, 0.03) },
    }),
    look('rustic', 'Rustic', 'Warm wood, earthy tones and tactile texture.', ['food', 'warm', 'rustic', 'texture'], {
      wbShift: { temp: 8, tint: 0 },
      basic: { contrast: 10, texture: 8, clarity: 10, saturation: -8 },
      curve: { rgb: tc(0.03, 0.02) },
      mixer: { sat: { orange: 6 }, lum: { orange: -4 } },
      grading: { shadows: w(30, 12) },
      effects: { vignette: -16 },
    }),
    look('moody-kitchen', 'Moody Kitchen', 'Dark, dramatic still life with light falling on the dish.', ['food', 'dark', 'moody', 'low key'], {
      basic: { exposure: -0.15, contrast: 16, highlights: -25, shadows: -10, blacks: -10, saturation: -6 },
      curve: { rgb: tc(0.02, 0.03, 0.02, -0.03) },
      grading: { shadows: w(30, 9) },
      effects: { vignette: -26 },
    }),
    look('cafe', 'Café', 'Coffee-house warmth: brown, cream and soft light.', ['food', 'warm', 'coffee', 'cozy'], {
      wbShift: { temp: 10, tint: 2 },
      basic: { contrast: 6, saturation: -6 },
      curve: { rgb: tc(0.04, 0.015, 0.02) },
      mixer: { sat: { orange: 4 } },
      grading: { shadows: w(25, 15), highlights: w(38, 18) },
    }),
    look('pastry', 'Pastry', 'Soft pastels and sugar-light highlights.', ['food', 'pastel', 'soft', 'sweet'], {
      wbShift: { temp: 2, tint: 4 },
      basic: { exposure: 0.12, contrast: -10, highlights: -20, shadows: 14, saturation: -8 },
      curve: { rgb: tc(0.04, 0, 0.02, 0.02) },
      grading: { highlights: w(340, 9) },
    }),
    look('produce', 'Produce', 'Juicy greens, reds and yellows straight from the market stall.', ['food', 'vivid', 'fresh', 'color'], {
      basic: { contrast: 12, clarity: 8, vibrance: 20 },
      curve: { rgb: tc(0, 0.02) },
      mixer: { sat: { green: 16, red: 10, yellow: 10 }, lum: { green: 4 } },
    }),
    look('dark-wood', 'Dark Wood', 'Rich, warm darks and polished highlights.', ['food', 'dark', 'warm', 'rich'], {
      wbShift: { temp: 6, tint: 0 },
      basic: { exposure: -0.08, contrast: 18, blacks: -14 },
      curve: { rgb: tc(0, 0.035) },
      mixer: { sat: { orange: 8 }, lum: { orange: -8 } },
      grading: { shadows: w(25, 15) },
      effects: { vignette: -20 },
    }),
    look('citrus', 'Citrus', 'Zesty yellows and a bright, clean finish.', ['food', 'bright', 'yellow', 'fresh'], {
      wbShift: { temp: 4, tint: -3 },
      basic: { exposure: 0.06, contrast: 8, vibrance: 10 },
      curve: { rgb: tc(0, 0.02, 0, 0.01) },
      mixer: { hue: { yellow: -4 }, sat: { yellow: 18, orange: 10 } },
    }),
    look('brunch', 'Brunch', 'Warm, bright and cozy morning light.', ['food', 'warm', 'bright', 'morning'], {
      wbShift: { temp: 6, tint: 0 },
      basic: { exposure: 0.1, highlights: -24, shadows: 16, vibrance: 10 },
      curve: { rgb: tc(0.02, 0.01, 0, 0.015) },
      grading: { highlights: w(45, 12) },
    }),
  ],
}
