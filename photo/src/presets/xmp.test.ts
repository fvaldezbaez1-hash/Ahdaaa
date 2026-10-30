import { describe, expect, it } from 'vitest'
import { findBuiltin } from './catalog'
import { parseXmp, toXmp } from './xmp'

// Shaped like a Lightroom Classic 13 export: attributes, a Name alt, point curves, a
// profile Look block, color grading, and a mask group plus calibration Lumen can't use.
const CLASSIC = `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 7.0-c000">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
   crs:PresetType="Normal" crs:Cluster="" crs:UUID="0D8F0AE3C1F24B5A9E2B1C2D3E4F5A6B"
   crs:SupportsAmount2="True" crs:SupportsAmount="True" crs:SupportsColor="True" crs:SupportsMonochrome="True"
   crs:Version="16.0" crs:ProcessVersion="15.4"
   crs:WhiteBalance="As Shot"
   crs:IncrementalTemperature="+12" crs:IncrementalTint="-3"
   crs:Exposure2012="+0.25" crs:Contrast2012="-12" crs:Highlights2012="-45" crs:Shadows2012="+30"
   crs:Whites2012="0" crs:Blacks2012="+8" crs:Texture="-10" crs:Clarity2012="+6" crs:Dehaze="0"
   crs:Vibrance="+15" crs:Saturation="-8"
   crs:ParametricShadows="0" crs:ParametricDarks="0" crs:ParametricLights="0" crs:ParametricHighlights="0"
   crs:ParametricShadowSplit="25" crs:ParametricMidtoneSplit="50" crs:ParametricHighlightSplit="75"
   crs:Sharpness="40" crs:SharpenRadius="+1.0" crs:SharpenDetail="25" crs:SharpenEdgeMasking="0"
   crs:LuminanceSmoothing="12" crs:ColorNoiseReduction="25"
   crs:HueAdjustmentRed="0" crs:HueAdjustmentOrange="-4" crs:HueAdjustmentGreen="+22"
   crs:SaturationAdjustmentGreen="-30" crs:SaturationAdjustmentBlue="-12" crs:LuminanceAdjustmentOrange="+8"
   crs:SplitToningShadowHue="210" crs:SplitToningShadowSaturation="18" crs:SplitToningHighlightHue="40"
   crs:SplitToningHighlightSaturation="14" crs:SplitToningBalance="-10"
   crs:ColorGradeMidtoneHue="0" crs:ColorGradeMidtoneSat="0" crs:ColorGradeShadowLum="+5"
   crs:ColorGradeMidtoneLum="0" crs:ColorGradeHighlightLum="0" crs:ColorGradeBlending="65" crs:ColorGradeGlobalHue="0"
   crs:ColorGradeGlobalSat="0" crs:ColorGradeGlobalLum="0"
   crs:ColorGradeShadowHue="210" crs:ColorGradeShadowSat="18" crs:ColorGradeHighlightHue="40" crs:ColorGradeHighlightSat="14"
   crs:ColorGradeBalance="-10"
   crs:PostCropVignetteAmount="-18" crs:PostCropVignetteMidpoint="40" crs:PostCropVignetteFeather="60"
   crs:PostCropVignetteRoundness="0" crs:PostCropVignetteStyle="1" crs:PostCropVignetteHighlightContrast="0"
   crs:GrainAmount="22" crs:GrainSize="30" crs:GrainFrequency="55"
   crs:ConvertToGrayscale="False" crs:ToneCurveName2012="Custom"
   crs:RedHue="+12" crs:RedSaturation="+6" crs:BlueHue="-20" crs:ShadowTint="0"
   crs:LensProfileEnable="1" crs:AutoLateralCA="1"
   crs:HasSettings="True">
   <crs:Name>
    <rdf:Alt>
     <rdf:li xml:lang="x-default">Golden Coast &amp; Sea</rdf:li>
    </rdf:Alt>
   </crs:Name>
   <crs:Group><rdf:Alt><rdf:li xml:lang="x-default">Summer Pack</rdf:li></rdf:Alt></crs:Group>
   <crs:Look>
    <rdf:Description crs:Name="Adobe Portrait" crs:Amount="1" crs:UUID="D6496412E06A83BCD8A8A1A6F3B3F1E9"/>
   </crs:Look>
   <crs:ToneCurvePV2012>
    <rdf:Seq>
     <rdf:li>0, 18</rdf:li>
     <rdf:li>64, 60</rdf:li>
     <rdf:li>192, 198</rdf:li>
     <rdf:li>255, 245</rdf:li>
    </rdf:Seq>
   </crs:ToneCurvePV2012>
   <crs:ToneCurvePV2012Red><rdf:Seq><rdf:li>0, 0</rdf:li><rdf:li>255, 255</rdf:li></rdf:Seq></crs:ToneCurvePV2012Red>
   <crs:ToneCurvePV2012Blue><rdf:Seq><rdf:li>0, 12</rdf:li><rdf:li>255, 240</rdf:li></rdf:Seq></crs:ToneCurvePV2012Blue>
   <crs:MaskGroupBasedCorrections>
    <rdf:Seq><rdf:li><rdf:Description crs:What="Correction" crs:LocalExposure2012="+0.5" crs:CorrectionName="Sky"/></rdf:li></rdf:Seq>
   </crs:MaskGroupBasedCorrections>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>`

