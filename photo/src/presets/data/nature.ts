import { look, tc, w, type CollectionDef } from './kit'

export const nature: CollectionDef = {
  id: 'nature',
  name: 'Nature',
  description: 'Natural greens and textures for forests, flowers and wildlife.',
  looks: [
    look('woodland', 'Woodland', 'Mossy greens and warm earth on the forest floor.', ['nature', 'forest', 'green', 'earth'], {
      wbShift: { temp: 4, tint: 0 },
      basic: { contrast: 10, shadows: 10, clarity: 8 },
      curve: { rgb: tc(0.02, 0.02) },
      mixer: { hue: { green: -8 }, sat: { green: 6 }, lum: { green: -6 } },
      grading: { shadows: w(120, 9), highlights: w(45, 9) },
      effects: { vignette: -12 },
    }),
    look('wildflower', 'Wildflower', 'Vivid petals — violets, magentas and yellows — without neon.', ['nature', 'flowers', 'vivid', 'color'], {
      basic: { contrast: 8, clarity: 6, vibrance: 22 },
      curve: { rgb: tc(0, 0.02) },
      mixer: { sat: { magenta: 14, purple: 14, yellow: 10, red: 8 } },
    }),
    look('macro-green', 'Macro Green', 'Clean, saturated leaf greens with fine texture.', ['nature', 'macro', 'green', 'detail'], {
      basic: { contrast: 10, texture: 14, clarity: 6 },
      curve: { rgb: tc(0, 0.02) },
      mixer: { hue: { green: 4 }, sat: { green: 20, yellow: 8 }, lum: { green: 6 } },
    }),
    look('canopy', 'Canopy', 'Dappled light under trees, with depth in the leaves.', ['nature', 'forest', 'green', 'contrast'], {
      wbShift: { temp: 2, tint: -3 },
      basic: { contrast: 14, highlights: -30, shadows: 18, dehaze: 6 },
      curve: { rgb: tc(0.01, 0.03) },
      mixer: { hue: { green: -6 }, sat: { green: 8 }, lum: { green: -10 } },
      effects: { vignette: -16 },
    }),
    look('river', 'River', 'Clear, cool water and wet stone.', ['nature', 'water', 'cool', 'aqua'], {
      wbShift: { temp: -8, tint: 0 },
      basic: { contrast: 8, clarity: 10, dehaze: 8 },
      curve: { rgb: tc(0, 0.02) },
      mixer: { hue: { aqua: -6 }, sat: { aqua: 18, blue: 10 } },
      grading: { shadows: w(195, 12) },
    }),
    look('meadow', 'Meadow', 'Warm, golden grass and soft summer light.', ['nature', 'golden', 'warm', 'field'], {
      wbShift: { temp: 8, tint: 0 },
      basic: { exposure: 0.06, contrast: 6, highlights: -22, shadows: 12 },
      curve: { rgb: tc(0.02, 0.015) },
      mixer: { hue: { green: -14, yellow: -4 }, sat: { yellow: 12, green: -4 } },
      grading: { highlights: w(48, 15) },
    }),
    look('fern', 'Fern', 'Cool emerald greens in the shade.', ['nature', 'green', 'cool', 'forest'], {
      wbShift: { temp: -4, tint: -2 },
      basic: { contrast: 12 },
      curve: { rgb: tc(0.02, 0.025, 0, -0.01) },
      mixer: { hue: { green: 10 }, sat: { green: 10 }, lum: { green: -8 } },
      grading: { shadows: w(160, 15) },
    }),
    look('moss', 'Moss', 'Soft olive and muted, velvety greens.', ['nature', 'muted', 'olive', 'soft'], {
      basic: { contrast: -4, saturation: -8 },
      curve: { rgb: tc(0.05, 0.01, 0.02) },
      mixer: { hue: { green: -16 }, sat: { green: -16, yellow: -8 } },
      grading: { shadows: w(100, 12), highlights: w(55, 12) },
    }),
    look('bloom', 'Bloom', 'Dreamy, soft-focus flowers with a rosy glow.', ['nature', 'flowers', 'soft', 'dreamy'], {
      basic: { exposure: 0.08, contrast: -8, clarity: -16, vibrance: 14 },
      curve: { rgb: tc(0.03, 0, 0.02, 0.02) },
      mixer: { sat: { magenta: 10, red: 6 } },
      grading: { highlights: w(330, 9) },
    }),
    look('wildlife', 'Wildlife', 'Natural color with crisp fur and feather detail.', ['nature', 'wildlife', 'detail', 'natural'], {
      basic: { contrast: 12, highlights: -20, shadows: 12, texture: 16, clarity: 12, dehaze: 6, vibrance: 10 },
      curve: { rgb: tc(0, 0.02) },
      mixer: { sat: { green: -6, orange: 4 } },
      effects: { vignette: -10 },
    }),
  ],
}
