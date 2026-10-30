import { navigate } from '../router'

/** Open Settings at the AI assistant section. */
export function openAiSettings() {
  navigate('/settings')
  let frames = 0
  const reveal = () => {
    const el = document.getElementById('set-ai')
    if (el) el.scrollIntoView({ block: 'start' })
    else if (frames++ < 60) requestAnimationFrame(reveal)
  }
  requestAnimationFrame(reveal)
}
