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
    look('backyard', 'Backyard', 'Fresh grass and warm skin on a bright afternoon.', ['family', 'outdoor', 'green', 'warm'], {
      wbShift: { temp: 4, tint: 0 },
      basic: { contrast: 8, highlights: -20, shadows: 12, vibrance: 8 },
      curve: { rgb: tc(0.01, 0.015) },
      mixer: { hue: { green: -6 }, sat: { green: 10 }, lum: { green: 4 } },
    }),
    look('warm-home', 'Warm Home', 'Cozy indoor light with soft, warm skin.', ['family', 'indoor', 'warm', 'cozy'], {
      wbShift: { temp: 8, tint: 0 },
      basic: { exposure: 0.08, contrast: 4, highlights: -20, shadows: 16 },
      curve: { rgb: tc(0.03, 0.01, 0.02) },
      mixer: { sat: { orange: -4 }, lum: { orange: 4 } },
      grading: { shadows: w(25, 9), highlights: w(35, 15) },
    }),
    look('candid', 'Candid', 'Natural, honest color with a touch of grain.', ['family', 'natural', 'documentary', 'candid'], {
      basic: { contrast: 10, highlights: -15, shadows: 10, clarity: 6, vibrance: 6, saturation: -6 },
      curve: { rgb: tc(0.02, 0.02) },
      effects: { grain: 6 },
    }),
    look('bright-colors', 'Bright Colors', 'Saturated primaries for toys, clothes and parties.', ['family', 'vivid', 'color', 'party'], {
      basic: { contrast: 12, vibrance: 14, saturation: 10 },
      curve: { rgb: tc(0, 0.025) },
      mixer: { sat: { red: 6, yellow: 8, blue: 10 } },
    }),
    look('tender', 'Tender', 'Soft skin, soft light and gentle warmth for little ones.', ['family', 'soft', 'skin', 'baby'], {
      wbShift: { temp: 4, tint: 2 },
      basic: { exposure: 0.1, contrast: -10, highlights: -24, shadows: 14, texture: -12, clarity: -10 },
      curve: { rgb: tc(0.03, 0, 0.02, 0.01) },
      mixer: { sat: { orange: -4 }, lum: { orange: 6 } },
    }),
    look('picnic', 'Picnic', 'Golden summer grass and sunny greens.', ['family', 'summer', 'golden', 'outdoor'], {
      wbShift: { temp: 8, tint: 0 },
      basic: { contrast: 6, vibrance: 10 },
      curve: { rgb: tc(0.02, 0.015) },
      mixer: { hue: { green: -10 }, sat: { yellow: 10, green: 6 } },
      grading: { highlights: w(48, 12) },
    }),
    look('bedtime', 'Bedtime', 'Dim, warm and calm, with a soft dark frame.', ['family', 'warm', 'soft', 'night', 'cozy'], {
      wbShift: { temp: 10, tint: 0 },
      basic: { exposure: -0.05, contrast: -6, highlights: -20, saturation: -10 },
      curve: { rgb: tc(0.05, 0.01, 0.04, -0.01) },
      grading: { shadows: w(30, 12), highlights: w(35, 15) },
      effects: { vignette: -20 },
    }),
  ],
}
