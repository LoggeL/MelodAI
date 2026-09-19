// @vitest-environment happy-dom
import { act, createElement, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PlayerPage } from '../PlayerPage'
import { LoginPage } from '../LoginPage'
import { AuthProvider } from '../../hooks/AuthProvider'
import { useAuth } from '../../hooks/useAuth'
import { auth } from '../../services/api'

const player = vi.hoisted(() => ({
  currentTrack: null, currentIndex: -1, queue: [], favorites: new Set(),
  syncPushRef: { current: null }, syncCommandRef: { current: null }, syncPlaybackIntentRef: { current: null },
  addToQueue: vi.fn(), applySyncState: vi.fn(), applySyncCommand: vi.fn(),
}))
vi.mock('../../hooks/usePlayer', () => ({ usePlayer: () => player }))
vi.mock('../../hooks/useSync', () => ({ useSync: () => ({ pushQueue: vi.fn(), sendCommand: vi.fn(), markPlaybackIntent: vi.fn() }) }))
vi.mock('../../hooks/useTheme', () => ({ useTheme: () => ({ toggle: vi.fn() }) }))
vi.mock('../../hooks/useAlbumColors', () => ({ useAlbumColors: vi.fn() }))
vi.mock('../../hooks/useToast', () => ({ showToast: vi.fn() }))
vi.mock('../../components/Layout/Header', () => ({ Header: ({ onLogout }: { onLogout: () => void }) => createElement('button', { onClick: onLogout }, 'Sign out') }))
vi.mock('../../components/Layout/Sidebar', () => ({ Sidebar: () => null }))
vi.mock('../../components/Search/SearchBar', () => ({ SearchBar: () => null }))
vi.mock('../../components/Player/Controls', () => ({ Controls: () => null }))
vi.mock('../../components/Player/SuggestedSongs', () => ({ SuggestedSongs: () => null }))
vi.mock('../../services/api', async original => {
  const actual = await original<typeof import('../../services/api')>()
  return { ...actual, auth: { ...actual.auth, check: vi.fn(), logout: vi.fn() } }
})

let root: Root
let container: HTMLDivElement
let session: ReturnType<typeof useAuth>
let location: ReturnType<typeof useLocation>
function Probe() {
  const currentSession = useAuth()
  const currentLocation = useLocation()
  useEffect(() => { session = currentSession; location = currentLocation }, [currentSession, currentLocation])
  return null
}
const authenticated = (username: string) => ({ authenticated: true, username, is_admin: true, credits: 100 })
const mount = async (path: string) => {
  await act(async () => root.render(createElement(MemoryRouter, { initialEntries: [path] },
    createElement(AuthProvider, null,
      createElement(Probe),
      createElement(Routes, null,
        createElement(Route, { path: '/song/:trackId', element: createElement(PlayerPage) }),
        createElement(Route, { path: '/', element: createElement(PlayerPage) }),
        createElement(Route, { path: '/login', element: createElement(LoginPage) }),
      ),
    ),
  )))
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear()
  vi.mocked(auth.check).mockResolvedValue(authenticated('first'))
  vi.mocked(auth.logout).mockResolvedValue({ success: true })
  container = document.createElement('div')
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

it('clears the previous account song return path on intentional logout before another account signs in', async () => {
  await mount('/song/1')
  expect(player.addToQueue).toHaveBeenCalledWith('1', undefined, true)
  await act(async () => container.querySelector('button')!.click())
  expect(location.pathname).toBe('/login')
  expect(location.state).toEqual({ from: '/' })
  vi.mocked(auth.check).mockResolvedValue(authenticated('second'))
  player.addToQueue.mockClear()
  await act(async () => session.check())
  expect(location.pathname).toBe('/')
  expect(player.addToQueue).not.toHaveBeenCalled()
})

it('preserves an explicitly opened song link through an ordinary unauthenticated sign-in', async () => {
  vi.mocked(auth.check).mockResolvedValue({ authenticated: false })
  await mount('/song/2')
  expect(location.pathname).toBe('/login')
  expect(location.state).toEqual({ from: '/song/2' })
  vi.mocked(auth.check).mockResolvedValue(authenticated('member'))
  await act(async () => session.check())
  expect(location.pathname).toBe('/song/2')
  expect(player.addToQueue).toHaveBeenCalledWith('2', undefined, true)
})
