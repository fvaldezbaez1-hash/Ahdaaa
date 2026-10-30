import { look, tc, w, type CollectionDef } from './kit'

export const family: CollectionDef = {
  id: 'family',
  name: 'Kids & Family',
  description: 'Warm, happy and true-to-life.',
  looks: [
    look('playful', 'Playful', 'Bright, cheerful color for everyday moments.', ['family', 'bright', 'vivid', 'happy'], {
      basic: { exposure: 0.1, contrast: 8, highlights: -18, shadows: 14, vibrance: 22 },
      curve: { rgb: tc(0, 0.015, 0, 0.01) },
    }),
    look('sunny-day', 'Sunny Day', 'Warm, bright and sunny.', ['family', 'warm', 'bright', 'summer'], {
      wbShift: { temp: 10, tint: 0 },
      basic: { exposure: 0.1, highlights: -22, shadows: 14, vibrance: 12 },
      curve: { rgb: tc(0.01, 0.015) },
      grading: { highlights: w(45, 12) },
    }),
    look('soft-memories', 'Soft Memories', 'Warm and gently faded, like a family album.', ['family', 'nostalgic', 'faded', 'warm'], {
      wbShift: { temp: 6, tint: 0 },
      basic: { contrast: -8, saturation: -10 },
      curve: { rgb: tc(0.06, 0, 0.03) },
      grading: { shadows: w(200, 9), highlights: w(40, 12) },
      effects: { grain: 10 },
    }),
    look('warm-home', 'Warm Home', 'Cozy indoor light with soft, warm skin.', ['family', 'indoor', 'warm', 'cozy'], {
      wbShift: { temp: 8, tint: 0 },
      basic: { exposure: 0.08, contrast: 4, highlights: -20, shadows: 16 },
      curve: { rgb: tc(0.03, 0.01, 0.02) },
      mixer: { sat: { orange: -4 }, lum: { orange: 4 } },
      grading: { shadows: w(25, 9), highlights: w(35, 15) },
    }),
    look('tender', 'Tender', 'Soft skin, soft light and gentle warmth for little ones.', ['family', 'soft', 'skin', 'baby'], {
      wbShift: { temp: 4, tint: 2 },
      basic: { exposure: 0.1, contrast: -10, highlights: -24, shadows: 14, texture: -12, clarity: -10 },
      curve: { rgb: tc(0.03, 0, 0.02, 0.01) },
      mixer: { sat: { orange: -4 }, lum: { orange: 6 } },
    }),
  ],
}
