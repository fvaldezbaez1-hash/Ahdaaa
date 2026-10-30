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
    look('produce', 'Produce', 'Juicy greens, reds and yellows straight from the market stall.', ['food', 'vivid', 'fresh', 'color'], {
      basic: { contrast: 12, clarity: 8, vibrance: 20 },
      curve: { rgb: tc(0, 0.02) },
      mixer: { sat: { green: 16, red: 10, yellow: 10 }, lum: { green: 4 } },
    }),
  ],
}
