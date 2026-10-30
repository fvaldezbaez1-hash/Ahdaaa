import { look, tc, w, type CollectionDef } from './kit'

// Skin sits in the orange band: these looks lift its luminance rather than
// push its hue or saturation, and keep midtone grading light.
export const portrait: CollectionDef = {
  id: 'portrait',
  name: 'Portrait',
  description: 'Flattering skin, soft contrast and gentle warmth.',
  looks: [
    look('natural-skin', 'Natural Skin', 'True, healthy skin with softened texture and open shadows.', ['portrait', 'skin', 'natural', 'subtle'], {
      profile: 'portrait',
      wbShift: { temp: 3, tint: 1 },
      basic: { highlights: -20, shadows: 12, texture: -10, clarity: -4, vibrance: 4 },
      curve: { rgb: tc(0.015, 0.01) },
      mixer: { lum: { orange: 4 } },
    }),
    look('warm-glow', 'Warm Glow', 'Sun-kissed warmth and a soft glow on the face.', ['portrait', 'warm', 'glow', 'soft'], {
      wbShift: { temp: 10, tint: 3 },
      basic: { exposure: 0.08, contrast: -8, highlights: -28, shadows: 16, texture: -8, clarity: -12 },
      curve: { rgb: tc(0.03, 0, 0.03, 0.01) },
      grading: { midtones: w(30, 6), highlights: w(38, 18) },
      effects: { fade: 4 },
    }),
    look('editorial', 'Editorial', 'Magazine-style: muted color, firm contrast, skin kept alive.', ['portrait', 'muted', 'fashion', 'contrast'], {
      wbShift: { temp: -3, tint: 0 },
      basic: { contrast: 18, highlights: -18, blacks: -12, clarity: 8, saturation: -22 },
      curve: { rgb: tc(0.02, 0.03) },
      mixer: { sat: { orange: 8 }, lum: { orange: 4 } },
      grading: { shadows: w(210, 12) },
    }),
    look('soft-light', 'Soft Light', 'Diffused, low-contrast light with smooth skin.', ['portrait', 'soft', 'bright', 'low contrast'], {
      basic: { exposure: 0.1, contrast: -16, highlights: -30, shadows: 20, texture: -14, clarity: -10, saturation: -6 },
      curve: { rgb: tc(0.04, 0, 0.03) },
      grading: { highlights: w(35, 8) },
    }),
    look('studio-clean', 'Studio Clean', 'Crisp whites and neutral color for studio and headshots.', ['portrait', 'studio', 'clean', 'neutral'], {
      wbShift: { temp: -2, tint: 0 },
      basic: { contrast: 6, highlights: -10, whites: 10, blacks: -6, texture: -6, vibrance: 4 },
      curve: { rgb: tc(0, 0.015) },
      mixer: { sat: { orange: -4 }, lum: { orange: 4 } },
    }),
    look('golden-skin', 'Golden Skin', 'A golden cast in the light tones that flatters every complexion.', ['portrait', 'warm', 'golden', 'skin'], {
      wbShift: { temp: 7, tint: 1 },
      basic: { contrast: 4 },
      curve: { rgb: tc(0.02, 0.015) },
      mixer: { sat: { orange: 4 }, lum: { orange: 6 } },
      grading: { midtones: w(35, 12), highlights: w(45, 15) },
    }),
    look('porcelain', 'Porcelain', 'Bright, cool and luminous, with lightened skin and quiet color.', ['portrait', 'bright', 'cool', 'beauty'], {
      wbShift: { temp: -4, tint: 2 },
      basic: { exposure: 0.1, highlights: -20, shadows: 14, texture: -12, saturation: -14 },
      curve: { rgb: tc(0.03, 0, 0, 0.02) },
      mixer: { sat: { orange: -10, red: -8 }, lum: { orange: 12, red: 6 } },
      grading: { highlights: w(330, 6) },
    }),
    look('rosy', 'Rosy', 'A hint of pink in the highlights for a fresh, healthy flush.', ['portrait', 'pink', 'soft', 'romantic'], {
      wbShift: { temp: 4, tint: 6 },
      basic: { contrast: -4 },
      curve: { rgb: tc(0.03, 0.01, 0.02) },
      mixer: { sat: { red: 4 }, lum: { red: 4 } },
      grading: { midtones: w(10, 6), highlights: w(345, 15) },
    }),
    look('bronze', 'Bronze', 'Rich, tanned tones with depth and a dark edge.', ['portrait', 'warm', 'rich', 'contrast'], {
      wbShift: { temp: 8, tint: -1 },
      basic: { contrast: 14, blacks: -8, clarity: 6 },
      curve: { rgb: tc(0, 0.03) },
      mixer: { hue: { orange: -2 }, sat: { orange: 8 }, lum: { orange: -6 } },
      grading: { shadows: w(25, 15), highlights: w(40, 12) },
      effects: { vignette: -12 },
    }),
    look('window-light', 'Window Light', 'Quiet, directional mood: deeper shadows and a falloff to the edges.', ['portrait', 'moody', 'low key', 'natural light'], {
      wbShift: { temp: -2, tint: 0 },
      basic: { exposure: -0.06, contrast: 10, highlights: -20, shadows: -8, saturation: -8 },
      curve: { rgb: tc(0.03, 0.02, 0.02, -0.02) },
      grading: { shadows: w(220, 9) },
      effects: { vignette: -22 },
    }),
  ],
}
