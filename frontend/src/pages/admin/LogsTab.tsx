import { errorMessage } from '../account/errors'
import { useState, useEffect, useCallback, useRef, Fragment } from 'react'
import { admin } from '../../services/api'
import type { AppLogEntry } from '../../types'
import { CustomSelect } from '../../components/common/CustomSelect'
import { PageState } from '../../components/common/PageState'
import { ConfirmAction, type Confirmation } from './AdminAction'
import styles from '../AdminPage.module.css'


// ─── Logs Tab ───
export function LogsTab() {
  const [logs, setLogs] = useState<AppLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [levelFilter, setLevelFilter] = useState('')
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const requestId = useRef(0)
  const cancelRequest = useCallback(() => { requestId.current++ }, [])
  const [refreshing, setRefreshing] = useState(false)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    const current = ++requestId.current
    setRefreshing(true)
    try {
      const data = await admin.logs(page, levelFilter || undefined)
      if (current !== requestId.current) return
      setError('')
      if (page > Math.max(1, Math.ceil(data.total / 50))) setPage(Math.max(1, Math.ceil(data.total / 50)))
      setLogs(data.logs)
      setTotal(data.total)
    } catch (e) {
      if (current === requestId.current) setError(errorMessage(e))
    } finally {
      if (current === requestId.current) { setLoading(false); setRefreshing(false) }
    }
  }, [page, levelFilter])

  useEffect(() => { void load(); return cancelRequest }, [load, cancelRequest])

  useEffect(() => {
    refreshRef.current = setInterval(load, 15000)
    return () => { if (refreshRef.current) clearInterval(refreshRef.current) }
  }, [load])


  const totalPages = Math.ceil(total / 50) || 1

  const levelTagClass = (level: string) => {
    switch (level) {
      case 'info': return styles.tagSuccess
      case 'warning': return styles.tagWarning
      case 'error': return styles.tagDanger
      default: return styles.tagPrimary
    }
  }

  if (loading) return <PageState title="Loading logs" loading />

  return (
    <div className={styles.section}>
      {error && <PageState title="Could not load logs" description={error} action={<button className={styles.primaryBtn} onClick={load}>Try again</button>} />}
      {refreshing && <p role="status" className={styles.subtle}>Updating logs…</p>}
      <div className={styles.sectionHeader}>
        <h3>Application Logs ({total})</h3>
        <button className={`${styles.actionBtn} ${styles.dangerBtn}`} disabled={total === 0} onClick={() => setConfirmation({ title: 'Clear all application logs?', description: 'All application log records will be permanently deleted. This cannot be undone.', label: 'Clear logs', action: admin.clearLogs, success: 'Application logs cleared' })}>Clear All</button>
      </div>

      <div className={styles.filters}>
        <CustomSelect
          aria-label="Log level"
          value={levelFilter}
          onChange={v => { setLevelFilter(v); setPage(1) }}
          options={[
            { value: '', label: 'All levels' },
            { value: 'info', label: 'Info' },
            { value: 'warning', label: 'Warning' },
            { value: 'error', label: 'Error' },
            { value: 'debug', label: 'Debug' },
          ]}
        />
      </div>

      {!error && logs.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No logs found</p>}

      <div className={styles.tableScroll} role="region" aria-label="Logs table" tabIndex={0}><table className={styles.table}>
        <thead><tr>
          <th>Level</th>
          <th>Source</th>
          <th>Message</th>
          <th>User</th>
          <th>Time</th>
        </tr></thead>
        <tbody>
          {logs.map(log => (
            <Fragment key={log.id}>
              <tr>
                <td>
                  <span className={`${styles.tag} ${levelTagClass(log.level)}`}>
                    {log.level}
                  </span>
                </td>
                <td>{log.source}</td>
                <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><button className={styles.detailButton} aria-expanded={expandedId === log.id} onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}>{log.message}</button></td>
                <td>{log.username || '-'}</td>
                <td>{log.created_at?.replace('T', ' ').slice(0, 16)}</td>
              </tr>
              {expandedId === log.id && (
                <tr key={`${log.id}-detail`}>
                  <td colSpan={5} style={{ padding: 0 }}>
                    <div className={styles.errorDetail}><p>{log.message}</p>
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
            </Fragment>
          ))}
        </tbody>
      </table></div>

      {totalPages > 1 && (
        <div className={styles.pagination}>
          <button className={styles.actionBtn} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button>
          <span className={styles.pageInfo}>Page {page} of {totalPages}</span>
          <button className={styles.actionBtn} disabled={page * 50 >= total} onClick={() => setPage(p => p + 1)}>Next</button>
        </div>
      )}
      {confirmation && <ConfirmAction confirmation={confirmation} onClose={() => setConfirmation(null)} onSuccess={() => { setPage(1); void load() }} />}
    </div>
  )
}
