import { useEffect, useMemo } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faArrowLeft, faUsers, faKey, faChartBar, faMusic, faServer, faExclamationTriangle, faList } from '@fortawesome/free-solid-svg-icons'
import { useAuth } from '../hooks/useAuth'
import { PageState } from '../components/common/PageState'
import { SongDetailView } from './SongDetailView'
import styles from './AdminPage.module.css'
import { UsersTab } from './admin/UsersTab'
import { KeysTab } from './admin/KeysTab'
import { UsageTab } from './admin/UsageTab'
import { SongsTab } from './admin/SongsTab'
import { StatusTab } from './admin/StatusTab'
import { LogsTab } from './admin/LogsTab'
import { ErrorsTab } from './admin/ErrorsTab'

type Tab = 'users' | 'keys' | 'usage' | 'songs' | 'status' | 'logs' | 'errors'

const TAB_CONFIG: { key: Tab; label: string; icon: typeof faUsers }[] = [
  { key: 'users', label: 'Users', icon: faUsers },
  { key: 'keys', label: 'Keys', icon: faKey },
  { key: 'usage', label: 'Usage', icon: faChartBar },
  { key: 'songs', label: 'Songs', icon: faMusic },
  { key: 'status', label: 'Status', icon: faServer },
  { key: 'logs', label: 'Logs', icon: faList },
  { key: 'errors', label: 'Errors', icon: faExclamationTriangle },
]

export function AdminPage() {
  const { checked, authenticated, isAdmin } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  // Detect song detail view: /admin/songs/12345
  const songDetailMatch = location.pathname.match(/^\/admin\/songs\/(\d+)$/)
  const songDetailId = songDetailMatch ? songDetailMatch[1] : null

  // Derive tab from URL
  const tab: Tab = useMemo(() => {
    if (songDetailId) return 'songs'
    const path = location.pathname.replace('/admin', '').replace('/', '')
    if (['users', 'keys', 'usage', 'songs', 'status', 'logs', 'errors'].includes(path)) return path as Tab
    return 'users'
  }, [location.pathname, songDetailId])

  useEffect(() => {
    if (checked && !authenticated) navigate('/login', { replace: true, state: { from: location.pathname } })
  }, [checked, authenticated, navigate, location.pathname])

  if (!checked || !authenticated) return <PageState title="Checking your account" loading />
  if (!isAdmin) return <PageState title="Admin access required" description="Your account does not have permission to view this page." action={<Link to="/">Back to player</Link>} />

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        {!songDetailId && (
          <>
            <div className={styles.header}>
              <h1 className={styles.title}>Admin Panel</h1>
              <Link to="/" className={styles.backBtn}><FontAwesomeIcon icon={faArrowLeft} /> Back to Player</Link>
            </div>

            <nav className={styles.nav} aria-label="Admin sections">
              {TAB_CONFIG.map(t => (
                <Link to={'/admin/' + t.key} aria-current={tab === t.key ? 'page' : undefined} key={t.key} className={`${styles.navTab} ${tab === t.key ? styles.navTabActive : ''}`}>
                  <FontAwesomeIcon icon={t.icon} /> {t.label}
                </Link>
              ))}
            </nav>
          </>
        )}

        {songDetailId ? (
          <SongDetailView key={songDetailId} trackId={songDetailId} />
        ) : (
          <>
            {tab === 'users' && <UsersTab />}
            {tab === 'keys' && <KeysTab />}
            {tab === 'usage' && <UsageTab />}
            {tab === 'songs' && <SongsTab />}
            {tab === 'status' && <StatusTab />}
            {tab === 'logs' && <LogsTab />}
            {tab === 'errors' && <ErrorsTab />}
          </>
        )}
      </div>
    </main>
  )
}
