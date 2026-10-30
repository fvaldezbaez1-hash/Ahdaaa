import { spotsOf } from '../../edit/retouch'
import { useEditor } from '../../state/editor'
import { useMediaQuery } from '../../ui/hooks'
import { useView } from '../view'

/** One line on the photo saying what a click or drag will do with the current tool. */
export function ToolHint() {
  const tool = useView((s) => s.tool)
  const placing = useView((s) => s.placing)
  const picking = useView((s) => s.rangePick)
  const layerId = useView((s) => s.layer)
  const maskId = useView((s) => s.mask)
  const touch = useMediaQuery('(pointer: coarse)')
  const kind = useEditor((s) => {
    const l = s.recipe?.layers.find((x) => x.id === layerId)
    const m = l?.masks.find((x) => x.id === maskId) ?? l?.masks[0]
    return m ? (m.type === 'range' ? m.range : m.type === 'ai' ? `ai-${m.target}` : m.type) : null
  })
  const removeMode = useView((s) => s.heal.mode === 'remove')
  const removing = useView((s) => !!s.removing)
  const exclude = useView((s) => s.exclude)
  const spots = useEditor((s) => (s.recipe ? spotsOf(s.recipe.retouch).length : 0))
  const tap = touch ? 'Tap' : 'Click'

  let text: string | null = null
  if (tool === 'heal') {
    if (removeMode) text = removing ? null : `Paint over what should go, then ${touch ? 'lift your finger' : 'let go'}`
    else text = spots ? null : `${tap} a blemish to heal it, or drag along a line`
  }
  else if (tool === 'mask') {
    if (placing === 'linear') text = `Drag where the effect fades out · ${tap.toLowerCase()} to place it`
    else if (placing === 'radial') text = `Drag from the center outward · ${tap.toLowerCase()} to place it`
    else if (picking) text = `${tap} the ${kind === 'luminance' ? 'brightness' : 'color'} to select`
    else if (kind === 'ai-object')
      text = exclude ? `${tap} parts to leave out of the selection` : touch ? 'Tap the object to select it' : 'Click the object to select it · Alt-click leaves a part out'
    else if (kind === 'brush') text = touch ? 'Paint where the adjustment goes · two fingers to move' : 'Paint where the adjustment goes · Alt erases · [ ] size'
    else if (!kind) text = 'Choose a mask in the panel'
  }
  if (!text) return null
  return (
    <div className="ed-stage-hint" role="status">
      {text}
    </div>
  )
}
