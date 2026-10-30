import { lin, look, pts, tc, w, type CollectionDef } from './kit'

export const vintage: CollectionDef = {
  id: 'vintage',
  name: 'Vintage',
  description: 'Sun-bleached prints, warm casts and old-camera charm.',
  looks: [
    look('seventies', '1970s', 'Amber cast, olive shadows and faded blacks.', ['vintage', 'retro', 'warm', 'faded'], {
      wbShift: { temp: 14, tint: -4 },
      basic: { contrast: -4, saturation: -10 },
      curve: { rgb: tc(0.07, 0.02, 0.04), b: lin(0.06, 0.88) },
      grading: { shadows: w(100, 15), highlights: w(42, 18) },
      effects: { grain: 20, vignette: -14 },
    }),
    look('eighties', '1980s', 'Punchy flash-snapshot color with a magenta lean.', ['vintage', 'retro', 'vivid', 'flash'], {
      wbShift: { temp: 2, tint: 8 },
      basic: { contrast: 14, vibrance: 14 },
      curve: { rgb: tc(0.03, 0.03, 0.02) },
      mixer: { sat: { red: 10, blue: 10 } },
      grading: { shadows: w(220, 12), highlights: w(330, 12) },
      effects: { grain: 14 },
    }),
    look('square-print', 'Square Print', 'Instant-print cyan cast, washed blacks and a heavy vignette.', ['vintage', 'instant', 'cyan', 'faded'], {
      wbShift: { temp: -4, tint: -2 },
      basic: { contrast: -10, saturation: -14 },
      curve: { rgb: tc(0.08, 0.02, 0.06), r: lin(0, 0.96) },
      grading: { shadows: w(185, 21), highlights: w(50, 15) },
      effects: { grain: 8, vignette: -20 },
    }),
    look('home-movie', 'Home Movie', 'Warm, grainy small-gauge film with dark corners.', ['vintage', 'film', 'grain', 'warm', 'nostalgic'], {
      wbShift: { temp: 10, tint: 0 },
      basic: { contrast: 10, clarity: -10, saturation: -6 },
      curve: { rgb: tc(0.05, 0.03, 0.04) },
      grading: { shadows: w(30, 15), highlights: w(45, 18) },
      effects: { grain: 40, grainSize: 45, grainRoughness: 60, vignette: -30 },
    }),
    look('faded-print', 'Faded Print', 'A print left in the sun: pale, soft and slightly magenta.', ['vintage', 'faded', 'muted', 'soft'], {
      wbShift: { temp: 4, tint: 6 },
      basic: { contrast: -10, saturation: -20 },
      curve: { rgb: tc(0.06, 0.01, 0.05) },
      grading: { highlights: w(20, 12) },
      effects: { fade: 18, grain: 12 },
    }),
    look('sun-bleached', 'Sun Bleached', 'Bleached cyan-white highlights and washed-out reds.', ['vintage', 'bleached', 'faded', 'summer'], {
      basic: { exposure: 0.1, contrast: -8, saturation: -24 },
      curve: { rgb: tc(0.06, 0, 0.05, 0.02), r: lin(0.02, 0.94) },
      mixer: { sat: { red: -14 } },
      grading: { shadows: w(180, 15), highlights: w(60, 9) },
    }),
    look('retro-warm', 'Retro Warm', 'Rich, warm sixties color with soft grain.', ['vintage', 'warm', 'retro', 'rich'], {
      wbShift: { temp: 12, tint: 0 },
      basic: { contrast: 8 },
      curve: { rgb: tc(0.04, 0.025, 0.03) },
      mixer: { hue: { green: -10 }, sat: { orange: 10, red: 6, blue: -10 } },
      grading: { shadows: w(25, 12), highlights: w(40, 15) },
      effects: { grain: 16 },
    }),
    look('cross-process', 'Cross Process', 'Yellow-green highlights, blue shadows and hard, saturated contrast.', ['vintage', 'cross process', 'vivid', 'experimental'], {
      basic: { contrast: 18, saturation: 10 },
      curve: {
        rgb: tc(0, 0.02),
        r: pts(0, 0, 0.25, 0.2, 0.75, 0.82, 1, 1),
        g: pts(0, 0.02, 0.5, 0.55, 1, 1),
        b: pts(0, 0.12, 0.5, 0.45, 1, 0.82),
      },
      effects: { vignette: -16 },
    }),
    look('toy-camera', 'Toy Camera', 'Plastic-lens charm: saturated, contrasty, with deep dark corners.', ['vintage', 'lo-fi', 'vignette', 'vivid'], {
      basic: { contrast: 22, clarity: -10, vibrance: 18, saturation: 8 },
      curve: { rgb: tc(0.03, 0.04) },
      grading: { shadows: w(200, 15), highlights: w(55, 12) },
      effects: { grain: 18, vignette: -50, vignetteMidpoint: 30, vignetteFeather: 60 },
    }),
    look('yellowed', 'Yellowed', 'An old album page: yellowed whites and tired color.', ['vintage', 'yellow', 'faded', 'aged'], {
      wbShift: { temp: 16, tint: -2 },
      basic: { contrast: -6, saturation: -20 },
      curve: { rgb: tc(0.06, 0.01, 0.06), b: lin(0.04, 0.85) },
      grading: { shadows: w(40, 15), highlights: w(52, 24) },
      effects: { grain: 14, vignette: -18 },
    }),
  ],
}
