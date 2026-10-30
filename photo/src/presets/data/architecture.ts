import { look, tc, w, type CollectionDef } from './kit'

export const architecture: CollectionDef = {
  id: 'architecture',
  name: 'Architecture',
  description: 'Clean lines, neutral color and crisp detail.',
  looks: [
    look('concrete-grey', 'Concrete Grey', 'Almost monochrome cool gray, with texture in the surfaces.', ['architecture', 'gray', 'muted', 'cool'], {
      wbShift: { temp: -4, tint: 0 },
      basic: { contrast: 14, clarity: 12, saturation: -50 },
      curve: { rgb: tc(0.02, 0.025) },
      grading: { global: w(210, 4) },
    }),
    look('glass-steel', 'Glass & Steel', 'Cool blue reflections and hard modern edges.', ['architecture', 'cool', 'blue', 'modern'], {
      wbShift: { temp: -12, tint: 0 },
      basic: { contrast: 16, clarity: 16, saturation: -6 },
      curve: { rgb: tc(0, 0.03) },
      mixer: { sat: { blue: 12, aqua: 8 }, lum: { blue: -6 } },
      grading: { shadows: w(210, 15) },
    }),
    look('warm-brick', 'Warm Brick', 'Rich reds and terracotta against blue sky.', ['architecture', 'warm', 'red', 'city'], {
      wbShift: { temp: 8, tint: 0 },
      basic: { contrast: 12, clarity: 10 },
      curve: { rgb: tc(0, 0.02) },
      mixer: { sat: { red: 10, orange: 12, blue: 8 }, lum: { orange: -6 } },
      grading: { highlights: w(38, 9) },
    }),
    look('blueprint', 'Blueprint', 'Strong steel-blue toning over quiet color.', ['architecture', 'blue', 'toned', 'graphic'], {
      wbShift: { temp: -20, tint: 0 },
      basic: { contrast: 16, clarity: 10, saturation: -20 },
      curve: { rgb: tc(0.03, 0.03) },
      grading: { shadows: w(215, 33), highlights: w(200, 15) },
    }),
    look('facade', 'Facade', 'Even detail from bright sky to shaded walls.', ['architecture', 'detail', 'balanced', 'hdr'], {
      basic: { contrast: 8, highlights: -50, shadows: 40, texture: 10, clarity: 16, vibrance: 6 },
      curve: { rgb: tc(0, 0.02) },
    }),
  ],
}
