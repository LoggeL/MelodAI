import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { auth } from '../services/api'
import { useToast } from '../hooks/useToast'
import type { ActivityItem } from '../types'
import { PageState } from '../components/common/PageState'
import { AppShell } from '../components/Layout/AppShell'
import { Icon } from '../components/common/Icon'
import { Cover } from '../components/common/Cover'
import { CustomSelect } from '../components/common/CustomSelect'
import { formatDate, formatInt, formatMonthYear } from '../utils/format'
import { initials } from '../utils/user'
import { errorMessage } from './account/errors'
import styles from './ProfilePage.module.css'

interface ProfileStats {
  credits: number
  songs_processed: number
  total_plays: number
  playlists_count: number
  favorites_count: number
  member_since: string
  display_name: string
  username: string
  is_admin: boolean
}

interface ActivityRow { item: ActivityItem; count: number; total: number }

/** Consecutive entries for the same song, action and day collapse into one row with „×3“. */
function groupActivity(items: ActivityItem[]): ActivityRow[] {
  const rows: ActivityRow[] = []
  for (const item of items) {
    const last = rows[rows.length - 1]
    if (last && last.item.track_id === item.track_id && last.item.action === item.action
      && new Date(last.item.created_at).toDateString() === new Date(item.created_at).toDateString()) {
      last.count += 1
      last.total += item.cost
    } else rows.push({ item, count: 1, total: item.cost })
  }
  return rows
}

