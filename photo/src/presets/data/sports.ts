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
    look('speed', 'Speed', 'Cool, sharp and fast.', ['sports', 'cool', 'sharp', 'contrast'], {
      wbShift: { temp: -6, tint: 0 },
      basic: { contrast: 22, texture: 12, clarity: 14, saturation: -6 },
      curve: { rgb: tc(0, 0.035) },
      grading: { shadows: w(210, 15) },
      effects: { vignette: -12 },
    }),
    look('arena', 'Arena', 'Indoor lights balanced, with punch on the players.', ['sports', 'indoor', 'contrast', 'vivid'], {
      wbShift: { temp: -4, tint: 0 },
      basic: { contrast: 18, highlights: -30, shadows: 14, clarity: 10, vibrance: 12 },
      curve: { rgb: tc(0, 0.03) },
      effects: { vignette: -14 },
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
    look('stadium-lights', 'Stadium Lights', 'Night games: bright pitch, dark stands.', ['sports', 'night', 'contrast', 'green'], {
      wbShift: { temp: -8, tint: 0 },
      basic: { exposure: -0.1, contrast: 20, blacks: -12, vibrance: 14 },
      curve: { rgb: tc(0, 0.035, 0, -0.02) },
      mixer: { sat: { green: 10 } },
      grading: { shadows: w(220, 15), highlights: w(45, 9) },
      effects: { vignette: -22 },
    }),
    look('turf', 'Turf', 'Vivid green fields and crisp kit colors.', ['sports', 'green', 'vivid', 'outdoor'], {
      basic: { contrast: 14, clarity: 10, vibrance: 12 },
      curve: { rgb: tc(0, 0.03) },
      mixer: { hue: { green: -4 }, sat: { green: 20 }, lum: { green: -6 } },
    }),
    look('splash', 'Splash', 'Bright aquas and sparkling water.', ['sports', 'water', 'aqua', 'vivid'], {
      wbShift: { temp: -6, tint: 0 },
      basic: { contrast: 16, clarity: 12, vibrance: 10 },
      curve: { rgb: tc(0, 0.03) },
      mixer: { sat: { aqua: 20, blue: 14 }, lum: { aqua: 6 } },
    }),
    look('sweat', 'Sweat', 'Warm, high-contrast detail on muscle and effort.', ['sports', 'warm', 'contrast', 'detail'], {
      wbShift: { temp: 6, tint: 0 },
      basic: { contrast: 24, texture: 10, clarity: 16, saturation: -10 },
      curve: { rgb: tc(0, 0.04) },
      mixer: { sat: { orange: 6 }, lum: { orange: -8 } },
      grading: { shadows: w(25, 12) },
      effects: { vignette: -18 },
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
