// Light / dark theme. "system" follows the operating system and switches live when it changes.
import { useSyncExternalStore } from 'react'

export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

/** Also read by the inline script in index.html that sets the theme before the first paint. */
const STORAGE_KEY = 'tabs.theme'
const systemDark = window.matchMedia('(prefers-color-scheme: dark)')

interface ThemeState {
  preference: ThemePreference
  resolved: ResolvedTheme
}

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === 'light' || stored === 'dark' ? stored : 'system'
  } catch {
    return 'system'
  }
}

function resolve(preference: ThemePreference): ResolvedTheme {
  if (preference === 'system') return systemDark.matches ? 'dark' : 'light'
  return preference
}

const listeners = new Set<() => void>()
let state: ThemeState = { preference: readPreference(), resolved: 'light' }

function apply(preference: ThemePreference) {
  state = { preference, resolved: resolve(preference) }
  document.documentElement.dataset.theme = state.resolved
  for (const listener of listeners) listener()
}

apply(state.preference)
systemDark.addEventListener('change', () => {
  if (state.preference === 'system') apply('system')
})

export function setThemePreference(preference: ThemePreference) {
  try {
    if (preference === 'system') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, preference)
  } catch {
    // Private browsing: the choice lasts for this visit only.
  }
  apply(preference)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useTheme(): ThemeState {
  return useSyncExternalStore(subscribe, () => state)
}
