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
    look('wildlife', 'Wildlife', 'Natural color with crisp fur and feather detail.', ['nature', 'wildlife', 'detail', 'natural'], {
      basic: { contrast: 12, highlights: -20, shadows: 12, texture: 16, clarity: 12, dehaze: 6, vibrance: 10 },
      curve: { rgb: tc(0, 0.02) },
      mixer: { sat: { green: -6, orange: 4 } },
      effects: { vignette: -10 },
    }),
  ],
}
