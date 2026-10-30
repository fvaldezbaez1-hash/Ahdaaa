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
    look('timeless', 'Timeless', 'Clean, classic color that won’t date.', ['wedding', 'classic', 'natural', 'clean'], {
      basic: { contrast: 10, highlights: -20, shadows: 10, saturation: -6 },
      curve: { rgb: tc(0.015, 0.02) },
      mixer: { lum: { orange: 3 } },
      effects: { vignette: -8 },
    }),
    look('blush', 'Blush', 'Pastel pinks and airy, lifted tones.', ['wedding', 'pastel', 'pink', 'airy'], {
      wbShift: { temp: 2, tint: 6 },
      basic: { exposure: 0.1, saturation: -12 },
      curve: { rgb: tc(0.05, 0, 0.03, 0.02) },
      mixer: { sat: { green: -14 } },
      grading: { shadows: w(300, 8), highlights: w(340, 15) },
    }),
    look('golden-vows', 'Golden Vows', 'Golden-hour warmth for vows and portraits.', ['wedding', 'golden', 'warm', 'sunset'], {
      wbShift: { temp: 12, tint: 2 },
      basic: { highlights: -28, shadows: 12, clarity: -6 },
      curve: { rgb: tc(0.03, 0.01, 0.02) },
      grading: { midtones: w(35, 8), highlights: w(42, 21) },
    }),
    look('classic-day', 'Classic Day', 'True color with gentle contrast and smooth skin.', ['wedding', 'natural', 'true to life', 'skin'], {
      basic: { contrast: 6, highlights: -18, shadows: 10, texture: -6, vibrance: 4 },
      curve: { rgb: tc(0.01, 0.015) },
    }),
    look('airy-lace', 'Airy Lace', 'Light-filled and delicate, with open shadows.', ['wedding', 'bright', 'airy', 'soft'], {
      wbShift: { temp: -2, tint: 0 },
      basic: { exposure: 0.22, contrast: -14, highlights: -35, shadows: 26, whites: 6, saturation: -10 },
      curve: { rgb: tc(0.03, 0, 0.02, 0.03) },
    }),
    look('evening-reception', 'Evening Reception', 'Warm lights and deep shadows for the party after dark.', ['wedding', 'night', 'warm', 'moody'], {
      wbShift: { temp: 4, tint: 0 },
      basic: { contrast: 12, highlights: -20, blacks: -8 },
      curve: { rgb: tc(0.02, 0.025) },
      grading: { shadows: w(220, 12), highlights: w(35, 15) },
      effects: { vignette: -18 },
    }),
    look('garden-party', 'Garden Party', 'Fresh greens and soft daylight for outdoor ceremonies.', ['wedding', 'green', 'fresh', 'outdoor'], {
      wbShift: { temp: 2, tint: 0 },
      basic: { exposure: 0.08, contrast: -6, highlights: -20, vibrance: 10 },
      curve: { rgb: tc(0.03, 0, 0.02, 0.01) },
      mixer: { hue: { green: -6 }, sat: { green: 10 }, lum: { green: 6 } },
    }),
    look('first-dance', 'First Dance', 'Moody and intimate, with a soft dark frame.', ['wedding', 'moody', 'dark', 'romantic'], {
      basic: { exposure: -0.1, contrast: 14, highlights: -20, saturation: -10 },
      curve: { rgb: tc(0.03, 0.03, 0.02, -0.02) },
      grading: { shadows: w(230, 12), highlights: w(30, 15) },
      effects: { grain: 8, vignette: -24 },
    }),
  ],
}
