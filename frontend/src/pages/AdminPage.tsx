import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { admin } from '../services/api'
import { AppShell } from '../components/Layout/AppShell'
import { Icon } from '../components/common/Icon'
import type { IconName } from '../components/common/icons'
import { PageState } from '../components/common/PageState'
import { formatInt } from '../utils/format'
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

const TAB_CONFIG: { key: Tab; label: string; icon: IconName; lead: string }[] = [
  { key: 'users', label: 'Nutzer', icon: 'users', lead: 'Konten freigeben, Rollen und Credits verwalten.' },
  { key: 'keys', label: 'Schlüssel', icon: 'key', lead: 'Mit einem Einladungsschlüssel ist ein neues Konto sofort freigeschaltet.' },
  { key: 'usage', label: 'Nutzung', icon: 'chart', lead: 'Wer hat was gesucht, gesungen und heruntergeladen.' },
  { key: 'songs', label: 'Songs', icon: 'music', lead: 'Alle verarbeiteten Songs. Handlungsbedarf steht oben.' },
  { key: 'status', label: 'Status', icon: 'server', lead: 'Speicher, Deezer-Zugang, Dienste und laufende Verarbeitung.' },
  { key: 'logs', label: 'Logs', icon: 'doc', lead: 'Anwendungsprotokoll. Aktualisiert sich alle 15 Sekunden.' },
  { key: 'errors', label: 'Fehler', icon: 'alert', lead: 'Fehler aus Pipeline und API. Erledigte kannst du aufräumen.' },
]

/** Pending approvals and open errors for the red tab badges. */
function useBackstageCounts(path: string, enabled: boolean) {
  const [counts, setCounts] = useState<{ pending: number; errors: number }>({ pending: 0, errors: 0 })
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void Promise.allSettled([admin.users(), admin.errors(1, undefined, '0')]).then(([users, errors]) => {
      if (cancelled) return
      setCounts(previous => ({
        pending: users.status === 'fulfilled' ? users.value.filter(user => !user.is_approved).length : previous.pending,
        errors: errors.status === 'fulfilled' ? errors.value.total : previous.errors,
      }))
    })
    return () => { cancelled = true }
  }, [path, enabled])
  return counts
}

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
  const counts = useBackstageCounts(location.pathname, checked && authenticated && isAdmin && !songDetailId)
  const current = TAB_CONFIG.find(t => t.key === tab)!

  useEffect(() => {
    if (checked && !authenticated) navigate('/login', { replace: true, state: { from: location.pathname } })
  }, [checked, authenticated, navigate, location.pathname])

  if (!checked || !authenticated) return <PageState title="Konto wird geprüft …" loading />
  if (!isAdmin) return <AppShell narrow><PageState icon="shield" kicker="Backstage" title="Nur für Admins." description="Dein Konto hat keinen Zugang zu diesem Bereich." action={<Link className="btn" to="/">Zur Bühne</Link>} /></AppShell>

  return (
    <AppShell>
      {songDetailId ? (
        <SongDetailView key={songDetailId} trackId={songDetailId} />
      ) : (
        <>
          <header className="page-head">
            <div>
              <span className="kicker">Backstage · {current.label}</span>
              <h1>Admin</h1>
              <p>{current.lead}</p>
            </div>
          </header>

          <nav className={styles.nav} aria-label="Admin-Bereiche">
            {TAB_CONFIG.map(t => {
              const count = t.key === 'users' ? counts.pending : t.key === 'errors' ? counts.errors : 0
              return (
                <Link to={'/admin/' + t.key} aria-current={tab === t.key ? 'page' : undefined} key={t.key} data-testid={`admin-tab-${t.key}`}
                  className={`${styles.navTab} ${tab === t.key ? styles.navTabActive : ''}`}>
                  <Icon name={t.icon} size={18} />
                  <span>{t.label}</span>
                  {count > 0 && <span className={`badge badge--soft ${styles.navCount}`} aria-label={t.key === 'users' ? `${count} Freigaben ausstehend` : `${count} offene Fehler`}>{formatInt(count)}</span>}
                </Link>
              )
            })}
          </nav>

          {tab === 'users' && <UsersTab />}
          {tab === 'keys' && <KeysTab />}
          {tab === 'usage' && <UsageTab />}
          {tab === 'songs' && <SongsTab />}
          {tab === 'status' && <StatusTab />}
          {tab === 'logs' && <LogsTab />}
          {tab === 'errors' && <ErrorsTab />}
        </>
      )}
    </AppShell>
  )
}