export function ProfilePage() {
  const navigate = useNavigate()
  const { checked, authenticated } = useAuth()
  const toast = useToast()

  const [stats, setStats] = useState<ProfileStats | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [activityError, setActivityError] = useState('')
  const profileRequest = useRef(0)
  const cancelProfileRequest = useCallback(() => { profileRequest.current++ }, [])
  const activityRequest = useRef(0)
  const cancelActivityRequest = useCallback(() => { activityRequest.current++ }, [])

  // Activity state
  const [activity, setActivity] = useState<ActivityItem[]>([])
  const [activityPage, setActivityPage] = useState(1)
  const [activityTotal, setActivityTotal] = useState(0)
  const [activityLoading, setActivityLoading] = useState(true)
  const [activitySort, setActivitySort] = useState<'date_desc' | 'date_asc'>('date_desc')
  const [activityFilter, setActivityFilter] = useState<'' | 'play' | 'download'>('')

  // Password change state
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [changing, setChanging] = useState(false)

  useEffect(() => {
    if (checked && !authenticated) navigate('/login', { replace: true, state: { from: '/profile' } })
  }, [checked, authenticated, navigate])

  const loadProfile = useCallback(async () => {
    const requestId = ++profileRequest.current
    setProfileError('')
    setLoaded(false)
    try { const result = await auth.profileStats(); if (requestId === profileRequest.current) setStats(result) }
    catch (error) { if (requestId === profileRequest.current) setProfileError(errorMessage(error, 'Das Profil konnte nicht geladen werden.')) }
    finally { if (requestId === profileRequest.current) setLoaded(true) }
  }, [])

  useEffect(() => {
    if (checked && authenticated) void loadProfile()
    return cancelProfileRequest
  }, [checked, authenticated, loadProfile, cancelProfileRequest])

  const loadActivity = useCallback(async (page: number, sort: string, filter: string) => {
    const requestId = ++activityRequest.current
    setActivityLoading(true)
    setActivityError('')
    try {
      const data = await auth.activity(page, sort, filter)
      if (requestId !== activityRequest.current) return
      setActivity(data.items)
      setActivityTotal(data.total)
    } catch (error) {
      if (requestId === activityRequest.current) setActivityError(errorMessage(error, 'Der Credit-Verlauf konnte nicht geladen werden.'))
    } finally {
      if (requestId === activityRequest.current) setActivityLoading(false)
    }
  }, [])

  useEffect(() => {
    if (checked && authenticated) void loadActivity(activityPage, activitySort, activityFilter)
    return cancelActivityRequest
  }, [checked, authenticated, activityPage, activitySort, activityFilter, loadActivity, cancelActivityRequest])

  const handleSortToggle = useCallback(() => {
    setActivitySort(s => s === 'date_desc' ? 'date_asc' : 'date_desc')
    setActivityPage(1)
  }, [])

  const handleFilterChange = useCallback((filter: '' | 'play' | 'download') => {
    setActivityFilter(f => f === filter ? '' : filter)
    setActivityPage(1)
  }, [])

  const handleChangePassword = useCallback(async () => {
    if (changing) return
    if (!currentPw || !newPw) {
      toast.error('Bitte füll alle Passwortfelder aus.')
      return
    }
    if (newPw.length < 8) {
      toast.error('Das neue Passwort braucht mindestens 8 Zeichen.')
      return
    }
    if (newPw !== confirmPw) {
      toast.error('Die Passwörter stimmen nicht überein.')
      return
    }
    setChanging(true)
    try {
      const result = await auth.changePassword(currentPw, newPw)
      if (result.success) {
        toast.success('Passwort gespeichert.')
        setCurrentPw('')
        setNewPw('')
        setConfirmPw('')
      } else {
        toast.error(result.error ? errorMessage(new Error(result.error), 'Das Passwort konnte nicht geändert werden.') : 'Das Passwort konnte nicht geändert werden.')
      }
    } catch (error) {
      toast.error(errorMessage(error, 'Das Passwort konnte nicht geändert werden.'))
    }
    setChanging(false)
  }, [currentPw, newPw, confirmPw, toast, changing])

  if (!checked || !authenticated) return <PageState title="Konto wird geprüft …" loading />
  if (profileError) return <AppShell><PageState error title="Dein Profil konnte nicht geladen werden." description={profileError} action={<><button type="button" className="btn" onClick={loadProfile}><Icon name="redo" /> Erneut versuchen</button><Link className="btn btn--ghost" to="/">Zur Bühne</Link></>} /></AppShell>

  const name = stats?.display_name || stats?.username || ''
  const rows = groupActivity(activity)
  const pages = Math.max(1, Math.ceil(activityTotal / 15))
  const statCells = [
    { label: 'Songs gesungen', value: stats?.total_plays },
    { label: 'Songs verarbeitet', value: stats?.songs_processed },
    { label: 'Favoriten', value: stats?.favorites_count },
    { label: 'Playlists', value: stats?.playlists_count },
    { label: 'Credits übrig', value: stats?.credits },
  ]

  return (
    <AppShell narrow>
      <header className={`page-head ${styles.head}`}>
        <div className={`${styles.avatar} ${!loaded ? 'skeleton' : ''}`} aria-hidden="true">{loaded ? initials(stats?.display_name || '', stats?.username || '') : ''}</div>
        <div className={styles.identity}>
          {loaded && stats ? <>
            <span className="kicker">Dabei seit {formatMonthYear(stats.member_since)}</span>
            <h1>{name}</h1>
            <p className={styles.handle}>@{stats.username}{stats.is_admin && <span className="chip chip--work"><Icon name="shield" size={14} /> Admin</span>}</p>
          </> : <>
            <span className={`skeleton ${styles.skelKicker}`} />
            <span className={`skeleton ${styles.skelName}`} />
          </>}
        </div>
        <div className="page-head__end">
          {stats && !stats.is_admin && <span className={styles.credits}><span className={styles.creditDot} aria-hidden="true" />{formatInt(stats.credits)}<span className={styles.creditLabel}> Credits</span></span>}
          {stats?.is_admin && <Link className="btn" to="/admin"><Icon name="backstage" /> Backstage</Link>}
          <Link className="btn btn--ghost" to="/about"><Icon name="info" /> Über MelodAI</Link>
        </div>
      </header>

      <section className="stats" aria-label="Deine Zahlen">
        {statCells.map(cell => (
          <div key={cell.label} className="stat">
            <b>{loaded ? formatInt(cell.value ?? 0) : <span className={`skeleton ${styles.skelNum}`} />}</b>
            <span className="kicker">{cell.label}</span>
          </div>
        ))}
      </section>

      <section className={styles.section} aria-labelledby="credit-history">
        <div className={styles.sectionHead}>
          <h2 id="credit-history">Credit-Verlauf {activityTotal > 0 && <span className={styles.count}>{formatInt(activityTotal)}</span>}</h2>
          <div className={styles.sectionTools}>
            <div className="seg" role="group" aria-label="Filter">
              <button type="button" aria-pressed={activityFilter === ''} onClick={() => handleFilterChange('')}>Alle</button>
              <button type="button" aria-pressed={activityFilter === 'play'} onClick={() => handleFilterChange('play')}>Wiedergabe</button>
              <button type="button" aria-pressed={activityFilter === 'download'} onClick={() => handleFilterChange('download')}>Verarbeitung</button>
            </div>
            <CustomSelect className="input" aria-label="Sortierung" value={activitySort}
              onChange={value => { if (value !== activitySort) handleSortToggle() }}
              options={[{ value: 'date_desc', label: 'Neueste zuerst' }, { value: 'date_asc', label: 'Älteste zuerst' }]} />
          </div>
        </div>

        {activityError ? <PageState error title="Der Credit-Verlauf konnte nicht geladen werden." description={activityError} action={<button type="button" className="btn" onClick={() => loadActivity(activityPage, activitySort, activityFilter)}><Icon name="redo" /> Erneut versuchen</button>} />
          : <div className="table-wrap">
            <table className="table table--cards" aria-busy={activityLoading}>
              <thead><tr><th scope="col">Datum</th><th scope="col">Song</th><th scope="col">Aktion</th><th scope="col" className="num">Credits</th></tr></thead>
              <tbody className={activityLoading && activity.length > 0 ? styles.dim : undefined}>
                {activityLoading && activity.length === 0 ? [0, 1, 2, 3].map(i => (
                  <tr key={i} aria-hidden="true"><td colSpan={4}><span className={`skeleton ${styles.skelRow}`} /></td></tr>
                )) : rows.length === 0 ? (
                  <tr className="empty-row"><td colSpan={4}>{activityFilter ? 'Keine passenden Einträge.' : 'Noch keine Einträge. Sing deinen ersten Song!'}</td></tr>
                ) : rows.map(({ item, count, total }, i) => (
                  <tr key={`${item.track_id}-${item.created_at}-${i}`}>
                    <td className={`num ${styles.dateCell}`} data-label="Datum">{formatDate(item.created_at)}</td>
                    <td className="cell-main" data-label="">
                      <span className={styles.song}>
                        <Cover className={styles.thumb} src={item.img_url} />
                        <span className={styles.songText}><span className={styles.songTitle}>{item.title}</span><span className={styles.songArtist}>{item.artist}</span></span>
                      </span>
                    </td>
                    <td data-label="Aktion">
                      <span className={`chip ${item.action === 'download' ? 'chip--work' : ''}`}>{item.action === 'download' ? 'Verarbeitung' : 'Wiedergabe'}{count > 1 && ` ×${count}`}</span>
                    </td>
                    <td className="num cell-acts" data-label="Credits">−{total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
        {activityTotal > 15 && (
          <nav className={styles.pagination} aria-label="Seiten">
            <button type="button" className="btn btn--sm" disabled={activityLoading || activityPage <= 1} onClick={() => setActivityPage(p => p - 1)}><Icon name="chevron-left" size={16} /> Zurück</button>
            <span className="mono">{activityPage} / {pages}</span>
            <button type="button" className="btn btn--sm" disabled={activityLoading || activityPage >= pages} onClick={() => setActivityPage(p => p + 1)}>Weiter <Icon name="chevron-right" size={16} /></button>
          </nav>
        )}
      </section>

      <section className={`panel ${styles.password}`} aria-labelledby="change-password">
        <h2 id="change-password">Passwort ändern</h2>
        <form className={styles.form} aria-busy={changing} onSubmit={e => { e.preventDefault(); void handleChangePassword() }}>
          <div className="field">
            <label htmlFor="profile-current-password">Aktuelles Passwort</label>
            <input id="profile-current-password" type="password" required disabled={changing} className="input"
              value={currentPw} onChange={e => setCurrentPw(e.target.value)} autoComplete="current-password" />
          </div>
          <div className="field">
            <label htmlFor="profile-new-password">Neues Passwort</label>
            <input id="profile-new-password" type="password" required disabled={changing} minLength={8} className="input"
              aria-describedby="profile-new-password-help" value={newPw} onChange={e => setNewPw(e.target.value)} autoComplete="new-password" />
            <span id="profile-new-password-help" className="field-help">Mindestens 8 Zeichen.</span>
          </div>
          <div className="field">
            <label htmlFor="profile-confirm-password">Neues Passwort bestätigen</label>
            <input id="profile-confirm-password" type="password" required disabled={changing} minLength={8} className="input"
              value={confirmPw} onChange={e => setConfirmPw(e.target.value)} autoComplete="new-password" />
          </div>
          <button className="btn btn--primary" type="submit" disabled={changing || !currentPw || !newPw || !confirmPw}>
            {changing ? 'Wird gespeichert …' : 'Passwort speichern'}
          </button>
        </form>
      </section>
    </AppShell>
  )
}
