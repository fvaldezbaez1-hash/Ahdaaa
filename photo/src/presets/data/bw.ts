import { look, tc, w, type CollectionDef, type LookDef } from './kit'

// Every look here converts to monochrome; the `bw` mixer sets how each color
// turns to gray (like a lens filter), and grading wheels tone the print.
const mono = (l: LookDef): LookDef => ({ ...l, data: { treatment: 'bw', ...l.data } })

export const bw: CollectionDef = {
  id: 'bw',
  name: 'Black & White',
  description: 'Monochrome from clean and modern to inky and grainy.',
  looks: [
    look('clean-mono', 'Clean Mono', 'A neutral, modern black and white with full tonal range.', ['bw', 'monochrome', 'clean', 'neutral'], {
      basic: { contrast: 12, highlights: -15, shadows: 10, clarity: 6 },
      curve: { rgb: tc(0, 0.02) },
    }),
    look('high-contrast', 'High Contrast', 'Bold, graphic mono: deep blacks, bright whites, dark skies.', ['bw', 'monochrome', 'contrast', 'dramatic'], {
      basic: { contrast: 40, whites: 14, blacks: -20, clarity: 16 },
      curve: { rgb: tc(0, 0.06) },
      mixer: { bw: { red: 15, blue: -20 } },
      effects: { vignette: -14 },
    }),
    look('soft-mono', 'Soft Mono', 'Gentle grays, lifted blacks and a fine grain.', ['bw', 'monochrome', 'soft', 'matte'], {
      basic: { contrast: -14, highlights: -20, shadows: 16 },
      curve: { rgb: tc(0.07, 0, 0.04) },
      mixer: { bw: { orange: 10 } },
      effects: { grain: 18 },
    }),
    look('infrared-mono', 'Infrared Mono', 'White foliage and near-black skies, like infrared film.', ['bw', 'infrared', 'landscape', 'surreal'], {
      basic: { contrast: 20, highlights: -10, whites: 10, clarity: 8 },
      curve: { rgb: tc(0, 0.04) },
      mixer: { bw: { green: 90, yellow: 60, red: 10, aqua: -70, blue: -100 } },
      effects: { grain: 10 },
    }),
    look('sepia-print', 'Sepia Print', 'Warm brown toning and soft blacks of an old print.', ['bw', 'sepia', 'vintage', 'toned', 'warm'], {
      basic: { contrast: 6 },
      curve: { rgb: tc(0.06, 0.01, 0.04) },
      grading: { shadows: w(30, 24), midtones: w(36, 14), highlights: w(42, 18) },
      effects: { grain: 14, vignette: -14 },
    }),
  ].map(mono),
}
