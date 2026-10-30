import { look, tc, w, type CollectionDef } from './kit'

export const creative: CollectionDef = {
  id: 'creative',
  name: 'Creative',
  description: 'Bold color experiments: duotones, infrared, split tones.',
  looks: [
    look('infrared-pink', 'Infrared Pink', 'False-color infrared: pale pink foliage under deep skies.', ['creative', 'infrared', 'pink', 'surreal'], {
      basic: { contrast: 14 },
      curve: { rgb: tc(0, 0.02) },
      mixer: { sat: { green: -80, yellow: -60, blue: 20 }, lum: { green: 40, yellow: 30, blue: -20 } },
      grading: { midtones: w(330, 20), highlights: w(330, 55) },
    }),
    look('duotone-blue', 'Duotone Blue', 'Two-color print: navy shadows and cream highlights.', ['creative', 'duotone', 'blue', 'graphic'], {
      basic: { contrast: 18, saturation: -90 },
      curve: { rgb: tc(0.03, 0.03) },
      grading: { shadows: w(225, 55), midtones: w(220, 15), highlights: w(45, 24) },
    }),
    look('cyberpunk', 'Cyberpunk', 'Neon magenta and cyan over inky blacks.', ['creative', 'neon', 'night', 'magenta', 'cyan'], {
      wbShift: { temp: -14, tint: 16 },
      basic: { contrast: 20, blacks: -12 },
      curve: { rgb: tc(0, 0.035) },
      mixer: { sat: { magenta: 20, purple: 20, aqua: 16, blue: 12 } },
      grading: { shadows: w(190, 40), highlights: w(310, 36) },
      effects: { vignette: -20 },
    }),
    look('solar', 'Solar', 'Blazing heat: orange light and burnt shadows.', ['creative', 'warm', 'orange', 'hot'], {
      wbShift: { temp: 20, tint: 0 },
      basic: { contrast: 20 },
      curve: { rgb: tc(0, 0.04, 0, 0.01) },
      mixer: { sat: { orange: 14, yellow: 10, blue: -30 } },
      grading: { shadows: w(10, 21), highlights: w(40, 36) },
      effects: { vignette: -18 },
    }),
    look('split-tone', 'Split Tone', 'Muted color with steel-blue shadows and amber highlights.', ['creative', 'split tone', 'muted', 'teal', 'orange'], {
      basic: { contrast: 10, saturation: -30 },
      curve: { rgb: tc(0.03, 0.02) },
      grading: { shadows: w(200, 39), highlights: w(35, 33), balance: -10 },
    }),
  ],
}
