import { useAdminAction } from './useAdminAction'
import { errorMessage } from '../account/errors'
import { useState, useEffect, useCallback, useRef, Fragment } from 'react'
import { Link } from 'react-router-dom'
import { admin } from '../../services/api'
import type { ErrorLogEntry } from '../../types'
import { Icon } from '../../components/common/Icon'
import { PageState } from '../../components/common/PageState'
import { formatDateTime } from '../../utils/format'
import { ConfirmAction, type Confirmation } from './AdminAction'
import { LoadError, Pagination, SectionHead, Updating } from './shared'
import styles from '../AdminPage.module.css'

const TYPES = [{ value: '', label: 'Alle Bereiche' }, { value: 'pipeline', label: 'Pipeline' }, { value: 'api', label: 'API' }]
const RESOLUTION = [{ value: '0', label: 'Offen' }, { value: '1', label: 'Erledigt' }, { value: '', label: 'Alle' }]

// ─── Errors Tab ───
export function ErrorsTab({ onChanged }: { onChanged?: () => void }) {
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

  if (loading) return <PageState title="Fehler werden geladen …" loading />

  return (
    <section className={styles.section}>
      {error && <LoadError title="Die Fehler konnten nicht geladen werden." error={error} onRetry={load} />}
      <SectionHead title="Fehlerprotokoll" count={total}>
        <Updating active={refreshing} />
        <button type="button" className={`${styles.actionBtn} ${styles.danger}`} disabled={busy} onClick={() => setConfirmation({ title: 'Erledigte Fehler löschen?', description: 'Erledigte Einträge werden dauerhaft gelöscht. Offene Fehler bleiben.', label: 'Erledigte löschen', action: admin.clearResolved, success: 'Erledigte Fehler gelöscht.' })}><Icon name="trash" size={16} /> Erledigte löschen</button>
      </SectionHead>

      <div className={styles.filters}>
        <div className="seg" role="group" aria-label="Bearbeitungsstand">
          {RESOLUTION.map(option => <button type="button" key={option.value} aria-pressed={resolvedFilter === option.value} onClick={() => { setResolvedFilter(option.value); setPage(1) }}>{option.label}</button>)}
        </div>
        <div className="seg" role="group" aria-label="Bereich">
          {TYPES.map(option => <button type="button" key={option.value} aria-pressed={typeFilter === option.value} onClick={() => { setTypeFilter(option.value); setPage(1) }}>{option.label}</button>)}
        </div>
      </div>

      {!error && errors.length === 0 ? <PageState icon="check" title={resolvedFilter === '0' ? 'Keine offenen Fehler.' : 'Keine Einträge.'} description={resolvedFilter === '0' ? 'Alles läuft. Neue Fehler erscheinen hier automatisch.' : 'Für diesen Filter gibt es nichts.'} /> : <div className="table-wrap">
        <table className="table table--cards">
          <thead><tr>
            <th scope="col">Meldung</th>
            <th scope="col">Bereich</th>
            <th scope="col">Song</th>
            <th scope="col">Nutzer</th>
            <th scope="col">Zeit</th>
            <th scope="col" className="num"><span className="sr-only">Aktionen</span></th>
          </tr></thead>
          <tbody>
            {errors.map(err => (
              <Fragment key={err.id}>
                <tr>
                  <td className="cell-main"><button type="button" className={`${styles.messageButton} ${styles.mono}`} aria-expanded={expandedId === err.id} onClick={() => setExpandedId(expandedId === err.id ? null : err.id)}>{err.error_message}</button></td>
                  <td data-label="Bereich" className="cell-inline"><span className={`chip ${err.error_type === 'pipeline' ? 'chip--warn' : 'chip--err'}`}>{err.error_type === 'pipeline' ? 'Pipeline' : 'API'}</span><span className={styles.cellSub}>{err.source}</span></td>
                  <td data-label="Song" className={`cell-inline ${styles.mono}`}>{err.track_id ? <Link className={styles.trackLink} to={'/admin/songs/' + err.track_id}>#{err.track_id}</Link> : '–'}</td>
                  <td data-label="Nutzer" className="cell-inline">{err.username || '–'}</td>
                  <td data-label="Zeit" className={`cell-inline ${styles.mono} ${styles.nowrap}`}>{formatDateTime(err.created_at)}</td>
                  <td className="cell-acts num">
                    <button type="button" className={`${styles.actionBtn} ${styles.iconOnly}`} disabled={busy} aria-pressed={err.resolved} onClick={async () => { if (await run(() => admin.resolveError(err.id), err.resolved ? 'Fehler wieder geöffnet.' : 'Fehler erledigt.')) { void load(); onChanged?.() } }} aria-label={err.resolved ? 'Wieder öffnen' : 'Als erledigt markieren'}
                      title={err.resolved ? 'Wieder öffnen' : 'Als erledigt markieren'}>
                      <Icon name={err.resolved ? 'redo' : 'check'} size={16} />
                    </button>
                  </td>
                </tr>
                {expandedId === err.id && (
                  <tr className={styles.detailRow}>
                    <td colSpan={6}>
                      <div className={styles.detailBox}>
                        <div className={styles.detailMeta}>
                          {err.request_method && <span><b>Methode:</b> <span className={styles.mono}>{err.request_method}</span></span>}
                          {err.request_path && <span><b>Pfad:</b> <span className={styles.mono}>{err.request_path}</span></span>}
                          {err.resolved_at && <span><b>Erledigt:</b> <span className={styles.mono}>{formatDateTime(err.resolved_at)}</span></span>}
                        </div>
                        {err.stack_trace && <pre className={styles.stackTrace}>{err.stack_trace}</pre>}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>}

      <Pagination page={page} pages={totalPages} onPage={setPage} label="Seiten des Fehlerprotokolls" />
      {confirmation && <ConfirmAction confirmation={confirmation} onClose={() => setConfirmation(null)} onSuccess={() => { setPage(1); void load(); onChanged?.() }} />}
    </section>
  )
}
