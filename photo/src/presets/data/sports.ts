import { look, tc, w, type CollectionDef } from './kit'

export const sports: CollectionDef = {
  id: 'sports',
  name: 'Sports & Action',
  description: 'High-impact contrast and punchy color for movement.',
  looks: [
    look('impact', 'Impact', 'Hard-hitting contrast and punch.', ['sports', 'contrast', 'bold', 'punchy'], {
      basic: { contrast: 28, highlights: -20, blacks: -12, clarity: 18, vibrance: 14 },
      curve: { rgb: tc(0, 0.04) },
      effects: { vignette: -16 },
    }),
    look('freeze', 'Freeze', 'Icy, crisp and cold — for snow and ice sports.', ['sports', 'winter', 'cool', 'crisp'], {
      wbShift: { temp: -14, tint: 0 },
      basic: { contrast: 16, whites: 10, clarity: 14, saturation: -12 },
      curve: { rgb: tc(0, 0.03) },
      grading: { shadows: w(200, 18) },
    }),
    look('grit', 'Grit', 'Raw texture and steely, desaturated contrast.', ['sports', 'gritty', 'muted', 'texture'], {
      wbShift: { temp: -4, tint: 0 },
      basic: { contrast: 30, blacks: -14, texture: 18, clarity: 26, saturation: -30 },
      curve: { rgb: tc(0.02, 0.05) },
      grading: { shadows: w(190, 12) },
      effects: { grain: 16, vignette: -20 },
    }),
    look('turf', 'Turf', 'Vivid green fields and crisp kit colors.', ['sports', 'green', 'vivid', 'outdoor'], {
      basic: { contrast: 14, clarity: 10, vibrance: 12 },
      curve: { rgb: tc(0, 0.03) },
      mixer: { hue: { green: -4 }, sat: { green: 20 }, lum: { green: -6 } },
    }),
    look('victory', 'Victory', 'Golden, celebratory warmth.', ['sports', 'golden', 'warm', 'bold'], {
      wbShift: { temp: 12, tint: 0 },
      basic: { contrast: 16, highlights: -20, vibrance: 16 },
      curve: { rgb: tc(0, 0.03) },
      grading: { highlights: w(42, 21) },
      effects: { vignette: -12 },
    }),
  ],
}
