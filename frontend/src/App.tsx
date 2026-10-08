import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { NotFound } from './pages/NotFound'
import { AuthProvider } from './hooks/AuthProvider'
import { PageState } from './components/common/PageState'
import { ErrorBoundary } from './components/common/ErrorBoundary'
import './styles/tokens.css'
import './styles/globals.css'
import './hooks/useTheme'

const LoginPage = lazy(() => import('./pages/LoginPage').then(module => ({ default: module.LoginPage })))
const PlayerPage = lazy(() => import('./pages/PlayerPage').then(module => ({ default: module.PlayerPage })))
const AboutPage = lazy(() => import('./pages/AboutPage').then(module => ({ default: module.AboutPage })))
const AdminPage = lazy(() => import('./pages/AdminPage').then(module => ({ default: module.AdminPage })))
const LibraryPage = lazy(() => import('./pages/LibraryPage').then(module => ({ default: module.LibraryPage })))
const ProfilePage = lazy(() => import('./pages/ProfilePage').then(module => ({ default: module.ProfilePage })))

export default function App() {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <AuthProvider>
          <div id="toast-container" aria-label="Benachrichtigungen" />
          <Suspense fallback={<PageState loading title="Seite wird geladen …" />}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/about" element={<AboutPage />} />
              <Route path="/admin/*" element={<AdminPage />} />
              <Route path="/library" element={<LibraryPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/song/:trackId" element={<PlayerPage />} />
              <Route path="/" element={<PlayerPage />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </AuthProvider>
      </ErrorBoundary>
    </BrowserRouter>
  )
}
