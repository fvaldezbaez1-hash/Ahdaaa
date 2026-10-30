import { look, tc, w, type CollectionDef } from './kit'

// Brightness here comes mostly from opening shadows and the curve's midpoint,
// with highlights pulled back so whites keep their detail.
export const airy: CollectionDef = {
  id: 'airy',
  name: 'Bright & Airy',
  description: 'Light, clean and soft, with open shadows.',
  looks: [
    look('daylight', 'Daylight', 'Fresh, bright and open — the easy all-rounder.', ['airy', 'bright', 'clean', 'light'], {
      wbShift: { temp: -2, tint: 0 },
      basic: { exposure: 0.2, contrast: -10, highlights: -35, shadows: 30, whites: 10, saturation: -8 },
      curve: { rgb: tc(0.02, 0, 0, 0.03) },
    }),
    look('linen', 'Linen', 'Warm neutrals and soft, natural light.', ['airy', 'warm', 'neutral', 'soft'], {
      wbShift: { temp: 6, tint: 2 },
      basic: { exposure: 0.18, contrast: -12, highlights: -30, shadows: 24, saturation: -14 },
      curve: { rgb: tc(0.04, 0, 0.02, 0.03) },
      grading: { highlights: w(40, 9) },
    }),
    look('cloud', 'Cloud', 'Very soft and cool, like light through thin cloud.', ['airy', 'cool', 'soft', 'pale'], {
      wbShift: { temp: -6, tint: 0 },
      basic: { exposure: 0.2, contrast: -18, highlights: -40, shadows: 30, clarity: -8, saturation: -16 },
      curve: { rgb: tc(0.05, 0, 0.02, 0.03) },
    }),
    look('sunroom', 'Sunroom', 'Bright, warm light pouring in through the window.', ['airy', 'warm', 'sunny', 'interior'], {
      wbShift: { temp: 10, tint: 2 },
      basic: { exposure: 0.18, highlights: -30, shadows: 22, vibrance: 6 },
      curve: { rgb: tc(0.02, 0, 0, 0.03) },
      grading: { highlights: w(45, 15) },
    }),
    look('pastel-sky', 'Pastel Sky', 'Light, powdery blues and soft whites.', ['airy', 'blue', 'pastel', 'sky'], {
      basic: { exposure: 0.15, contrast: -12, highlights: -30, shadows: 20, saturation: -10 },
      curve: { rgb: tc(0.04, 0, 0.02, 0.02) },
      mixer: { sat: { blue: -6 }, lum: { blue: 14, aqua: 10 } },
      grading: { highlights: w(200, 8) },
    }),
  ],
}
