import type { Retouch, RetouchSpot } from './types'

// The recipe's `retouch` list holds heal / clone spots and AI removals; the
// heal tool and the spot renderer work with the spots only.

export const isSpot = (t: Retouch): t is RetouchSpot => t.mode !== 'remove'

/** Heal / clone spots, in order. */
export const spotsOf = (r: readonly Retouch[] | undefined): RetouchSpot[] => (r ?? []).filter(isSpot)

/** Replace the spots, keeping the AI removals (which apply before them). */
export const withSpots = (r: readonly Retouch[], spots: RetouchSpot[]): Retouch[] => [...r.filter((t) => !isSpot(t)), ...spots]
