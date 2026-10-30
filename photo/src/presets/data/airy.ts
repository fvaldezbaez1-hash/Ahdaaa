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
    look('whisper', 'Whisper', 'Barely-there pastel color and feather-light tones.', ['airy', 'pastel', 'pale', 'soft'], {
      basic: { exposure: 0.15, contrast: -20, clarity: -10, saturation: -24 },
      curve: { rgb: tc(0.07, 0, 0.03, 0.03) },
      grading: { highlights: w(30, 6) },
    }),
    look('sunroom', 'Sunroom', 'Bright, warm light pouring in through the window.', ['airy', 'warm', 'sunny', 'interior'], {
      wbShift: { temp: 10, tint: 2 },
      basic: { exposure: 0.18, highlights: -30, shadows: 22, vibrance: 6 },
      curve: { rgb: tc(0.02, 0, 0, 0.03) },
      grading: { highlights: w(45, 15) },
    }),
    look('pure', 'Pure', 'High-key and neutral, with clean, bright whites.', ['airy', 'high key', 'white', 'clean'], {
      basic: { exposure: 0.25, contrast: 2, highlights: -25, shadows: 20, whites: 16, saturation: -6 },
      curve: { rgb: tc(0, 0.01, 0, 0.03) },
    }),
    look('feather', 'Feather', 'Soft focus feel with a faint blush.', ['airy', 'soft', 'pink', 'gentle'], {
      wbShift: { temp: 2, tint: 3 },
      basic: { exposure: 0.18, contrast: -14, texture: -8, clarity: -12, saturation: -10 },
      curve: { rgb: tc(0.04, 0, 0.02, 0.025) },
      grading: { highlights: w(350, 8) },
    }),
    look('morning', 'Morning', 'Cool, fresh first light.', ['airy', 'cool', 'fresh', 'bright'], {
      wbShift: { temp: -8, tint: 0 },
      basic: { exposure: 0.15, highlights: -25, shadows: 20, vibrance: 8 },
      curve: { rgb: tc(0.02, 0.01, 0, 0.02) },
      grading: { shadows: w(200, 9) },
    }),
    look('cotton', 'Cotton', 'Bright and matte, with warm, soft blacks.', ['airy', 'matte', 'warm', 'soft'], {
      wbShift: { temp: 4, tint: 0 },
      basic: { exposure: 0.15, contrast: -10, saturation: -10 },
      curve: { rgb: tc(0.07, 0, 0.04, 0.02) },
      grading: { highlights: w(40, 9) },
    }),
    look('pastel-sky', 'Pastel Sky', 'Light, powdery blues and soft whites.', ['airy', 'blue', 'pastel', 'sky'], {
      basic: { exposure: 0.15, contrast: -12, highlights: -30, shadows: 20, saturation: -10 },
      curve: { rgb: tc(0.04, 0, 0.02, 0.02) },
      mixer: { sat: { blue: -6 }, lum: { blue: 14, aqua: 10 } },
      grading: { highlights: w(200, 8) },
    }),
  ],
}
