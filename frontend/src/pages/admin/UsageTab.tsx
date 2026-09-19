import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faUsers, faPlay, faDownload, faMagnifyingGlass, faCrown, faArrowUp, faArrowDown } from '@fortawesome/free-solid-svg-icons'
import { admin } from '../../services/api'
import type { AdminStats, UsageLog } from '../../types'
import { CustomSelect } from '../../components/common/CustomSelect'
import { PageState } from '../../components/common/PageState'
import { errorMessage } from '../account/errors'
import styles from '../AdminPage.module.css'

type SortDir = 'asc' | 'desc'

// ─── Usage Tab ───
export function UsageTab() {
  const [statsData, setStats] = useState<AdminStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [logs, setLogs] = useState<UsageLog[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [filterUser, setFilterUser] = useState('')
  const [filterAction, setFilterAction] = useState('')
  const [logSortKey, setLogSortKey] = useState<'username' | 'action' | 'detail' | 'created_at'>('created_at')
  const [logSortDir, setLogSortDir] = useState<SortDir>('desc')
  const [error, setError] = useState('')
  const requestId = useRef(0)
  const cancelRequest = useCallback(() => { requestId.current++ }, [])
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    const current = ++requestId.current
    setRefreshing(true)
    try {
      const [s, l] = await Promise.all([
        admin.stats(),
        admin.usageLogs(page, filterUser || undefined, filterAction || undefined)
      ])
      if (current !== requestId.current) return
      setError('')
      setStats(s)
      setLogs(l.logs)
      setTotal(l.total)
    } catch (e) {
      if (current === requestId.current) setError(errorMessage(e))
    } finally {
      if (current === requestId.current) { setLoading(false); setRefreshing(false) }
    }
  }, [page, filterUser, filterAction])

  useEffect(() => { void load(); return cancelRequest }, [load, cancelRequest])

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

  if (loading) return <PageState title="Loading usage" loading />

  return (
    <>
      {error && <PageState title="Could not load usage" description={error} action={<button className={styles.primaryBtn} onClick={load}>Try again</button>} />}
      {refreshing && <p role="status" className={styles.subtle}>Updating usage…</p>}
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
          <input className={styles.filterInput} aria-label="Filter usage by username" placeholder="Filter by username..." value={filterUser}
            onChange={e => { setFilterUser(e.target.value); setPage(1) }} />
          <CustomSelect
          aria-label="Usage action"
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

        <p className={styles.subtle}>Sort columns within the current page.</p>
        {!error && logs.length === 0 && <PageState title="No matching activity" description="Try another username or action." />}
        <div className={styles.tableScroll} role="region" aria-label="Usage table" tabIndex={0}><table className={styles.table}>
          <thead><tr>
            <th aria-sort={logSortKey === 'username' ? logSortDir === 'asc' ? 'ascending' : 'descending' : 'none'}><button className={styles.sortButton} onClick={() => handleLogSort('username')}>User <LogSortIndicator column="username" /></button></th>
            <th aria-sort={logSortKey === 'action' ? logSortDir === 'asc' ? 'ascending' : 'descending' : 'none'}><button className={styles.sortButton} onClick={() => handleLogSort('action')}>Action <LogSortIndicator column="action" /></button></th>
            <th aria-sort={logSortKey === 'detail' ? logSortDir === 'asc' ? 'ascending' : 'descending' : 'none'}><button className={styles.sortButton} onClick={() => handleLogSort('detail')}>Detail <LogSortIndicator column="detail" /></button></th>
            <th aria-sort={logSortKey === 'created_at' ? logSortDir === 'asc' ? 'ascending' : 'descending' : 'none'}><button className={styles.sortButton} onClick={() => handleLogSort('created_at')}>Time <LogSortIndicator column="created_at" /></button></th>
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
        </table></div>

        <div className={styles.pagination}>
          <button className={styles.actionBtn} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button>
          <span className={styles.pageInfo}>Page {page} of {Math.ceil(total / 50) || 1}</span>
          <button className={styles.actionBtn} disabled={page * 50 >= total} onClick={() => setPage(p => p + 1)}>Next</button>
        </div>
      </div>
    </>
  )
}
