import { useCallback, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../common/Icon'
import { Logo } from '../common/Logo'
import { NavList } from './NavList'
import { Drawer } from './Drawer'
import { initials } from '../../utils/user'
import styles from './Header.module.css'

interface Props {
  username: string
  displayName: string
  isAdmin: boolean
  credits: number
  /** Search field (player only). */
  searchBar?: ReactNode
  theme?: 'light' | 'dark'
  onThemeToggle: () => void
  onLogout: () => void
  /** Player: opens the Setlist drawer below 900 px. Other pages get a navigation drawer instead. */
  onMenuOpen?: () => void
  setlistCount?: number
}

export function ThemeButton({ theme, onToggle, testId, withLabel }: { theme?: 'light' | 'dark'; onToggle: () => void; testId?: string; withLabel?: boolean }) {
  const label = theme === 'light' ? 'Nachtmodus' : 'Tageslicht'
  return (
    <button type="button" className={withLabel ? 'btn btn--ghost' : 'iconbtn'} onClick={onToggle} data-testid={testId}
      title="Farbschema wechseln" aria-label={`Farbschema wechseln: ${label}`}>
      <Icon name={theme === 'light' ? 'moon' : 'sun'} />{withLabel && ` ${label}`}
    </button>
  )
}

export function Header({ username, displayName, isAdmin, credits, searchBar, theme, onThemeToggle, onLogout, onMenuOpen, setlistCount = 0 }: Props) {
  const [navOpen, setNavOpen] = useState(false)
  const closeNav = useCallback(() => setNavOpen(false), [])
  return (
    <header className={styles.header}>
      <Link to="/" className={styles.brand} aria-label="MelodAI – zur Bühne"><Logo hideWordmarkOnTiny /></Link>
      {searchBar && <div className={styles.search}>{searchBar}</div>}
      <div className={styles.navWrap}><NavList isAdmin={isAdmin} variant="bar" /></div>
      <div className={styles.end}>
        {!isAdmin && (
          <span className={styles.credits} title="Credits">
            <span className={styles.dot} aria-hidden="true" />
            <span className={styles.creditCount}>{credits}</span>
            <span className="sr-only"> Credits</span>
          </span>
        )}
        <span className={styles.desktopOnly}><ThemeButton theme={theme} onToggle={onThemeToggle} testId="theme-toggle" /></span>
        <Link className={styles.avatarCircle} to="/profile" title="Profil" aria-label={`Profil von ${displayName || username}`}>
          {initials(displayName, username)}
        </Link>
        <span className={styles.desktopOnly}>
          <button type="button" className="iconbtn" onClick={onLogout} data-testid="logout" title="Abmelden" aria-label="Abmelden">
            <Icon name="logout" />
          </button>
        </span>
        {onMenuOpen ? (
          <button type="button" className={`iconbtn ${styles.menuBtn}`} onClick={onMenuOpen} aria-haspopup="dialog"
            aria-label={`Setlist und Menü öffnen, ${setlistCount} ${setlistCount === 1 ? 'Song' : 'Songs'}`} title="Setlist">
            <Icon name="queue" />
            {setlistCount > 0 && <span className={styles.badge} aria-hidden="true">{setlistCount > 99 ? '99+' : setlistCount}</span>}
          </button>
        ) : (
          <button type="button" className={`iconbtn ${styles.menuBtn}`} onClick={() => setNavOpen(true)} aria-haspopup="dialog" aria-label="Menü öffnen" title="Menü">
            <Icon name="menu" />
          </button>
        )}
      </div>
      {!onMenuOpen && (
        <Drawer open={navOpen} title="Menü" onClose={closeNav}
          footer={<>
            <ThemeButton theme={theme} onToggle={onThemeToggle} withLabel />
            <button type="button" className="btn btn--ghost" onClick={() => { closeNav(); onLogout() }}><Icon name="logout" /> Abmelden</button>
          </>}>
          <NavList isAdmin={isAdmin} variant="drawer" onNavigate={closeNav} />
        </Drawer>
      )}
    </header>
  )
}