// Older Camera Raw style: a custom prefix, settings as child elements, absolute Kelvin, B&W mix.
const ELEMENTS = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:cr="http://ns.adobe.com/camera-raw-settings/1.0/">
   <cr:Temperature>6500</cr:Temperature>
   <cr:Tint>+10</cr:Tint>
   <cr:Contrast2012>+35</cr:Contrast2012>
   <cr:ConvertToGrayscale>True</cr:ConvertToGrayscale>
   <cr:GrayMixerRed>+20</cr:GrayMixerRed>
   <cr:GrayMixerBlue>-40</cr:GrayMixerBlue>
   <cr:ParametricDarks>-20</cr:ParametricDarks>
   <cr:ParametricLights>+15</cr:ParametricLights>
   <cr:PerspectiveVertical>+5</cr:PerspectiveVertical>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`

describe('parseXmp', () => {
  it('maps a Lightroom Classic preset and reports what it could not use', () => {
    const r = parseXmp(CLASSIC, 'golden.xmp')
    expect(r.name).toBe('Golden Coast & Sea')
    expect(r.data.wbShift).toEqual({ temp: 12, tint: -3 })
    expect(r.data.basic).toEqual({ exposure: 0.25, contrast: -12, highlights: -45, shadows: 30, blacks: 8, texture: -10, clarity: 6, vibrance: 15, saturation: -8 })
    expect(r.data.mixer).toEqual({ hue: { orange: -4, green: 22 }, sat: { green: -30, blue: -12 }, lum: { orange: 8 } })
    expect(r.data.grading).toEqual({ shadows: { hue: 210, sat: 18, lum: 5 }, highlights: { hue: 40, sat: 14, lum: 0 }, blending: 65, balance: -10 })
    expect(r.data.curve?.rgb).toHaveLength(4)
    expect(r.data.curve?.rgb?.[0]).toEqual({ x: 0, y: 18 / 255 })
    expect(r.data.curve?.r).toBeUndefined()
    expect(r.data.curve?.b).toEqual([{ x: 0, y: 12 / 255 }, { x: 1, y: 240 / 255 }])
    expect(r.data.detail).toEqual({ noise: 12 })
    expect(r.data.effects).toEqual({ vignette: -18, vignetteMidpoint: 40, vignetteFeather: 60, grain: 22, grainSize: 30, grainRoughness: 55 })
    expect(r.data.treatment).toBe('color')
    expect(r.data.profile).toBe('portrait')
    expect(r.unmapped).toEqual(expect.arrayContaining(['Masks & local adjustments', 'Calibration (3)', 'Lens corrections (2)']))
    expect(r.unmapped.join()).not.toMatch(/Split|Parametric|Sharp|Group|Name/)
    expect(r.mapped).toBeGreaterThan(25)
  })

  it('reads child elements with any prefix, absolute white balance and the parametric curve', () => {
    const r = parseXmp(ELEMENTS, 'Old Mono.xmp')
    expect(r.name).toBe('Old Mono')
    expect(r.data.treatment).toBe('bw')
    expect(r.data.mixer?.bw).toEqual({ red: 20, blue: -40 })
    expect(r.data.basic).toEqual({ contrast: 35 })
    expect(r.data.wbShift).toEqual({ temp: 28, tint: 10 })
    expect(r.approximated).toHaveLength(2)
    expect(r.data.curve?.rgb?.find((p) => p.x === 0.375)?.y).toBeCloseTo(0.355)
    expect(r.unmapped).toEqual(['Transform'])
  })

  it('rejects files without Camera Raw settings', () => {
    expect(() => parseXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF/></x:xmpmeta>')).toThrow(/Not a Lightroom/)
  })
})

describe('toXmp', () => {
  it('round-trips a built-in look', () => {
    for (const id of ['film-warm-400', 'film-expired', 'bw-infrared-mono', 'vintage-cross-process', 'creative-split-tone']) {
      const p = findBuiltin(id)!
      const back = parseXmp(toXmp(p.name, p.data, '6f1c0d8e-0000-4000-8000-000000000000'))
      expect(back.name).toBe(p.name)
      expect(back.unmapped).toEqual([])
      const { profile, ...data } = p.data
      expect(profile).toBeUndefined()
      for (const ch of ['rgb', 'r', 'g', 'b'] as const)
        data.curve?.[ch]?.forEach((pt, i) => {
          expect(back.data.curve?.[ch]?.[i].x).toBeCloseTo(pt.x, 2)
          expect(back.data.curve?.[ch]?.[i].y).toBeCloseTo(pt.y, 2)
        })
      expect({ ...back.data, curve: undefined }).toEqual({ ...data, curve: undefined, ...(data.grading ? { grading: data.grading } : {}) })
    }
  })
})
