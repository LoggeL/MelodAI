import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowLeft, faCoins, faMusic, faPlay, faListUl, faHeart,
  faCalendar, faKey, faGear, faCircleInfo, faShieldHalved, faDownload,
  faArrowUpWideShort, faArrowDownWideShort, faFilter,
} from '@fortawesome/free-solid-svg-icons'
import { useAuth } from '../hooks/useAuth'
import { auth } from '../services/api'
import { useToast } from '../hooks/useToast'
import type { ActivityItem } from '../types'
import { PageState } from '../components/common/PageState'
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

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function SkeletonLine({ width = '100%', height = '1em' }: { width?: string; height?: string }) {
  return <div className={styles.skeleton} style={{ width, height }} />
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
    catch (error) { if (requestId === profileRequest.current) setProfileError(errorMessage(error, 'Failed to load profile')) }
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
      if (requestId === activityRequest.current) setActivityError(errorMessage(error, 'Could not load credit activity'))
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
      toast.error('Fill in all password fields')
      return
    }
    if (newPw.length < 8) {
      toast.error('New password must be at least 8 characters')
      return
    }
    if (newPw !== confirmPw) {
      toast.error('Passwords do not match')
      return
    }
    setChanging(true)
    try {
      const result = await auth.changePassword(currentPw, newPw)
      if (result.success) {
        toast.success('Password changed successfully')
        setCurrentPw('')
        setNewPw('')
        setConfirmPw('')
      } else {
        toast.error(result.error || 'Failed to change password')
      }
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to change password'))
    }
    setChanging(false)
  }, [currentPw, newPw, confirmPw, toast, changing])

  if (!checked || !authenticated) return <PageState title="Checking your account" loading />
  if (profileError) return <main className={styles.page}><PageState title="Could not load your profile" description={profileError} action={<button className={styles.primaryBtn} onClick={loadProfile}>Try again</button>} /><Link to="/">Back to player</Link></main>

  const initial = (stats?.display_name || stats?.username || '?').charAt(0).toUpperCase()

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        {/* Back button */}
        <Link to="/" className={styles.backBtn} aria-label="Back to player" title="Back to player">
          <FontAwesomeIcon icon={faArrowLeft} />
        </Link>

        {/* Profile header */}
        <div className={styles.profileHeader}>
          <div className={styles.avatarRow}>
            <Link to="/about" className={styles.sideLink}>
              <FontAwesomeIcon icon={faCircleInfo} className={styles.sideLinkIcon} />
              <span className={styles.sideLinkLabel}>About</span>
            </Link>
            <div className={`${styles.avatarLarge} ${!loaded ? styles.avatarLoading : ''}`}>
              {loaded ? initial : ''}
            </div>
            {stats?.is_admin ? (
              <Link to="/admin" className={styles.sideLink}>
                <FontAwesomeIcon icon={faGear} className={styles.sideLinkIcon} />
                <span className={styles.sideLinkLabel}>Admin</span>
              </Link>
            ) : (
              <div className={styles.sideLinkSpacer} />
            )}
          </div>
          <div className={styles.profileIdentity}>
            {loaded ? (
              <>
                <h1 className={styles.displayName}>
                  {stats?.display_name || stats?.username || 'Unknown'}
                </h1>
                <span className={styles.username}>@{stats?.username}</span>
              </>
            ) : (
              <>
                <SkeletonLine width="180px" height="1.8rem" />
                <SkeletonLine width="100px" height="0.82rem" />
              </>
            )}
            {stats?.is_admin && (
              <span className={styles.adminBadge}>
                <FontAwesomeIcon icon={faShieldHalved} /> Admin
              </span>
            )}
          </div>
          {loaded ? (
            stats && (
              <div className={styles.memberSince}>
                <FontAwesomeIcon icon={faCalendar} />
                Member since {formatDate(stats.member_since)}
              </div>
            )
          ) : (
            <SkeletonLine width="160px" height="0.78rem" />
          )}
        </div>

        {/* Stats grid */}
        <div className={styles.statsGrid}>
          {[
            { icon: faCoins, label: 'Credits', value: stats?.credits, accent: true },
            { icon: faMusic, label: 'Songs Processed', value: stats?.songs_processed },
            { icon: faPlay, label: 'Total Plays', value: stats?.total_plays },
            { icon: faListUl, label: 'Playlists', value: stats?.playlists_count },
            { icon: faHeart, label: 'Favorites', value: stats?.favorites_count },
          ].map((stat, i) => (
            <div
              key={stat.label}
              className={`${styles.statCard} ${stat.accent ? styles.statCardAccent : ''}`}
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <div className={styles.statIcon}>
                <FontAwesomeIcon icon={stat.icon} />
              </div>
              <div className={styles.statValue}>
                {loaded ? (stat.value ?? 0) : <SkeletonLine width="2ch" height="1.6rem" />}
              </div>
              <div className={styles.statLabel}>{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Credit Activity */}
        <div className={styles.card} style={{ animationDelay: '300ms' }}>
          <div className={styles.cardHeader}>
            <FontAwesomeIcon icon={faCoins} className={styles.cardIcon} />
            <h2>Credit Activity</h2>
            {activityTotal > 0 && (
              <span className={styles.activityCount}>{activityTotal}</span>
            )}
          </div>

          {/* Controls row */}
          {(activityTotal > 0 || activityFilter) && (
            <div className={styles.activityControls}>
              <div className={styles.activityFilters}>
                <FontAwesomeIcon icon={faFilter} className={styles.filterIcon} />
                <button
                  className={`${styles.filterPill} ${activityFilter === '' ? styles.filterPillActive : ''}`}
                  aria-pressed={activityFilter === ''} onClick={() => handleFilterChange('')}
                >All</button>
                <button
                  className={`${styles.filterPill} ${activityFilter === 'play' ? styles.filterPillActive : ''}`}
                  aria-pressed={activityFilter === 'play'} onClick={() => handleFilterChange('play')}
                >
                  <FontAwesomeIcon icon={faPlay} /> Play
                </button>
                <button
                  className={`${styles.filterPill} ${activityFilter === 'download' ? styles.filterPillActive : ''}`}
                  aria-pressed={activityFilter === 'download'} onClick={() => handleFilterChange('download')}
                >
                  <FontAwesomeIcon icon={faDownload} /> Process
                </button>
              </div>
              <button className={styles.sortBtn} onClick={handleSortToggle} title={activitySort === 'date_desc' ? 'Newest first' : 'Oldest first'}>
                <FontAwesomeIcon icon={activitySort === 'date_desc' ? faArrowDownWideShort : faArrowUpWideShort} />
                <span className={styles.sortLabel}>{activitySort === 'date_desc' ? 'Newest' : 'Oldest'}</span>
              </button>
            </div>
          )}

          {activityError ? <PageState title="Could not load credit activity" description={activityError} action={<button className={styles.primaryBtn} onClick={() => loadActivity(activityPage, activitySort, activityFilter)}>Try again</button>} /> : activityLoading && activity.length === 0 ? (
            <div className={styles.activitySkeletons}>
              {[...Array(4)].map((_, i) => (
                <div key={i} className={styles.activityItemSkeleton}>
                  <SkeletonLine width="36px" height="36px" />
                  <div className={styles.activitySkeletonText}>
                    <SkeletonLine width="60%" height="0.82rem" />
                    <SkeletonLine width="40%" height="0.72rem" />
                  </div>
                </div>
              ))}
            </div>
          ) : activity.length === 0 ? (
            <div className={styles.activityEmpty}>
              {activityFilter ? 'No matching activity' : 'No activity yet'}
            </div>
          ) : (
            <>
              <div aria-busy={activityLoading} className={`${styles.activityList} ${activityLoading ? styles.activityListLoading : ''}`}>
                {activity.map((item, i) => (
                  <div key={`${item.track_id}-${item.created_at}-${i}`} className={styles.activityItem}>
                    <img className={styles.activityThumb} src={item.img_url || '/logo.svg'} alt="" loading="lazy" />
                    <div className={styles.activityInfo}>
                      <div className={styles.activityTitle}>{item.title}</div>
                      <div className={styles.activityArtist}>{item.artist}</div>
                    </div>
                    <div className={styles.activityMeta}>
                      <span className={`${styles.activityBadge} ${item.action === 'download' ? styles.activityBadgeDownload : styles.activityBadgePlay}`}>
                        <FontAwesomeIcon icon={item.action === 'download' ? faDownload : faPlay} />
                        <span className={styles.badgeLabel}>{item.action === 'download' ? 'Process' : 'Play'}</span>
                      </span>
                      <span className={styles.activityCost}>-{item.cost} cr</span>
                    </div>
                    <div className={styles.activityDate}>
                      {new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </div>
                  </div>
                ))}
              </div>
              {activityTotal > 15 && (
                <div className={styles.activityPagination}>
                  <button
                    className={styles.activityPageBtn}
                    disabled={activityLoading || activityPage <= 1}
                    onClick={() => setActivityPage(p => p - 1)}
                  >Previous</button>
                  <span className={styles.activityPageInfo}>
                    {activityPage} / {Math.ceil(activityTotal / 15)}
                  </span>
                  <button
                    className={styles.activityPageBtn}
                    disabled={activityLoading || activityPage * 15 >= activityTotal}
                    onClick={() => setActivityPage(p => p + 1)}
                  >Next</button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Change password */}
        <div className={styles.card} style={{ animationDelay: '360ms' }}>
          <div className={styles.cardHeader}>
            <FontAwesomeIcon icon={faKey} className={styles.cardIcon} />
            <h2>Change Password</h2>
          </div>
          <form className={styles.formStack} aria-busy={changing} onSubmit={e => { e.preventDefault(); void handleChangePassword() }}>
            <label className={styles.fieldLabel} htmlFor="profile-current-password">Current password</label>
            <input
              id="profile-current-password"
              type="password"
              required
              disabled={changing}
              className={styles.input}
              placeholder="Current password"
              value={currentPw}
              onChange={e => setCurrentPw(e.target.value)}
              autoComplete="current-password"
            />
            <label className={styles.fieldLabel} htmlFor="profile-new-password">New password</label>
            <input
              id="profile-new-password"
              type="password"
              required
              disabled={changing}
              minLength={8}
              className={styles.input}
              placeholder="At least 8 characters"
              value={newPw}
              onChange={e => setNewPw(e.target.value)}
              autoComplete="new-password"
            />
            <label className={styles.fieldLabel} htmlFor="profile-confirm-password">Confirm new password</label>
            <input
              id="profile-confirm-password"
              type="password"
              required
              disabled={changing}
              minLength={8}
              className={styles.input}
              placeholder="Confirm new password"
              value={confirmPw}
              onChange={e => setConfirmPw(e.target.value)}
              autoComplete="new-password"
            />
            <button
              className={styles.primaryBtn}
              type="submit"
              disabled={changing || !currentPw || !newPw || !confirmPw}
            >
              {changing ? 'Changing...' : 'Update Password'}
            </button>
          </form>
        </div>
      </div>
    </main>
  )
}
