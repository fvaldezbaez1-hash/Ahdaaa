import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { App } from './App'
import { SettingsProvider } from './state'
import { Toaster } from './ui/toast'
import { ActiveWorkoutProvider } from './workout/active'
import './styles.css'

// Offline support + updates: a new version installs in the background and the
// app reloads into it (a workout in progress is saved first). Re-check for
// updates whenever the app comes back to the foreground.
registerSW({
  immediate: true,
  onRegisteredSW(_url, reg) {
    if (!reg) return
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void reg.update().catch(() => {})
    })
  },
})

// Ask the browser not to clear our database when space is low. Installed
// home-screen apps usually get this automatically; it's harmless otherwise.
void navigator.storage?.persist?.().catch(() => {})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsProvider fallback={null}>
      <ActiveWorkoutProvider>
        <App />
        <Toaster />
      </ActiveWorkoutProvider>
    </SettingsProvider>
  </StrictMode>,
)
