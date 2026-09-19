import { useCallback, useSyncExternalStore } from 'react'

type Theme = 'light' | 'dark'
const listeners = new Set<() => void>()
function readTheme(): Theme {
  try { return localStorage.getItem('theme') === 'light' ? 'light' : 'dark' } catch { return 'dark' }
}
let theme = readTheme()
function applyTheme() {
  document.documentElement.setAttribute('data-theme', theme)
  document.documentElement.style.colorScheme = theme
}
applyTheme()
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
window.addEventListener('storage', event => {
  if (event.key === 'theme') { theme = readTheme(); applyTheme(); listeners.forEach(listener => listener()) }
})
export function useTheme() {
  const current = useSyncExternalStore(subscribe, () => theme)
  const toggle = useCallback(() => {
    theme = theme === 'dark' ? 'light' : 'dark'
    try { localStorage.setItem('theme', theme) } catch { /* preference remains available in this session */ }
    applyTheme()
    listeners.forEach(listener => listener())
  }, [])
  return { theme: current, toggle }
}
