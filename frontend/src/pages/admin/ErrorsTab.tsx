import { useAdminAction } from './useAdminAction'
import { errorMessage } from '../account/errors'
import { useState, useEffect, useCallback, useRef, Fragment } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCheck } from '@fortawesome/free-solid-svg-icons'
import { admin } from '../../services/api'
import type { ErrorLogEntry } from '../../types'
import { CustomSelect } from '../../components/common/CustomSelect'
import { PageState } from '../../components/common/PageState'
import { ConfirmAction, type Confirmation } from './AdminAction'
import styles from '../AdminPage.module.css'


// ─── Errors Tab ───
export function ErrorsTab() {
  const [errors, setErrors] = useState<ErrorLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [typeFilter, setTypeFilter] = useState('')
  const [resolvedFilter, setResolvedFilter] = useState('0')
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const requestId = useRef(0)
  const cancelRequest = useCallback(() => { requestId.current++ }, [])
  const [refreshing, setRefreshing] = useState(false)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const { busy, run } = useAdminAction()
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    const current = ++requestId.current
    setRefreshing(true)
    try {
      const data = await admin.errors(page, typeFilter || undefined, resolvedFilter)
      if (current !== requestId.current) return
      setError('')
      if (page > Math.max(1, Math.ceil(data.total / 50))) setPage(Math.max(1, Math.ceil(data.total / 50)))
      setErrors(data.errors)
      setTotal(data.total)
    } catch (e) {
      if (current === requestId.current) setError(errorMessage(e))
    } finally {
      if (current === requestId.current) { setLoading(false); setRefreshing(false) }
    }
  }, [page, typeFilter, resolvedFilter])

  useEffect(() => { void load(); return cancelRequest }, [load, cancelRequest])

  useEffect(() => {
    refreshRef.current = setInterval(load, 15000)
    return () => { if (refreshRef.current) clearInterval(refreshRef.current) }
  }, [load])


  const totalPages = Math.ceil(total / 50) || 1

  if (loading) return <PageState title="Loading errors" loading />

  return (
    <div className={styles.section}>
      {error && <PageState title="Could not load errors" description={error} action={<button className={styles.primaryBtn} onClick={load}>Try again</button>} />}
      {refreshing && <p role="status" className={styles.subtle}>Updating errors…</p>}
      <div className={styles.sectionHeader}>
        <h3>Error Log ({total})</h3>
        <button className={`${styles.actionBtn} ${styles.dangerBtn}`} disabled={busy} onClick={() => setConfirmation({ title: 'Clear resolved errors?', description: 'Resolved error records will be permanently deleted. Unresolved errors will be kept.', label: 'Clear resolved errors', action: admin.clearResolved, success: 'Resolved errors cleared' })}>Clear Resolved</button>
      </div>

      <div className={styles.filters}>
        <CustomSelect
          aria-label="Error type"
          value={typeFilter}
          onChange={v => { setTypeFilter(v); setPage(1) }}
          options={[
            { value: '', label: 'All types' },
            { value: 'pipeline', label: 'Pipeline' },
            { value: 'api', label: 'API' },
          ]}
        />
        <CustomSelect
          aria-label="Resolution status"
          value={resolvedFilter}
          onChange={v => { setResolvedFilter(v); setPage(1) }}
          options={[
            { value: '0', label: 'Unresolved' },
            { value: '1', label: 'Resolved' },
            { value: '', label: 'All' },
          ]}
        />
      </div>

      {!error && errors.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No errors found</p>}

      <div className={styles.tableScroll} role="region" aria-label="Errors table" tabIndex={0}><table className={styles.table}>
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
            <Fragment key={err.id}>
              <tr>
                <td>
                  <span className={`${styles.tag} ${err.error_type === 'pipeline' ? styles.tagWarning : styles.tagDanger}`}>
                    {err.error_type}
                  </span>
                </td>
                <td>{err.source}</td>
                <td style={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><button className={styles.detailButton} aria-expanded={expandedId === err.id} onClick={() => setExpandedId(expandedId === err.id ? null : err.id)}>{err.error_message}</button></td>
                <td>{err.username || '-'}</td>
                <td>{err.created_at?.replace('T', ' ').slice(0, 16)}</td>
                <td>
                  <button className={styles.actionBtn} disabled={busy} onClick={async () => { if (await run(() => admin.resolveError(err.id), err.resolved ? 'Error reopened' : 'Error resolved')) void load() }} aria-label={err.resolved ? 'Reopen error' : 'Resolve error'}
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
