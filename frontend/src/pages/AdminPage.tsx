import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowLeft, faUsers, faKey, faChartBar, faMusic, faServer,
  faPlay, faDownload, faMagnifyingGlass, faCrown, faHardDrive, faDatabase,
  faArrowUp, faArrowDown, faTrash, faCheck, faShield, faUserMinus, faRotateRight, faCoins,
  faExclamationTriangle, faList
} from '@fortawesome/free-solid-svg-icons'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../hooks/useToast'
import { admin } from '../services/api'
import type { User, InviteKey, AdminStats, UsageLog, AdminSong, HealthCheck, StorageStats, UnfinishedTrack, ProcessingStatus, ErrorLogEntry, AppLogEntry } from '../types'
import { CustomSelect } from '../components/common/CustomSelect'
import { SongDetailView } from './SongDetailView'
import styles from './AdminPage.module.css'

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
    if (checked && (!authenticated || !isAdmin)) navigate('/login')
  }, [checked, authenticated, isAdmin, navigate])

  if (!checked || !authenticated || !isAdmin) return null

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        {!songDetailId && (
          <>
            <div className={styles.header}>
              <h1 className={styles.title}>Admin Panel</h1>
              <Link to="/" className={styles.backBtn}><FontAwesomeIcon icon={faArrowLeft} /> Back to Player</Link>
            </div>

            <div className={styles.nav}>
              {TAB_CONFIG.map(t => (
                <button key={t.key} className={`${styles.navTab} ${tab === t.key ? styles.navTabActive : ''}`}
                  onClick={() => navigate('/admin/' + t.key, { replace: true })}>
                  <FontAwesomeIcon icon={t.icon} /> {t.label}
                </button>
              ))}
            </div>
          </>
        )}

        {songDetailId ? (
          <SongDetailView trackId={songDetailId} />
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
    </div>
  )
}

const PAGE_SIZE = 20

type SortDir = 'asc' | 'desc'

// ─── Users Tab ───
type UserSortKey = 'username' | 'is_approved' | 'is_admin' | 'created_at' | 'activity_count' | 'credits'

