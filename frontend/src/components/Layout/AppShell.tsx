import { useCallback, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useTheme } from '../../hooks/useTheme'
import { showToast } from '../../hooks/useToast'
import { de } from '../../utils/messages'
import { Header } from './Header'
import styles from './AppShell.module.css'

/** Shared frame for pages other than the player: header and a centred page column. */
export function AppShell({ children, narrow = false }: { children: ReactNode; narrow?: boolean }) {
  const { username, displayName, isAdmin, credits, logout } = useAuth()
  const { theme, toggle } = useTheme()
  const navigate = useNavigate()
  const handleLogout = useCallback(async () => {
    try {
      await logout()
      navigate('/login', { replace: true, state: { from: '/' } })
    } catch (error) {
      showToast(error instanceof Error ? de(error.message) : 'Abmelden fehlgeschlagen.', 'error')
    }
  }, [logout, navigate])
  return (
    <div className={`page-shell ${styles.shell}`}>
      <div className={styles.top}>
        <Header username={username} displayName={displayName} isAdmin={isAdmin} credits={credits}
          theme={theme} onThemeToggle={toggle} onLogout={handleLogout} />
      </div>
      <main className={`page-column ${narrow ? styles.narrow : ''}`}>{children}</main>
    </div>
  )
}
