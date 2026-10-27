import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { SettingsProvider } from './state'
import { Toaster } from './ui/toast'
import { ActiveWorkoutProvider } from './workout/active'
import './styles.css'

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
