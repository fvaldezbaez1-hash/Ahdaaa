import { look, pts, tc, w, type CollectionDef } from './kit'

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
    look('vaporwave', 'Vaporwave', 'Pastel pink, violet and cyan, softly lifted.', ['creative', 'pastel', 'retro', 'pink', 'purple'], {
      wbShift: { temp: -6, tint: 14 },
      basic: { exposure: 0.08, contrast: -8, saturation: -6 },
      curve: { rgb: tc(0.06, 0, 0.03, 0.02) },
      mixer: { hue: { blue: 12 } },
      grading: { shadows: w(270, 30), midtones: w(180, 9), highlights: w(320, 21) },
    }),
    look('faded-teal', 'Faded Teal', 'A teal wash over soft, faded color.', ['creative', 'teal', 'faded', 'matte'], {
      basic: { saturation: -20 },
      curve: { rgb: tc(0.06, 0.015, 0.03) },
      mixer: { hue: { green: 20 }, sat: { orange: 4 } },
      grading: { shadows: w(180, 36), midtones: w(180, 12), highlights: w(40, 12) },
    }),
    look('solar', 'Solar', 'Blazing heat: orange light and burnt shadows.', ['creative', 'warm', 'orange', 'hot'], {
      wbShift: { temp: 20, tint: 0 },
      basic: { contrast: 20 },
      curve: { rgb: tc(0, 0.04, 0, 0.01) },
      mixer: { sat: { orange: 14, yellow: 10, blue: -30 } },
      grading: { shadows: w(10, 21), highlights: w(40, 36) },
      effects: { vignette: -18 },
    }),
    look('prism', 'Prism', 'Surreal shifted hues: teal foliage, violet skies, hot yellows.', ['creative', 'surreal', 'vivid', 'hue shift'], {
      basic: { contrast: 14, vibrance: 20 },
      curve: { r: pts(0, 0, 0.5, 0.56, 1, 1), b: pts(0, 0.05, 0.5, 0.45, 1, 1) },
      mixer: { hue: { red: 20, orange: 16, yellow: 20, green: 30, blue: 30 }, sat: { green: 30, blue: 20 } },
    }),
    look('dreamscape', 'Dreamscape', 'Ethereal violet shadows and a soft, hazy glow.', ['creative', 'dreamy', 'purple', 'soft'], {
      basic: { exposure: 0.1, contrast: -12, highlights: -20, clarity: -30, vibrance: 10 },
      curve: { rgb: tc(0.05, 0, 0.02, 0.03) },
      grading: { shadows: w(265, 33), highlights: w(30, 18) },
      effects: { vignette: -10 },
    }),
    look('split-tone', 'Split Tone', 'Muted color with steel-blue shadows and amber highlights.', ['creative', 'split tone', 'muted', 'teal', 'orange'], {
      basic: { contrast: 10, saturation: -30 },
      curve: { rgb: tc(0.03, 0.02) },
      grading: { shadows: w(200, 39), highlights: w(35, 33), balance: -10 },
    }),
    look('cross-color', 'Cross Color', 'Magenta shadows and green-lit highlights from crossed channels.', ['creative', 'cross process', 'magenta', 'green'], {
      basic: { contrast: 10, saturation: 8 },
      curve: { r: pts(0, 0.08, 0.5, 0.5, 1, 0.97), g: pts(0, 0, 0.5, 0.52, 1, 1), b: pts(0, 0.08, 0.5, 0.48, 1, 0.92) },
      effects: { vignette: -12 },
    }),
  ],
}