function UsersTab() {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [userPage, setUserPage] = useState(1)
  const [sortKey, setSortKey] = useState<UserSortKey>('created_at')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [userFilter, setUserFilter] = useState('')
  const toast = useToast()

  const load = useCallback(async () => {
    try {
      setUsers(await admin.users())
    } catch (err) {
      console.error('Failed to load users:', err)
      toast.error('Failed to load users')
    }
    setLoading(false)
  }, [toast])

  useEffect(() => { load() }, [load])

  const approve = async (id: number) => { await admin.approveUser(id); toast.success('User approved'); load() }
  const promote = async (id: number) => { await admin.promoteUser(id); toast.success('User promoted'); load() }
  const demote = async (id: number) => { await admin.demoteUser(id); toast.success('User demoted'); load() }
  const deleteUser = async (id: number) => { await admin.deleteUser(id); toast.success('User deleted'); load() }

  const handleSort = (key: UserSortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const pendingUsers = useMemo(() => users.filter(u => !u.is_approved), [users])
  const approvedUsers = useMemo(() => users.filter(u => u.is_approved), [users])

  const sortedApproved = useMemo(() => {
    let list = approvedUsers
    if (userFilter) {
      const q = userFilter.toLowerCase()
      list = list.filter(u => u.username.toLowerCase().includes(q))
    }
    const sorted = [...list].sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'username': cmp = a.username.localeCompare(b.username); break
        case 'is_approved': cmp = Number(a.is_approved) - Number(b.is_approved); break
        case 'is_admin': cmp = Number(a.is_admin) - Number(b.is_admin); break
        case 'created_at': cmp = (a.created_at || '').localeCompare(b.created_at || ''); break
        case 'activity_count': cmp = (a.activity_count || 0) - (b.activity_count || 0); break
        case 'credits': cmp = (a.credits || 0) - (b.credits || 0); break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return sorted
  }, [approvedUsers, sortKey, sortDir, userFilter])

  const pagedUsers = sortedApproved.slice((userPage - 1) * PAGE_SIZE, userPage * PAGE_SIZE)
  const userPages = Math.ceil(sortedApproved.length / PAGE_SIZE) || 1

  const SortIndicator = ({ column }: { column: UserSortKey }) => {
    if (sortKey !== column) return null
    return <FontAwesomeIcon icon={sortDir === 'asc' ? faArrowUp : faArrowDown} className={styles.sortIcon} />
  }

  if (loading) return (
    <div className={styles.section}>
      <div className={styles.skeletonHeader}><div className={styles.skeleton} style={{ width: 140, height: 20 }} /></div>
      <table className={styles.table}>
        <thead><tr>
          <th>Username</th><th>Role</th><th>Created</th><th>Activity</th><th>Credits</th><th>Actions</th>
        </tr></thead>
        <tbody>
          {Array.from({ length: 6 }).map((_, i) => (
            <tr key={i}>
              <td><div className={styles.skeleton} style={{ width: 100 + (i % 3) * 20 }} /></td>
              <td><div className={styles.skeleton} style={{ width: 50 }} /></td>
              <td><div className={styles.skeleton} style={{ width: 80 }} /></td>
              <td><div className={styles.skeleton} style={{ width: 30 }} /></td>
              <td><div className={styles.skeleton} style={{ width: 40 }} /></td>
              <td><div className={styles.skeleton} style={{ width: 60 }} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  return (
    <>
      {/* Pending users alert section */}
      {pendingUsers.length > 0 && (
        <div className={styles.pendingSection}>
          <h3 className={styles.pendingTitle}>
            <span className={styles.pendingBadge}>{pendingUsers.length}</span>
            Pending Approval
          </h3>
          <div className={styles.pendingList}>
            {pendingUsers.map(u => (
              <div key={u.id} className={styles.pendingCard}>
                <div className={styles.pendingInfo}>
                  <span className={styles.pendingUsername}>{u.username}</span>
                  <span className={styles.pendingDate}>Registered {u.created_at?.split('T')[0]}</span>
                </div>
                <div className={styles.pendingActions}>
                  <button className={styles.primaryBtn} onClick={() => approve(u.id)} style={{ padding: '6px 16px', fontSize: '0.8rem' }}>
                    <FontAwesomeIcon icon={faCheck} /> Approve
                  </button>
                  <button className={`${styles.actionBtn} ${styles.dangerBtn}`} onClick={() => deleteUser(u.id)} title="Reject">
                    <FontAwesomeIcon icon={faTrash} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Approved users table */}
      <div className={styles.section}>
        <h3>Users ({approvedUsers.length})</h3>
        <div className={styles.filters}>
          <input className={styles.filterInput} placeholder="Search users..." value={userFilter}
            onChange={e => { setUserFilter(e.target.value); setUserPage(1) }} />
        </div>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.sortableTh} onClick={() => handleSort('username')}>Username <SortIndicator column="username" /></th>
              <th className={styles.sortableTh} onClick={() => handleSort('is_admin')}>Role <SortIndicator column="is_admin" /></th>
              <th className={styles.sortableTh} onClick={() => handleSort('created_at')}>Created <SortIndicator column="created_at" /></th>
              <th className={styles.sortableTh} onClick={() => handleSort('activity_count')}>Activity <SortIndicator column="activity_count" /></th>
              <th className={styles.sortableTh} onClick={() => handleSort('credits')}>Credits <SortIndicator column="credits" /></th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {pagedUsers.map(u => (
              <tr key={u.id}>
                <td>{u.username}</td>
                <td>
                  <span className={`${styles.tag} ${u.is_admin ? styles.tagPrimary : styles.tagSuccess}`}>
                    {u.is_admin ? 'Admin' : 'User'}
                  </span>
                </td>
                <td>{u.created_at?.split('T')[0]}</td>
                <td>{u.activity_count}</td>
                <td>
                  {u.credits}
                  <button className={styles.actionBtn} onClick={async () => {
                    const val = window.prompt('Set credits for ' + u.username, String(u.credits))
                    if (val === null) return
                    const n = parseInt(val, 10)
                    if (isNaN(n)) return
                    await admin.setCredits(u.id, n)
                    load()
                  }} title="Set credits" style={{ marginLeft: 4 }}><FontAwesomeIcon icon={faCoins} /></button>
                </td>
                <td>
                  {!u.is_admin && <button className={styles.actionBtn} onClick={() => promote(u.id)} title="Promote"><FontAwesomeIcon icon={faShield} /></button>}
                  {u.is_admin && <button className={styles.actionBtn} onClick={() => demote(u.id)} title="Demote"><FontAwesomeIcon icon={faUserMinus} /></button>}
                  <button className={`${styles.actionBtn} ${styles.dangerBtn}`} onClick={() => deleteUser(u.id)} title="Delete"><FontAwesomeIcon icon={faTrash} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {userPages > 1 && (
          <div className={styles.pagination}>
            <button className={styles.actionBtn} disabled={userPage <= 1} onClick={() => setUserPage(p => p - 1)}>Prev</button>
            <span className={styles.pageInfo}>Page {userPage} of {userPages}</span>
            <button className={styles.actionBtn} disabled={userPage >= userPages} onClick={() => setUserPage(p => p + 1)}>Next</button>
          </div>
        )}
      </div>
    </>
  )
}

// ─── Keys Tab ───
function KeysTab() {
  const [keys, setKeys] = useState<InviteKey[]>([])
  const [loading, setLoading] = useState(true)
  const [keyPage, setKeyPage] = useState(1)
  const toast = useToast()

  const load = useCallback(async () => {
    try {
      setKeys(await admin.inviteKeys())
    } catch {
      toast.error('Failed to load invite keys')
    }
    setLoading(false)
  }, [toast])

  useEffect(() => { load() }, [load])

  const genKey = async () => { const d = await admin.generateInviteKey(); toast.success('Key: ' + d.key); load() }

  const cleanUpUsed = async () => {
    try {
      const d = await admin.deleteUsedInviteKeys()
      toast.success(`Removed ${d.deleted} used key${d.deleted !== 1 ? 's' : ''}`)
      load()
    } catch {
      toast.error('Failed to clean up keys')
    }
  }

  const usedCount = keys.filter(k => k.used_by).length
  const pagedKeys = keys.slice((keyPage - 1) * PAGE_SIZE, keyPage * PAGE_SIZE)
  const keyPages = Math.ceil(keys.length / PAGE_SIZE) || 1

  if (loading) return (
    <div className={styles.section}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-md)' }}>
        <div className={styles.skeleton} style={{ width: 130, height: 20 }} />
        <div className={styles.skeleton} style={{ width: 150, height: 38, borderRadius: 50 }} />
      </div>
      <table className={styles.table}>
        <thead><tr><th>Key</th><th>Created</th><th>Used By</th></tr></thead>
        <tbody>
          {Array.from({ length: 4 }).map((_, i) => (
            <tr key={i}>
              <td><div className={styles.skeleton} style={{ width: 180 }} /></td>
              <td><div className={styles.skeleton} style={{ width: 80 }} /></td>
              <td><div className={styles.skeleton} style={{ width: 70 }} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  return (
    <div className={styles.section}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-md)' }}>
        <h3>Invite Keys ({keys.length})</h3>
        <div style={{ display: 'flex', gap: '8px' }}>
          {usedCount > 0 && (
            <button className={`${styles.actionBtn} ${styles.dangerBtn}`} onClick={cleanUpUsed}>
              Clean Up Used ({usedCount})
            </button>
          )}
          <button className={styles.primaryBtn} onClick={genKey}>Generate Invite Key</button>
        </div>
      </div>
      <table className={styles.table}>
        <thead><tr><th>Key</th><th>Created</th><th>Used By</th></tr></thead>
        <tbody>
          {pagedKeys.map(k => (
            <tr key={k.id}>
              <td><span className={styles.keyDisplay}>{k.key}</span></td>
              <td>{k.created_at?.split('T')[0]}</td>
              <td>{k.used_by || <span style={{ color: 'var(--text-muted)' }}>Unused</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {keyPages > 1 && (
        <div className={styles.pagination}>
          <button className={styles.actionBtn} disabled={keyPage <= 1} onClick={() => setKeyPage(p => p - 1)}>Prev</button>
          <span className={styles.pageInfo}>Page {keyPage} of {keyPages}</span>
          <button className={styles.actionBtn} disabled={keyPage >= keyPages} onClick={() => setKeyPage(p => p + 1)}>Next</button>
        </div>
      )}
    </div>
  )
}

// ─── Usage Tab ───
function UsageTab() {
  const [statsData, setStats] = useState<AdminStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [logs, setLogs] = useState<UsageLog[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [filterUser, setFilterUser] = useState('')
  const [filterAction, setFilterAction] = useState('')
  const [logSortKey, setLogSortKey] = useState<'username' | 'action' | 'detail' | 'created_at'>('created_at')
  const [logSortDir, setLogSortDir] = useState<SortDir>('desc')
  const toast = useToast()

  const load = useCallback(async () => {
    try {
      const [s, l] = await Promise.all([
        admin.stats(),
        admin.usageLogs(page, filterUser || undefined, filterAction || undefined)
      ])
      setStats(s)
      setLogs(l.logs)
      setTotal(l.total)
    } catch {
      toast.error('Failed to load usage data')
    }
    setLoading(false)
  }, [page, filterUser, filterAction, toast])

  useEffect(() => { load() }, [load])

  const handleLogSort = (key: typeof logSortKey) => {
    if (logSortKey === key) setLogSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setLogSortKey(key); setLogSortDir('asc') }
  }

  const sortedLogs = useMemo(() => {
    return [...logs].sort((a, b) => {
      let cmp = 0
      switch (logSortKey) {
        case 'username': cmp = a.username.localeCompare(b.username); break
        case 'action': cmp = a.action.localeCompare(b.action); break
        case 'detail': cmp = (a.detail || '').localeCompare(b.detail || ''); break
        case 'created_at': cmp = (a.created_at || '').localeCompare(b.created_at || ''); break
      }
      return logSortDir === 'asc' ? cmp : -cmp
    })
  }, [logs, logSortKey, logSortDir])

  const LogSortIndicator = ({ column }: { column: typeof logSortKey }) => {
    if (logSortKey !== column) return null
    return <FontAwesomeIcon icon={logSortDir === 'asc' ? faArrowUp : faArrowDown} className={styles.sortIcon} />
  }

  if (loading) return (
    <>
      <div className={styles.stats}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={styles.statCard}>
            <div className={styles.skeleton} style={{ width: 20, height: 20, margin: '0 auto 8px' }} />
            <div className={styles.skeleton} style={{ width: 50, height: 28, margin: '0 auto 8px' }} />
            <div className={styles.skeleton} style={{ width: 60, height: 12, margin: '0 auto' }} />
          </div>
        ))}
      </div>
      <div className={styles.section}>
        <table className={styles.table}>
          <thead><tr><th>User</th><th>Action</th><th>Detail</th><th>Time</th></tr></thead>
          <tbody>
            {Array.from({ length: 6 }).map((_, i) => (
              <tr key={i}>
                <td><div className={styles.skeleton} style={{ width: 80 }} /></td>
                <td><div className={styles.skeleton} style={{ width: 55 }} /></td>
                <td><div className={styles.skeleton} style={{ width: 120 + (i % 3) * 20 }} /></td>
                <td><div className={styles.skeleton} style={{ width: 100 }} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )

  return (
    <>
      {statsData && (
        <div className={styles.stats}>
          <div className={`${styles.statCard} ${styles.statCardUsers}`}>
            <div className={styles.statIcon} style={{ color: 'var(--primary)' }}><FontAwesomeIcon icon={faUsers} /></div>
            <div className={styles.statValue}>{statsData.total_users}</div>
            <div className={styles.statLabel}>Users</div>
          </div>
          <div className={`${styles.statCard} ${styles.statCardPlays}`}>
            <div className={styles.statIcon} style={{ color: 'var(--success)' }}><FontAwesomeIcon icon={faPlay} /></div>
            <div className={styles.statValue}>{statsData.total_plays}</div>
            <div className={styles.statLabel}>Plays</div>
          </div>
          <div className={`${styles.statCard} ${styles.statCardDownloads}`}>
            <div className={styles.statIcon} style={{ color: '#6366f1' }}><FontAwesomeIcon icon={faDownload} /></div>
            <div className={styles.statValue}>{statsData.total_downloads}</div>
            <div className={styles.statLabel}>Downloads</div>
          </div>
          <div className={`${styles.statCard} ${styles.statCardSearches}`}>
            <div className={styles.statIcon} style={{ color: 'var(--warning)' }}><FontAwesomeIcon icon={faMagnifyingGlass} /></div>
            <div className={styles.statValue}>{statsData.total_searches}</div>
            <div className={styles.statLabel}>Searches</div>
          </div>
          {statsData.most_active_user && (
            <div className={`${styles.statCard} ${styles.statCardActive}`}>
              <div className={styles.statIcon} style={{ color: '#f59e0b' }}><FontAwesomeIcon icon={faCrown} /></div>
              <div className={styles.statValue}>{statsData.most_active_count}</div>
              <div className={styles.statLabel}>{statsData.most_active_user}</div>
            </div>
          )}
        </div>
      )}

      <div className={styles.section}>
        <div className={styles.filters}>
          <input className={styles.filterInput} placeholder="Filter by username..." value={filterUser}
            onChange={e => { setFilterUser(e.target.value); setPage(1) }} />
          <CustomSelect
            value={filterAction}
            onChange={v => { setFilterAction(v); setPage(1) }}
            options={[
              { value: '', label: 'All actions' },
              { value: 'search', label: 'Search' },
              { value: 'play', label: 'Play' },
              { value: 'download', label: 'Download' },
            ]}
          />
        </div>

        <table className={styles.table}>
          <thead><tr>
            <th className={styles.sortableTh} onClick={() => handleLogSort('username')}>User <LogSortIndicator column="username" /></th>
            <th className={styles.sortableTh} onClick={() => handleLogSort('action')}>Action <LogSortIndicator column="action" /></th>
            <th className={styles.sortableTh} onClick={() => handleLogSort('detail')}>Detail <LogSortIndicator column="detail" /></th>
            <th className={styles.sortableTh} onClick={() => handleLogSort('created_at')}>Time <LogSortIndicator column="created_at" /></th>
          </tr></thead>
          <tbody>
            {sortedLogs.map(l => (
              <tr key={l.id}>
                <td>{l.username}</td>
                <td><span className={`${styles.tag} ${styles.tagPrimary}`}>{l.action}</span></td>
                <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.detail}</td>
                <td>{l.created_at?.replace('T', ' ').slice(0, 16)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className={styles.pagination}>
          <button className={styles.actionBtn} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</button>
          <span className={styles.pageInfo}>Page {page} of {Math.ceil(total / 50) || 1}</span>
          <button className={styles.actionBtn} disabled={page * 50 >= total} onClick={() => setPage(p => p + 1)}>Next</button>
        </div>
      </div>
    </>
  )
}

// ─── Songs Tab ───
function SongsTab() {
  const [songs, setSongs] = useState<AdminSong[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [page, setPage] = useState(1)
  const toast = useToast()
  const navigate = useNavigate()

  const load = useCallback(async () => {
    try {
      setSongs(await admin.songs())
    } catch {
      toast.error('Failed to load songs')
    }
    setLoading(false)
  }, [toast])
  useEffect(() => { load() }, [load])

  const filtered = songs.filter(s => {
    if (!filter) return true
    const q = filter.toLowerCase()
    return s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q)
  })

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE) || 1
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const handleDelete = async (id: string) => {
    await admin.deleteSong(id)
    toast.success('Song deleted')
    load()
  }

  const handleReprocess = async (id: string) => {
    await admin.reprocessSong(id)
    toast.success('Reprocessing started')
  }

  const formatSize = (bytes: number) => {
    if (!bytes) return '-'
    if (bytes > 1048576) return (bytes / 1048576).toFixed(1) + ' MB'
    if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KB'
    return bytes + ' B'
  }

  if (loading) return (
    <>
      <div className={styles.filters}>
        <div className={styles.skeleton} style={{ width: 200, height: 34 }} />
      </div>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className={styles.songItem}>
          <div className={`${styles.skeleton} ${styles.skeletonThumb}`} />
          <div className={styles.songInfo}>
            <div className={styles.skeleton} style={{ width: 120 + (i % 3) * 30, height: 14, marginBottom: 4 }} />
            <div className={styles.skeleton} style={{ width: 80 + (i % 2) * 20, height: 12 }} />
          </div>
          <div className={styles.skeleton} style={{ width: 70, height: 20 }} />
          <div className={styles.skeleton} style={{ width: 50, height: 14 }} />
          <div className={styles.skeleton} style={{ width: 28, height: 24 }} />
        </div>
      ))}
    </>
  )

  return (
    <>
      <div className={styles.filters} style={{ alignItems: 'center' }}>
        <input className={styles.filterInput} placeholder="Filter songs..." value={filter}
          onChange={e => { setFilter(e.target.value); setPage(1) }} />
        <span className={styles.pageInfo} style={{ margin: 0 }}>{filtered.length} song{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {paged.map(s => (
        <div key={s.id} className={styles.songItem} style={{ cursor: 'pointer' }}
          onClick={() => navigate('/admin/songs/' + s.id)}>
          <img className={styles.songThumb} src={s.img_url || '/logo.svg'} alt="" loading="lazy" />
          <div className={styles.songInfo}>
            <div className={styles.songTitle}>{s.title}</div>
            <div className={styles.songArtist}>{s.artist}</div>
          </div>
          <span className={`${styles.tag} ${s.complete ? styles.tagSuccess : styles.tagWarning}`}>
            {s.complete ? 'Complete' : 'Incomplete'}
          </span>
          {s.avg_confidence != null && (
            <span style={{
              fontSize: '0.65rem',
              fontWeight: 700,
              fontFamily: 'var(--font-heading)',
              color: s.avg_confidence < 0.55 ? 'var(--danger)' : s.avg_confidence < 0.65 ? 'var(--warning)' : 'var(--success)',
              minWidth: 36,
              textAlign: 'center',
            }}>
              {(s.avg_confidence * 100).toFixed(0)}%
            </span>
          )}
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', minWidth: 60 }}>
            {formatSize(Object.values(s.file_sizes).reduce((a, b) => a + b, 0))}
          </span>
          <button className={styles.actionBtn} onClick={e => { e.stopPropagation(); handleReprocess(s.id) }} title="Reprocess"><FontAwesomeIcon icon={faRotateRight} /></button>
          <button className={`${styles.actionBtn} ${styles.dangerBtn}`} onClick={e => { e.stopPropagation(); handleDelete(s.id) }} title="Delete"><FontAwesomeIcon icon={faTrash} /></button>
        </div>
      ))}

      {totalPages > 1 && (
        <div className={styles.pagination}>
          <button className={styles.actionBtn} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</button>
          <span className={styles.pageInfo}>Page {page} of {totalPages}</span>
          <button className={styles.actionBtn} disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</button>
        </div>
      )}
    </>
  )
}

// ─── Status Tab ───
function StatusTab() {
  const [checks, setChecks] = useState<Record<string, HealthCheck>>({})
  const [queue, setQueue] = useState<Record<string, ProcessingStatus>>({})
  const [unfinished, setUnfinished] = useState<UnfinishedTrack[]>([])
  const [storage, setStorage] = useState<StorageStats | null>(null)
  const [running, setRunning] = useState(false)
  const [compressing, setCompressing] = useState(false)
  const [unfinishedPage, setUnfinishedPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const toast = useToast()

  useEffect(() => {
    const loadQueue = async () => {
      const [q, u, s] = await Promise.all([admin.processingQueue(), admin.unfinished(), admin.storage()])
      setQueue(q)
      setUnfinished(u)
      setStorage(s)
      setLoading(false)
    }
    loadQueue()
    const qInterval = setInterval(async () => { setQueue(await admin.processingQueue()) }, 3000)
    const uInterval = setInterval(async () => { setUnfinished(await admin.unfinished()) }, 5000)
    return () => { clearInterval(qInterval); clearInterval(uInterval) }
  }, [])

  const runChecks = async () => {
    setRunning(true)
    try {
      const r = await admin.runChecks()
      setChecks(r)
      toast.success('Health checks complete')
    } catch {
      toast.error('Health checks failed')
    }
    setRunning(false)
  }

  const handleReprocess = async (id: string) => {
    await admin.reprocessSong(id)
    toast.success('Reprocessing started')
  }

  const handleDelete = async (id: string) => {
    await admin.deleteSong(id)
    toast.success('Track deleted')
    setUnfinished(await admin.unfinished())
  }

  const handleCompress = async () => {
    setCompressing(true)
    try {
      await admin.compressSongs()
      toast.success('Compression started in background')
    } catch {
      toast.error('Failed to start compression')
    }
    setCompressing(false)
  }

  const unfinishedPages = Math.ceil(unfinished.length / PAGE_SIZE) || 1
  const pagedUnfinished = unfinished.slice((unfinishedPage - 1) * PAGE_SIZE, unfinishedPage * PAGE_SIZE)

  const formatBytes = (bytes: number) => {
    if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + ' GB'
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB'
    if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KB'
    return bytes + ' B'
  }

  if (loading) return (
    <>
      {/* Storage skeleton */}
      <div className={styles.section}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-md)' }}>
          <div className={styles.skeleton} style={{ width: 80, height: 20 }} />
          <div className={styles.skeleton} style={{ width: 130, height: 32, borderRadius: 6 }} />
        </div>
        <div className={styles.stats}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className={styles.statCard}>
              <div className={styles.skeleton} style={{ width: 20, height: 20, margin: '0 auto 8px' }} />
              <div className={styles.skeleton} style={{ width: 70, height: 28, margin: '0 auto 8px' }} />
              <div className={styles.skeleton} style={{ width: 80, height: 12, margin: '0 auto' }} />
            </div>
          ))}
        </div>
        <div className={styles.skeleton} style={{ width: '100%', height: 8, borderRadius: 4 }} />
        <div style={{ display: 'flex', gap: 'var(--spacing-lg)', marginTop: 'var(--spacing-sm)' }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className={styles.skeleton} style={{ width: 100 + i * 10, height: 12 }} />
          ))}
        </div>
      </div>
      {/* Health Checks skeleton */}
      <div className={styles.section}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-md)' }}>
          <div className={styles.skeleton} style={{ width: 120, height: 20 }} />
          <div className={styles.skeleton} style={{ width: 110, height: 32, borderRadius: 6 }} />
        </div>
      </div>
      {/* Processing Queue skeleton */}
      <div className={styles.section}>
        <div className={styles.skeleton} style={{ width: 150, height: 20, marginBottom: 'var(--spacing-md)' }} />
        <div className={styles.skeleton} style={{ width: 160, height: 14 }} />
      </div>
      {/* Unfinished Tracks skeleton */}
      <div className={styles.section}>
        <div className={styles.skeleton} style={{ width: 170, height: 20, marginBottom: 'var(--spacing-md)' }} />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className={styles.songItem}>
            <div className={styles.songInfo}>
              <div className={styles.skeleton} style={{ width: 140 + (i % 3) * 30 }} />
              <div className={styles.skeleton} style={{ width: 200 + (i % 2) * 40, height: 12, marginTop: 4 }} />
            </div>
            <div className={styles.skeleton} style={{ width: 28, height: 28, borderRadius: 6 }} />
            <div className={styles.skeleton} style={{ width: 28, height: 28, borderRadius: 6 }} />
          </div>
        ))}
      </div>
    </>
  )

  return (
    <>
      {storage && (
        <div className={styles.section}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-md)' }}>
            <h3>Storage</h3>
            <button className={styles.primaryBtn} onClick={handleCompress} disabled={compressing}>
              {compressing ? 'Starting...' : 'Compress Songs'}
            </button>
          </div>
          <div className={styles.stats}>
            <div className={`${styles.statCard} ${styles.statCardPlays}`}>
              <div className={styles.statIcon} style={{ color: 'var(--success)' }}><FontAwesomeIcon icon={faHardDrive} /></div>
              <div className={styles.statValue}>{formatBytes(storage.disk_free)}</div>
              <div className={styles.statLabel}>Free of {formatBytes(storage.disk_total)}</div>
            </div>
            <div className={`${styles.statCard} ${styles.statCardDownloads}`}>
              <div className={styles.statIcon} style={{ color: '#6366f1' }}><FontAwesomeIcon icon={faMusic} /></div>
              <div className={styles.statValue}>{formatBytes(storage.songs_size)}</div>
              <div className={styles.statLabel}>{storage.songs_count} song{storage.songs_count !== 1 ? 's' : ''}</div>
            </div>
            <div className={`${styles.statCard} ${styles.statCardSearches}`}>
              <div className={styles.statIcon} style={{ color: 'var(--warning)' }}><FontAwesomeIcon icon={faDatabase} /></div>
              <div className={styles.statValue}>{formatBytes(storage.db_size)}</div>
              <div className={styles.statLabel}>Database</div>
            </div>
          </div>
          <div className={styles.storageBar}>
            <div className={styles.storageBarUsed} style={{ width: `${((storage.disk_used - storage.songs_size) / storage.disk_total) * 100}%` }} />
            <div className={styles.storageBarSongs} style={{ width: `${(storage.songs_size / storage.disk_total) * 100}%` }} />
          </div>
          <div className={styles.storageBarLegend}>
            <span><span className={styles.legendDot} style={{ background: 'var(--text-muted)' }} /> System ({formatBytes(storage.disk_used - storage.songs_size)})</span>
            <span><span className={styles.legendDot} style={{ background: 'var(--primary)' }} /> Songs ({formatBytes(storage.songs_size)})</span>
            <span><span className={styles.legendDot} style={{ background: 'var(--border)' }} /> Free ({formatBytes(storage.disk_free)})</span>
          </div>
        </div>
      )}

      <div className={styles.section}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-md)' }}>
          <h3>Health Checks</h3>
          <button className={styles.primaryBtn} onClick={runChecks} disabled={running}>
            {running ? 'Running...' : 'Run Checks'}
          </button>
        </div>
        <div className={styles.healthGrid}>
          {Object.entries(checks).map(([name, check]) => (
            <div key={name} className={`${styles.healthCard} ${check.status === 'ok' ? styles.healthCardOk : styles.healthCardError}`}>
              <div className={styles.healthTitle}>{name}</div>
              <div className={styles.healthMessage}>{check.message}</div>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.section}>
        <h3>Processing Queue</h3>
        {Object.keys(queue).length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No active processing</p>}
        {Object.entries(queue).map(([id, status]) => (
          <div key={id} className={styles.songItem}>
            <div className={styles.songInfo}>
              <div className={styles.songTitle}>Track {id}</div>
              <div className={styles.songArtist}>{status.detail || status.status} - {status.progress}%</div>
            </div>
            <div style={{ width: 100, height: 4, background: 'var(--border)', borderRadius: 2 }}>
              <div style={{ width: `${status.progress}%`, height: '100%', background: 'var(--gradient)', borderRadius: 2, transition: 'width 0.5s' }} />
            </div>
          </div>
        ))}
      </div>

      <div className={styles.section}>
        <h3>Unfinished Tracks ({unfinished.length})</h3>
        {unfinished.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No unfinished tracks</p>}
        {pagedUnfinished.map(t => (
          <div key={t.track_id} className={styles.songItem}>
            <div className={styles.songInfo}>
              <div className={styles.songTitle}>{t.title}</div>
              <div className={styles.songArtist}>{t.artist} &middot; Stage: {t.stage} &middot; Failures: {t.failure_count}</div>
              {t.error_message && <div style={{ fontSize: '0.7rem', color: 'var(--danger)', marginTop: 2 }}>{t.error_message.slice(0, 100)}</div>}
            </div>
            <button className={styles.actionBtn} onClick={() => handleReprocess(t.track_id)} title="Reprocess"><FontAwesomeIcon icon={faRotateRight} /></button>
            <button className={`${styles.actionBtn} ${styles.dangerBtn}`} onClick={() => handleDelete(t.track_id)} title="Delete"><FontAwesomeIcon icon={faTrash} /></button>
          </div>
        ))}
        {unfinishedPages > 1 && (
          <div className={styles.pagination}>
            <button className={styles.actionBtn} disabled={unfinishedPage <= 1} onClick={() => setUnfinishedPage(p => p - 1)}>Prev</button>
            <span className={styles.pageInfo}>Page {unfinishedPage} of {unfinishedPages}</span>
            <button className={styles.actionBtn} disabled={unfinishedPage >= unfinishedPages} onClick={() => setUnfinishedPage(p => p + 1)}>Next</button>
          </div>
        )}
      </div>
    </>
  )
}

// ─── Logs Tab ───
function LogsTab() {
  const [logs, setLogs] = useState<AppLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [levelFilter, setLevelFilter] = useState('')
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const toast = useToast()
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await admin.logs(page, levelFilter || undefined)
      setLogs(data.logs)
      setTotal(data.total)
    } catch {
      toast.error('Failed to load logs')
    }
    setLoading(false)
  }, [page, levelFilter, toast])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    refreshRef.current = setInterval(load, 15000)
    return () => { if (refreshRef.current) clearInterval(refreshRef.current) }
  }, [load])

  const handleClear = async () => {
    await admin.clearLogs()
    toast.success('Logs cleared')
    load()
  }

  const totalPages = Math.ceil(total / 50) || 1

  const levelTagClass = (level: string) => {
    switch (level) {
      case 'info': return styles.tagSuccess
      case 'warning': return styles.tagWarning
      case 'error': return styles.tagDanger
      default: return styles.tagPrimary
    }
  }

  if (loading) return (
    <div className={styles.section}>
      <div className={styles.filters}>
        <div className={styles.skeleton} style={{ width: 120, height: 34 }} />
      </div>
      <table className={styles.table}>
        <thead><tr><th>Level</th><th>Source</th><th>Message</th><th>User</th><th>Time</th></tr></thead>
        <tbody>
          {Array.from({ length: 5 }).map((_, i) => (
            <tr key={i}>
              <td><div className={styles.skeleton} style={{ width: 45 }} /></td>
              <td><div className={styles.skeleton} style={{ width: 70 }} /></td>
              <td><div className={styles.skeleton} style={{ width: 150 + (i % 3) * 20 }} /></td>
              <td><div className={styles.skeleton} style={{ width: 60 }} /></td>
              <td><div className={styles.skeleton} style={{ width: 100 }} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  return (
    <div className={styles.section}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-md)' }}>
        <h3>Application Logs ({total})</h3>
        <button className={styles.primaryBtn} onClick={handleClear}>Clear All</button>
      </div>

      <div className={styles.filters}>
        <CustomSelect
          value={levelFilter}
          onChange={v => { setLevelFilter(v); setPage(1) }}
          options={[
            { value: '', label: 'All levels' },
            { value: 'info', label: 'Info' },
            { value: 'warning', label: 'Warning' },
          ]}
        />
      </div>

      {logs.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No logs found</p>}

      <table className={styles.table}>
        <thead><tr>
          <th>Level</th>
          <th>Source</th>
          <th>Message</th>
          <th>User</th>
          <th>Time</th>
        </tr></thead>
        <tbody>
          {logs.map(log => (
            <>
              <tr key={log.id} onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                style={{ cursor: log.details || log.track_id ? 'pointer' : undefined }}>
                <td>
                  <span className={`${styles.tag} ${levelTagClass(log.level)}`}>
                    {log.level}
                  </span>
                </td>
                <td>{log.source}</td>
                <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.message}</td>
                <td>{log.username || '-'}</td>
                <td>{log.created_at?.replace('T', ' ').slice(0, 16)}</td>
              </tr>
              {expandedId === log.id && (log.details || log.track_id) && (
                <tr key={`${log.id}-detail`}>
                  <td colSpan={5} style={{ padding: 0 }}>
                    <div className={styles.errorDetail}>
                      {log.track_id && <div style={{ fontSize: '0.8rem' }}><strong>Track ID:</strong> {log.track_id}</div>}
                      {log.details && (
                        <div>
                          <strong style={{ fontSize: '0.8rem' }}>Details:</strong>
                          <pre className={styles.stackTrace}>{log.details}</pre>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>

      {totalPages > 1 && (
        <div className={styles.pagination}>
          <button className={styles.actionBtn} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</button>
          <span className={styles.pageInfo}>Page {page} of {totalPages}</span>
          <button className={styles.actionBtn} disabled={page * 50 >= total} onClick={() => setPage(p => p + 1)}>Next</button>
        </div>
      )}
    </div>
  )
}

// ─── Errors Tab ───
function ErrorsTab() {
  const [errors, setErrors] = useState<ErrorLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [typeFilter, setTypeFilter] = useState('')
  const [resolvedFilter, setResolvedFilter] = useState('0')
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const toast = useToast()
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await admin.errors(page, typeFilter || undefined, resolvedFilter)
      setErrors(data.errors)
      setTotal(data.total)
    } catch {
      toast.error('Failed to load errors')
    }
    setLoading(false)
  }, [page, typeFilter, resolvedFilter, toast])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    refreshRef.current = setInterval(load, 15000)
    return () => { if (refreshRef.current) clearInterval(refreshRef.current) }
  }, [load])

  const handleResolve = async (id: number) => {
    await admin.resolveError(id)
    load()
  }

  const handleClearResolved = async () => {
    await admin.clearResolved()
    toast.success('Resolved errors cleared')
    load()
  }

  const totalPages = Math.ceil(total / 50) || 1

  if (loading) return (
    <div className={styles.section}>
      <div className={styles.filters}>
        <div className={styles.skeleton} style={{ width: 120, height: 34 }} />
        <div className={styles.skeleton} style={{ width: 140, height: 34 }} />
      </div>
      <table className={styles.table}>
        <thead><tr><th>Type</th><th>Source</th><th>Message</th><th>User</th><th>Time</th><th>Actions</th></tr></thead>
        <tbody>
          {Array.from({ length: 5 }).map((_, i) => (
            <tr key={i}>
              <td><div className={styles.skeleton} style={{ width: 55 }} /></td>
              <td><div className={styles.skeleton} style={{ width: 80 }} /></td>
              <td><div className={styles.skeleton} style={{ width: 150 + (i % 3) * 20 }} /></td>
              <td><div className={styles.skeleton} style={{ width: 60 }} /></td>
              <td><div className={styles.skeleton} style={{ width: 100 }} /></td>
              <td><div className={styles.skeleton} style={{ width: 60 }} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  return (
    <div className={styles.section}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-md)' }}>
        <h3>Error Log ({total})</h3>
        <button className={styles.primaryBtn} onClick={handleClearResolved}>Clear Resolved</button>
      </div>

      <div className={styles.filters}>
        <CustomSelect
          value={typeFilter}
          onChange={v => { setTypeFilter(v); setPage(1) }}
          options={[
            { value: '', label: 'All types' },
            { value: 'pipeline', label: 'Pipeline' },
            { value: 'api', label: 'API' },
          ]}
        />
        <CustomSelect
          value={resolvedFilter}
          onChange={v => { setResolvedFilter(v); setPage(1) }}
          options={[
            { value: '0', label: 'Unresolved' },
            { value: '1', label: 'Resolved' },
            { value: '', label: 'All' },
          ]}
        />
      </div>

      {errors.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No errors found</p>}

      <table className={styles.table}>
        <thead><tr>
          <th>Type</th>
          <th>Source</th>
          <th>Message</th>
          <th>User</th>
          <th>Time</th>
          <th>Actions</th>
        </tr></thead>
        <tbody>
          {errors.map(err => (
            <>
              <tr key={err.id} onClick={() => setExpandedId(expandedId === err.id ? null : err.id)} style={{ cursor: 'pointer' }}>
                <td>
                  <span className={`${styles.tag} ${err.error_type === 'pipeline' ? styles.tagWarning : styles.tagDanger}`}>
                    {err.error_type}
                  </span>
                </td>
                <td>{err.source}</td>
                <td style={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{err.error_message}</td>
                <td>{err.username || '-'}</td>
                <td>{err.created_at?.replace('T', ' ').slice(0, 16)}</td>
                <td>
                  <button className={styles.actionBtn} onClick={e => { e.stopPropagation(); handleResolve(err.id) }}
                    title={err.resolved ? 'Unresolve' : 'Resolve'}>
                    <FontAwesomeIcon icon={faCheck} style={err.resolved ? { color: 'var(--success)' } : undefined} />
                  </button>
                </td>
              </tr>
              {expandedId === err.id && (
                <tr key={`${err.id}-detail`}>
                  <td colSpan={6} style={{ padding: 0 }}>
                    <div className={styles.errorDetail}>
                      <div style={{ display: 'flex', gap: 'var(--spacing-lg)', flexWrap: 'wrap', fontSize: '0.8rem' }}>
                        {err.track_id && <div><strong>Track ID:</strong> {err.track_id}</div>}
                        {err.request_method && <div><strong>Method:</strong> {err.request_method}</div>}
                        {err.request_path && <div><strong>Path:</strong> {err.request_path}</div>}
                        {err.resolved_at && <div><strong>Resolved:</strong> {err.resolved_at.replace('T', ' ').slice(0, 19)}</div>}
                      </div>
                      <div style={{ fontSize: '0.8rem' }}><strong>Full message:</strong> {err.error_message}</div>
                      {err.stack_trace && (
                        <div>
                          <strong style={{ fontSize: '0.8rem' }}>Stack trace:</strong>
                          <pre className={styles.stackTrace}>{err.stack_trace}</pre>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>

      {totalPages > 1 && (
        <div className={styles.pagination}>
          <button className={styles.actionBtn} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</button>
          <span className={styles.pageInfo}>Page {page} of {totalPages}</span>
          <button className={styles.actionBtn} disabled={page * 50 >= total} onClick={() => setPage(p => p + 1)}>Next</button>
        </div>
      )}
    </div>
  )
}
