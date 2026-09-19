import { type ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faBars, faMoon, faRightFromBracket, faCoins } from '@fortawesome/free-solid-svg-icons'
import styles from './Header.module.css'

interface Props {
  username: string
  displayName: string
  isAdmin: boolean
  credits: number
  searchBar: ReactNode
  onThemeToggle: () => void
  onLogout: () => void
  onMenuOpen?: () => void
}

export function Header({ username, displayName, isAdmin, credits, searchBar, onThemeToggle, onLogout, onMenuOpen }: Props) {
  const initial = (displayName || username || '?').charAt(0).toUpperCase()

  return (
    <header className={styles.header}>
      <button className={styles.menuBtn} onClick={onMenuOpen} title="Open menu" aria-label="Open library and queue">
        <FontAwesomeIcon icon={faBars} />
      </button>
      {searchBar}

      <nav className={styles.actions} aria-label="Main navigation">
        <NavLink className={styles.textLink} to="/">Player</NavLink>
        <NavLink className={styles.textLink} to="/library">Library</NavLink>
        {isAdmin && <NavLink className={styles.textLink} to="/admin">Admin</NavLink>}
        <button className={styles.navBtn} onClick={onThemeToggle} title="Toggle theme" aria-label="Toggle theme">
          <FontAwesomeIcon icon={faMoon} />
        </button>

        {!isAdmin && (
          <>
            <div className={styles.separator} />
            <div className={styles.creditChip} title="Credits">
              <FontAwesomeIcon icon={faCoins} className={styles.creditIcon} />
              <span className={styles.creditCount}>{credits}</span>
            </div>
          </>
        )}

        <div className={styles.separator} />

        <Link className={styles.avatarCircle} to="/profile" title="Profile" aria-label="Your profile">
          {initial}
        </Link>

        <button className={`${styles.navBtn} ${styles.navBtnDanger}`} onClick={onLogout} title="Logout" aria-label="Sign out">
          <FontAwesomeIcon icon={faRightFromBracket} />
        </button>
      </nav>
    </header>
  )
}
