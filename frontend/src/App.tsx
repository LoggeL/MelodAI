import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { LoginPage } from './pages/LoginPage'
import { PlayerPage } from './pages/PlayerPage'
import { AboutPage } from './pages/AboutPage'
import { AdminPage } from './pages/AdminPage'
import { LibraryPage } from './pages/LibraryPage'
import { ProfilePage } from './pages/ProfilePage'
import './styles/globals.css'

export default function App() {
  return (
    <BrowserRouter>
      <div id="toast-container" />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/admin/*" element={<AdminPage />} />
        <Route path="/library" element={<LibraryPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/song/:trackId" element={<PlayerPage />} />
        <Route path="/" element={<PlayerPage />} />
      </Routes>
    </BrowserRouter>
  )
}
