import { useEffect } from 'react'
import { EditorScreen } from './editor/EditorScreen'
import { LibraryScreen } from './library/LibraryScreen'
import { PresetsScreen } from './presets/PresetsScreen'
import { link, useRoute } from './router'
import { SettingsScreen } from './settings/SettingsScreen'
import { updateSettings, useSettings, type Settings } from './state/settings'
import { useEditor } from './state/editor'
import { Icon, Logo, type IconName } from './ui/Icon'
import { useIsPhone } from './ui/hooks'

const NAV: { path: string; label: string; icon: IconName }[] = [
  { path: '/', label: 'Library', icon: 'library' },
  { path: '/edit', label: 'Edit', icon: 'edit' },
  { path: '/presets', label: 'Presets', icon: 'presets' },
]

function isActive(navPath: string, path: string) {
  return navPath === '/' ? path === '/' : path.startsWith(navPath)
}

function useTheme(settings: Settings | undefined) {
  useEffect(() => {
    if (!settings) return
    const root = document.documentElement
    root.dataset.theme = settings.theme
    const dark = settings.theme === 'dark' || (settings.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#17171A' : '#FFFFFF')
  }, [settings])
}

export function TopBar({ path, editHref, right }: { path: string; editHref: string; right?: React.ReactNode }) {
  const settings = useSettings()
  const dark = settings?.theme !== 'light'
  return (
    <header className="topbar">
      <a className="brand" href={link('/')} aria-label="Lumen home">
        <Logo />
        Lumen
      </a>
      <nav className="nav-tabs" aria-label="Sections">
        {NAV.map((n) => (
          <a key={n.path} href={n.path === '/edit' ? editHref : link(n.path)} aria-current={isActive(n.path, path) ? 'page' : undefined}>
            {n.label}
          </a>
        ))}
      </nav>
      <div className="grow">{right}</div>
      <button className="icon-btn" aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} onClick={() => void updateSettings({ theme: dark ? 'light' : 'dark' })}>
        <Icon name={dark ? 'sun' : 'moon'} />
      </button>
      <a className="icon-btn" href={link('/settings')} aria-label="Settings" aria-current={path.startsWith('/settings') ? 'page' : undefined}>
        <Icon name="settings" />
      </a>
    </header>
  )
}

function TabBar({ path, editHref }: { path: string; editHref: string }) {
  const items = [...NAV, { path: '/settings', label: 'Settings', icon: 'settings' as IconName }]
  return (
    <nav className="tabbar" aria-label="Main">
      {items.map((n) => (
        <a key={n.path} href={n.path === '/edit' ? editHref : link(n.path)} aria-current={isActive(n.path, path) ? 'page' : undefined}>
          <Icon name={n.icon} size={22} />
          {n.label}
        </a>
      ))}
    </nav>
  )
}

export function App() {
  const settings = useSettings()
  useTheme(settings)
  const { path, parts } = useRoute()
  const phone = useIsPhone()
  const openId = useEditor((s) => s.photoId)
  const editHref = link(openId ? `/edit/${encodeURIComponent(openId)}` : '/')

  let screen: React.ReactNode
  const editing = parts[0] === 'edit' && !!parts[1]
  switch (parts[0]) {
    case 'edit':
      screen = parts[1] ? <EditorScreen key={parts[1]} id={parts[1]} /> : <LibraryScreen />
      break
    case 'presets':
      screen = <PresetsScreen />
      break
    case 'settings':
      screen = <SettingsScreen />
      break
    default:
      screen = <LibraryScreen />
  }

  // The editor takes the whole screen on phones (it has its own back button and tool bar).
  const showTabs = phone && !editing
  return (
    <div className={showTabs ? 'app has-tabbar' : 'app'}>
      {!phone && <TopBar path={path} editHref={editHref} />}
      <div className="screen">{screen}</div>
      {showTabs && <TabBar path={path} editHref={editHref} />}
    </div>
  )
}
