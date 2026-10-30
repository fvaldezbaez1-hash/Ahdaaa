import { look, tc, w, type CollectionDef } from './kit'

export const night: CollectionDef = {
  id: 'night',
  name: 'Night',
  description: 'City lights, neon and stars, with clean deep blacks.',
  looks: [
    look('city-lights', 'City Lights', 'Clean blacks, glowing street lamps and cool shadows.', ['night', 'city', 'lights', 'contrast'], {
      wbShift: { temp: -8, tint: 0 },
      basic: { contrast: 16, highlights: -30, blacks: -12, vibrance: 16 },
      curve: { rgb: tc(0, 0.03) },
      mixer: { sat: { orange: 10, yellow: 6 } },
      grading: { shadows: w(220, 18) },
      effects: { vignette: -10 },
    }),
    look('starry', 'Starry', 'Deep blue night skies with crisp stars.', ['night', 'stars', 'sky', 'blue', 'astro'], {
      wbShift: { temp: -16, tint: 0 },
      basic: { contrast: 10, highlights: -10, blacks: -8, clarity: 10, dehaze: 10 },
      curve: { rgb: tc(0, 0.03, 0, -0.02) },
      mixer: { sat: { blue: 12 }, lum: { blue: -6 } },
      detail: { noise: 20 },
    }),
    look('neon-glow', 'Neon Glow', 'Saturated magenta and cyan signs against the dark.', ['night', 'neon', 'vivid', 'city'], {
      basic: { contrast: 16, blacks: -10, vibrance: 24 },
      curve: { rgb: tc(0, 0.03) },
      mixer: { hue: { red: -8 }, sat: { magenta: 24, purple: 20, aqua: 18, blue: 10 } },
      grading: { shadows: w(260, 21) },
      effects: { vignette: -14 },
    }),
    look('after-hours', 'After Hours', 'Smoky bar light: amber highlights, muted color, grain.', ['night', 'warm', 'moody', 'grain'], {
      wbShift: { temp: 4, tint: 0 },
      basic: { exposure: -0.1, contrast: 12, saturation: -16 },
      curve: { rgb: tc(0.04, 0.02, 0.02, -0.02) },
      grading: { shadows: w(200, 15), highlights: w(35, 21) },
      effects: { grain: 18, vignette: -20 },
    }),
    look('moonlight', 'Moonlight', 'Silvery blue, quiet color and soft darkness.', ['night', 'cool', 'blue', 'muted'], {
      wbShift: { temp: -20, tint: 0 },
      basic: { exposure: -0.1, contrast: 10, saturation: -30 },
      curve: { rgb: tc(0.03, 0.02, 0.02, -0.03) },
      grading: { shadows: w(220, 24), highlights: w(210, 9) },
    }),
    look('lantern', 'Lantern', 'Warm amber light glowing out of the dark.', ['night', 'warm', 'amber', 'glow'], {
      wbShift: { temp: 14, tint: 0 },
      basic: { contrast: 14, blacks: -10 },
      curve: { rgb: tc(0, 0.03, 0, -0.02) },
      mixer: { sat: { orange: 10, blue: -14 } },
      grading: { shadows: w(20, 12), highlights: w(35, 24) },
      effects: { vignette: -22 },
    }),
    look('night-drive', 'Night Drive', 'Teal shadows and bright red tail lights.', ['night', 'teal', 'red', 'cinematic'], {
      wbShift: { temp: -10, tint: 0 },
      basic: { contrast: 18 },
      curve: { rgb: tc(0.02, 0.03) },
      mixer: { sat: { red: 16, aqua: 12 } },
      grading: { shadows: w(185, 27), highlights: w(15, 9) },
      effects: { grain: 12, vignette: -16 },
    }),
    look('blue-neon', 'Blue Neon', 'Electric blues and violets.', ['night', 'blue', 'neon', 'cool'], {
      wbShift: { temp: -22, tint: 0 },
      basic: { contrast: 14, vibrance: 12 },
      curve: { rgb: tc(0, 0.03) },
      mixer: { hue: { purple: -10 }, sat: { blue: 20, purple: 10 } },
      grading: { shadows: w(240, 24) },
    }),
    look('midnight', 'Midnight', 'Very dark and deep, with only the lights left.', ['night', 'dark', 'low key', 'cool'], {
      wbShift: { temp: -10, tint: 0 },
      basic: { exposure: -0.25, contrast: 20, blacks: -16, saturation: -12 },
      curve: { rgb: tc(0.02, 0.03, 0.03, -0.04) },
      grading: { shadows: w(230, 18) },
      effects: { vignette: -28 },
    }),
    look('glow', 'Glow', 'Soft, blooming lights and gentle violet shadows.', ['night', 'dreamy', 'soft', 'glow'], {
      basic: { exposure: 0.05, contrast: -8, highlights: -10, shadows: 10, clarity: -24, vibrance: 12 },
      curve: { rgb: tc(0.04, 0, 0, 0.02) },
      grading: { shadows: w(270, 12), highlights: w(30, 15) },
    }),
  ],
}
