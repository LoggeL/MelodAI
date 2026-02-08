import { type ReactNode } from 'react'
import { Link } from 'react-router-dom'
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
      <button className={styles.menuBtn} onClick={onMenuOpen} title="Open menu">
        <FontAwesomeIcon icon={faBars} />
      </button>
      {searchBar}

      <nav className={styles.actions}>
        <button className={styles.navBtn} onClick={onThemeToggle} title="Toggle Theme">
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

        <Link className={styles.avatarCircle} to="/profile" title="Profile">
          {initial}
        </Link>

        <button className={`${styles.navBtn} ${styles.navBtnDanger}`} onClick={onLogout} title="Logout">
          <FontAwesomeIcon icon={faRightFromBracket} />
        </button>
      </nav>
    </header>
  )
}
