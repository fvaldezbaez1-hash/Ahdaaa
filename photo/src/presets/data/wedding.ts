import { look, tc, w, type CollectionDef } from './kit'

// Kind to white dresses (highlights held back) and to skin (orange lifted, not pushed).
export const wedding: CollectionDef = {
  id: 'wedding',
  name: 'Wedding',
  description: 'Timeless, soft and romantic, kind to white dresses.',
  looks: [
    look('ivory', 'Ivory', 'Soft, warm whites and gentle skin.', ['wedding', 'soft', 'warm', 'bright'], {
      wbShift: { temp: 5, tint: 1 },
      basic: { exposure: 0.12, contrast: -8, highlights: -30, shadows: 14, saturation: -10 },
      curve: { rgb: tc(0.04, 0, 0.03, 0.01) },
      mixer: { lum: { orange: 4 } },
      grading: { highlights: w(45, 12) },
    }),
    look('romance', 'Romance', 'A rose-warm glow with smooth, soft contrast.', ['wedding', 'romantic', 'pink', 'soft'], {
      wbShift: { temp: 6, tint: 4 },
      basic: { contrast: -10, highlights: -24, clarity: -10 },
      curve: { rgb: tc(0.04, 0, 0.03, 0.01) },
      grading: { midtones: w(20, 6), highlights: w(350, 12) },
    }),
    look('golden-vows', 'Golden Vows', 'Golden-hour warmth for vows and portraits.', ['wedding', 'golden', 'warm', 'sunset'], {
      wbShift: { temp: 12, tint: 2 },
      basic: { highlights: -28, shadows: 12, clarity: -6 },
      curve: { rgb: tc(0.03, 0.01, 0.02) },
      grading: { midtones: w(35, 8), highlights: w(42, 21) },
    }),
    look('airy-lace', 'Airy Lace', 'Light-filled and delicate, with open shadows.', ['wedding', 'bright', 'airy', 'soft'], {
      wbShift: { temp: -2, tint: 0 },
      basic: { exposure: 0.22, contrast: -14, highlights: -35, shadows: 26, whites: 6, saturation: -10 },
      curve: { rgb: tc(0.03, 0, 0.02, 0.03) },
    }),
    look('first-dance', 'First Dance', 'Moody and intimate, with a soft dark frame.', ['wedding', 'moody', 'dark', 'romantic'], {
      basic: { exposure: -0.1, contrast: 14, highlights: -20, saturation: -10 },
      curve: { rgb: tc(0.03, 0.03, 0.02, -0.02) },
      grading: { shadows: w(230, 12), highlights: w(30, 15) },
      effects: { grain: 8, vignette: -24 },
    }),
  ],
}
