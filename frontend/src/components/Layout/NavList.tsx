import { Link, useLocation } from 'react-router-dom'
import { Icon } from '../common/Icon'
import type { IconName } from '../common/icons'
import styles from './NavList.module.css'

interface Item { to: string; label: string; icon: IconName; match: (path: string) => boolean }

const STAGE: Item = { to: '/', label: 'Bühne', icon: 'stage', match: p => p === '/' || p.startsWith('/song/') }
const LIBRARY: Item = { to: '/library', label: 'Bibliothek', icon: 'library', match: p => p.startsWith('/library') }
const PROFILE: Item = { to: '/profile', label: 'Profil', icon: 'user', match: p => p.startsWith('/profile') }
const ADMIN: Item = { to: '/admin', label: 'Admin', icon: 'backstage', match: p => p.startsWith('/admin') }

/** Main navigation. `variant="bar"` is the header row (≥ 900), `variant="drawer"` the 48 px rows in the drawer. */
export function NavList({ isAdmin, variant, onNavigate }: { isAdmin: boolean; variant: 'bar' | 'drawer'; onNavigate?: () => void }) {
  const { pathname } = useLocation()
  const items = variant === 'bar'
    ? [STAGE, LIBRARY, ...(isAdmin ? [ADMIN] : [])]
    : [STAGE, LIBRARY, PROFILE, ...(isAdmin ? [ADMIN] : [])]
  return (
    <nav className={variant === 'bar' ? styles.bar : styles.drawer} aria-label="Hauptnavigation">
      {items.map(item => {
        const current = item.match(pathname)
        return (
          <Link key={item.to} to={item.to} className={styles.link} aria-current={current ? 'page' : undefined} onClick={onNavigate}>
            <Icon name={item.icon} size={20} /> <span>{item.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
