// Color grading wheels: hue is the angle (0° = red at 3 o'clock, increasing
// counter-clockwise like the color circle), saturation the distance from the
// center (0 at the center, 100 at the rim). Screen y grows downward.

export function pointToHueSat(dx: number, dy: number, radius: number): { hue: number; sat: number } {
  const sat = Math.min(100, (Math.hypot(dx, dy) / radius) * 100)
  if (sat === 0) return { hue: 0, sat: 0 }
  const hue = ((Math.atan2(-dy, dx) * 180) / Math.PI + 360) % 360
  return { hue: Math.round(hue), sat: Math.round(sat) }
}

export function hueSatToPoint(hue: number, sat: number, radius: number): { x: number; y: number } {
  const a = (hue * Math.PI) / 180
  const r = (Math.min(100, Math.max(0, sat)) / 100) * radius
  return { x: Math.cos(a) * r, y: -Math.sin(a) * r }
}

/** Swatch color for a wheel setting (what the tint roughly looks like). */
export function wheelColor(hue: number, sat: number): string {
  return `hsl(${Math.round(hue)} ${Math.round(40 + sat * 0.5)}% ${Math.round(70 - sat * 0.15)}%)`
}

/**
 * The wheel's paint. CSS conic gradients run clockwise from 12 o'clock, so to
 * put red at 3 o'clock with hue rising counter-clockwise the stops go backwards.
 */
export const WHEEL_GRADIENT = 'conic-gradient(from 90deg, #f44, #f4f, #44f, #4ff, #4f4, #ff4, #f44)'
