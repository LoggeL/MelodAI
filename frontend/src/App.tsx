import { lazy, Suspense } from 'react'
import { BrowserRouter, Link, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './hooks/AuthProvider'
import { PageState } from './components/common/PageState'
import { ErrorBoundary } from './components/common/ErrorBoundary'
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
          <div id="toast-container" aria-label="Notifications" />
          <Suspense fallback={<PageState loading title="Loading page" />}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/about" element={<AboutPage />} />
              <Route path="/admin/*" element={<AdminPage />} />
              <Route path="/library" element={<LibraryPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/song/:trackId" element={<PlayerPage />} />
              <Route path="/" element={<PlayerPage />} />
              <Route path="*" element={<PageState title="Page not found" description="This page does not exist." action={<Link className="button" to="/">Back to player</Link>} />} />
            </Routes>
          </Suspense>
        </AuthProvider>
      </ErrorBoundary>
    </BrowserRouter>
  )
}
