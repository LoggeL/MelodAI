import { errorMessage } from '../account/errors'
import { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { admin } from '../../services/api'
import type { AppLogEntry } from '../../types'
import { Icon } from '../../components/common/Icon'
import { PageState } from '../../components/common/PageState'
import { formatDateTime } from '../../utils/format'
import { ConfirmAction, type Confirmation } from './AdminAction'
import { LoadError, Pagination, SectionHead, Updating } from './shared'
import styles from '../AdminPage.module.css'

const LEVELS: { value: string; label: string }[] = [
  { value: '', label: 'Alle' },
  { value: 'error', label: 'Nur Fehler' },
  { value: 'warning', label: 'Warnungen' },
  { value: 'info', label: 'Info' },
  { value: 'debug', label: 'Debug' },
]
const LEVEL_CHIP: Record<string, string> = { error: 'chip--err', warning: 'chip--warn', info: '', debug: '' }
const LEVEL_LABEL: Record<string, string> = { error: 'Fehler', warning: 'Warnung', info: 'Info', debug: 'Debug' }

// ─── Logs Tab ───
export function LogsTab() {
  const [logs, setLogs] = useState<AppLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [levelFilter, setLevelFilter] = useState('')
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [live, setLive] = useState(true)
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
    if (!live) return
    refreshRef.current = setInterval(load, 15000)
    return () => { if (refreshRef.current) clearInterval(refreshRef.current) }
  }, [load, live])

  const totalPages = Math.ceil(total / 50) || 1

  if (loading) return <PageState title="Logs werden geladen …" loading />

  return (
    <section className={styles.section}>
      {error && <LoadError title="Die Logs konnten nicht geladen werden." error={error} onRetry={load} />}
      <SectionHead title="Anwendungsprotokoll" count={total}>
        <Updating active={refreshing} />
        <button type="button" className={styles.actionBtn} aria-pressed={!live} onClick={() => setLive(value => !value)}>
          <Icon name={live ? 'pause' : 'play'} size={16} /> {live ? 'Pausieren' : 'Fortsetzen'}
        </button>
        <button type="button" className={`${styles.actionBtn} ${styles.danger}`} disabled={total === 0} onClick={() => setConfirmation({ title: 'Alle Logs löschen?', description: 'Alle Einträge im Anwendungsprotokoll werden dauerhaft gelöscht. Das lässt sich nicht rückgängig machen.', label: 'Logs löschen', action: admin.clearLogs, success: 'Logs gelöscht.' })}><Icon name="trash" size={16} /> Alle löschen</button>
      </SectionHead>

      <div className={styles.filters}>
        <div className="seg" role="group" aria-label="Log-Level">
          {LEVELS.map(level => <button type="button" key={level.value} aria-pressed={levelFilter === level.value} onClick={() => { setLevelFilter(level.value); setPage(1) }}>{level.label}</button>)}
        </div>
      </div>

      {!error && logs.length === 0 ? <PageState icon="doc" title="Keine Einträge." description={levelFilter ? 'Für dieses Level gibt es gerade nichts.' : 'Das Protokoll ist leer.'} /> : <ol className={styles.logViewer} aria-label="Logeinträge">
        {logs.map(log => {
          const open = expandedId === log.id
          return <li key={log.id} className={styles.logLine}>
            <button type="button" className={styles.logButton} aria-expanded={open} onClick={() => setExpandedId(open ? null : log.id)}>
              <span className={styles.logTime}>{formatDateTime(log.created_at)}</span>
              <span className={`chip ${styles.logLevel} ${LEVEL_CHIP[log.level] ?? ''}`}>{LEVEL_LABEL[log.level] ?? log.level}</span>
              <span className={styles.logText}>
                <span className={styles.logSource}>{log.source}{log.username ? ` · ${log.username}` : ''}</span>
                <span className={styles.logMessage}>{log.message}</span>
              </span>
            </button>
            {open && (log.track_id || log.details) && <div className={styles.logDetail}>
              <div className={styles.detailBox}>
                {log.track_id && <div className={styles.detailMeta}><span><b>Song:</b> <Link to={'/admin/songs/' + log.track_id}>#{log.track_id}</Link></span></div>}
                {log.details && <pre className={styles.stackTrace}>{log.details}</pre>}
              </div>
            </div>}
          </li>
        })}
      </ol>}

      <Pagination page={page} pages={totalPages} onPage={setPage} label="Seiten des Protokolls" />
      {confirmation && <ConfirmAction confirmation={confirmation} onClose={() => setConfirmation(null)} onSuccess={() => { setPage(1); void load() }} />}
    </section>
  )
}
