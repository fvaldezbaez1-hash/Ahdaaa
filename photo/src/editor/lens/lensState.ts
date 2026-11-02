import type { EditRecipe, LensCorrection, LensGeometry } from '../../edit/types'

// How a resolved lens profile lands in a recipe, and when a photo still needs
// one. The profile's coefficients are stored with the photo so rendering never
// needs the lens database; the amounts the person set survive a re-resolve.

/** What resolveLens returns that the recipe keeps (see src/lens ResolvedLens). */
export interface ResolvedProfile {
  lens: { id: string }
  geometry: LensGeometry['profile']
  vignetting: LensCorrection['vignetting']
  tca: LensCorrection['tca']
}

/** Profile corrections are on but nothing is resolved for this photo yet (new, pasted, or the lens changed). */
export function needsResolve(r: Pick<EditRecipe, 'lens' | 'geometry'>): boolean {
  const l = r.lens
  return l.enabled && (!l.profileId || (!l.vignetting && !l.tca && !r.geometry.lens?.profile))
}

/** Put a resolved profile (or none found: null) into the recipe, keeping amounts, manual values and the CA choice. */
export function withProfile(r: EditRecipe, resolved: ResolvedProfile | null, opts: { tca?: boolean } = {}): EditRecipe {
  const keepTca = opts.tca ?? (r.lens.tca !== null || !r.lens.profileId)
  const distortionAmount = r.geometry.lens?.profile?.amount ?? 100
  const vignettingAmount = r.lens.vignetting?.amount ?? 100
  return {
    ...r,
    lens: {
      ...r.lens,
      enabled: true,
      profileId: resolved?.lens.id ?? '',
      vignetting: resolved?.vignetting ? { ...resolved.vignetting, amount: vignettingAmount } : null,
      tca: keepTca ? (resolved?.tca ?? null) : null,
    },
    geometry: {
      ...r.geometry,
      lens: { manual: r.geometry.lens?.manual ?? 0, profile: resolved?.geometry ? { ...resolved.geometry, amount: distortionAmount } : null },
    },
  }
}

/** Profile corrections off: the resolved coefficients go, manual corrections stay. */
export function withoutProfile(r: EditRecipe): EditRecipe {
  const manual = r.geometry.lens?.manual ?? 0
  return {
    ...r,
    lens: { ...r.lens, enabled: false, profileId: '', vignetting: null, tca: null },
    geometry: { ...r.geometry, lens: manual ? { profile: null, manual } : undefined },
  }
}

/** Pasted onto another photo, a profile has to be found again for that photo's lens and focal length. */
export function blankProfile<T extends Partial<Pick<EditRecipe, 'lens' | 'geometry'>>>(r: T): T {
  return {
    ...r,
    ...(r.lens && { lens: { ...r.lens, profileId: '', vignetting: null, tca: null } }),
    ...(r.geometry?.lens && { geometry: { ...r.geometry, lens: { ...r.geometry.lens, profile: null } } }),
  }
}
