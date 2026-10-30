import { RecipeSlider } from './RecipeSlider'
import { SubHead } from './Section'
import { TRACK } from './tracks'

export function LightSliders() {
  return (
    <>
      <RecipeSlider path="basic.exposure" label="Exposure" track={TRACK.exposure} />
      <RecipeSlider path="basic.contrast" label="Contrast" />
      <RecipeSlider path="basic.highlights" label="Highlights" />
      <RecipeSlider path="basic.shadows" label="Shadows" />
      <RecipeSlider path="basic.whites" label="Whites" />
      <RecipeSlider path="basic.blacks" label="Blacks" />
    </>
  )
}

export function PresenceSliders({ color = true, local = true }: { color?: boolean; local?: boolean }) {
  return (
    <>
      {local && (
        <>
          <RecipeSlider path="basic.texture" label="Texture" />
          <RecipeSlider path="basic.clarity" label="Clarity" />
          <RecipeSlider path="basic.dehaze" label="Dehaze" />
        </>
      )}
      {color && (
        <>
          <RecipeSlider path="basic.vibrance" label="Vibrance" track={TRACK.vibrance} />
          <RecipeSlider path="basic.saturation" label="Saturation" track={TRACK.saturation} />
        </>
      )}
    </>
  )
}

export function DetailSliders() {
  return (
    <>
      <SubHead>Sharpening</SubHead>
      <RecipeSlider path="detail.sharpen" label="Amount" history="Sharpening" />
      <RecipeSlider path="detail.radius" label="Radius" history="Sharpening radius" />
      <RecipeSlider path="detail.detail" label="Detail" history="Sharpening detail" />
      <RecipeSlider path="detail.masking" label="Masking" history="Sharpening masking" />
      <SubHead>Noise reduction</SubHead>
      <RecipeSlider path="detail.noise" label="Luminance" history="Noise reduction" />
      <RecipeSlider path="detail.noiseDetail" label="Detail" history="Noise reduction detail" />
      <RecipeSlider path="detail.colorNoise" label="Color" history="Color noise reduction" />
    </>
  )
}

export function EffectsSliders() {
  return (
    <>
      <SubHead>Vignette</SubHead>
      <RecipeSlider path="effects.vignette" label="Amount" history="Vignette" track={TRACK.darkLight} />
      <RecipeSlider path="effects.vignetteMidpoint" label="Midpoint" history="Vignette midpoint" />
      <RecipeSlider path="effects.vignetteRoundness" label="Roundness" history="Vignette roundness" />
      <RecipeSlider path="effects.vignetteFeather" label="Feather" history="Vignette feather" />
      <SubHead>Grain</SubHead>
      <RecipeSlider path="effects.grain" label="Amount" history="Grain" />
      <RecipeSlider path="effects.grainSize" label="Size" history="Grain size" />
      <RecipeSlider path="effects.grainRoughness" label="Roughness" history="Grain roughness" />
      <SubHead>Finish</SubHead>
      <RecipeSlider path="effects.fade" label="Fade" />
    </>
  )
}
