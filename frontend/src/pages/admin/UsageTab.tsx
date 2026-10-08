import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { admin } from '../../services/api'
import type { AdminStats, DailyUsage, UsageLog } from '../../types'
import { Icon } from '../../components/common/Icon'
import { PageState } from '../../components/common/PageState'
import { formatDateTime, formatDay, formatInt } from '../../utils/format'
import { errorMessage } from '../account/errors'
import { LoadError, Pagination, SearchField, SectionHead, Updating } from './shared'
import styles from '../AdminPage.module.css'

type SortDir = 'asc' | 'desc'
type LogSortKey = 'username' | 'action' | 'detail' | 'created_at'

const ACTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Alle' },
  { value: 'play', label: 'Wiedergabe' },
  { value: 'search', label: 'Suche' },
  { value: 'download', label: 'Download' },
]
const ACTION_LABEL: Record<string, string> = { play: 'Wiedergabe', search: 'Suche', download: 'Download' }
const COLUMNS: { key: LogSortKey; label: string }[] = [
  { key: 'username', label: 'Nutzer' }, { key: 'action', label: 'Aktion' }, { key: 'detail', label: 'Detail' }, { key: 'created_at', label: 'Zeit' },
]

const DAYS = 14

/** Per-day totals (§4.10 Nutzung): Tag, Wiedergaben, Suchen, Downloads, Credits. */
export function DailyUsageTable({ days }: { days: DailyUsage[] }) {
  const active = days.some(day => day.plays || day.searches || day.downloads)
  return (
    <section className={styles.section} aria-labelledby="usage-daily">
      <SectionHead id="usage-daily" title={`Letzte ${days.length || DAYS} Tage`} />
      {!active ? <PageState icon="chart" title="Keine Einträge." description="In diesem Zeitraum gab es keine Wiedergaben, Suchen oder Downloads." /> : <div className="table-wrap">
        <table className="table table--cards">
          <thead><tr>
            <th scope="col">Tag</th><th scope="col" className="num">Wiedergaben</th><th scope="col" className="num">Suchen</th>
            <th scope="col" className="num">Downloads</th><th scope="col" className="num">Credits</th>
          </tr></thead>
          <tbody>{days.map(day => (
            <tr key={day.day} className={day.plays || day.searches || day.downloads ? undefined : styles.quietRow}>
              <td className={`cell-main ${styles.mono} ${styles.nowrap}`}>{formatDay(day.day)}</td>
              <td data-label="Wiedergaben" className="num cell-inline">{formatInt(day.plays)}</td>
              <td data-label="Suchen" className="num cell-inline">{formatInt(day.searches)}</td>
              <td data-label="Downloads" className="num cell-inline">{formatInt(day.downloads)}</td>
              <td data-label="Credits" className="num cell-inline">{day.credits ? `−${formatInt(day.credits)}` : '0'}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>}
      <p className={styles.subtle}>Credits sind geschätzt: 5 pro verarbeitetem Song, 1 pro Wiedergabe, ohne Admins. Tage in UTC.</p>
    </section>
  )
}

// ─── Usage Tab ───
export function UsageTab() {
  const [statsData, setStats] = useState<AdminStats | null>(null)
  const [daily, setDaily] = useState<DailyUsage[]>([])
  const [loading, setLoading] = useState(true)
  const [logs, setLogs] = useState<UsageLog[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [filterUser, setFilterUser] = useState('')
  const [filterAction, setFilterAction] = useState('')
  const [logSortKey, setLogSortKey] = useState<LogSortKey>('created_at')
  const [logSortDir, setLogSortDir] = useState<SortDir>('desc')
  const [error, setError] = useState('')
  const requestId = useRef(0)
  const cancelRequest = useCallback(() => { requestId.current++ }, [])
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    const current = ++requestId.current
    setRefreshing(true)
    try {
      const [s, l, d] = await Promise.all([
        admin.stats(),
        admin.usageLogs(page, filterUser || undefined, filterAction || undefined),
        admin.dailyUsage(DAYS),
      ])
      if (current !== requestId.current) return
      setError('')
      setStats(s)
      setDaily(d)
      setLogs(l.logs)
      setTotal(l.total)
    } catch (e) {
      if (current === requestId.current) setError(errorMessage(e))
    } finally {
      if (current === requestId.current) { setLoading(false); setRefreshing(false) }
    }
  }, [page, filterUser, filterAction])

  useEffect(() => { void load(); return cancelRequest }, [load, cancelRequest])

  const handleLogSort = (key: LogSortKey) => {
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

  if (loading) return <PageState title="Nutzung wird geladen …" loading />

  return (
    <>
      {error && <LoadError title="Die Nutzung konnte nicht geladen werden." error={error} onRetry={load} />}
      {statsData && (
        <div className={`stats ${styles.statStrip}`}>
          <div className="stat"><b>{formatInt(statsData.total_users)}</b><span className="kicker">Nutzer</span></div>
          <div className="stat"><b>{formatInt(statsData.total_plays)}</b><span className="kicker">Wiedergaben</span></div>
          <div className="stat"><b>{formatInt(statsData.total_searches)}</b><span className="kicker">Suchen</span></div>
          <div className="stat"><b>{formatInt(statsData.total_downloads)}</b><span className="kicker">Downloads</span></div>
          {statsData.most_active_user && <div className="stat"><b>{formatInt(statsData.most_active_count)}</b><span className="kicker">Aktivste Person</span><small className={styles.statName}>{statsData.most_active_user}</small></div>}
        </div>
      )}

      <DailyUsageTable days={daily} />

      <section className={styles.section}>
        <SectionHead title="Aktivität" count={total}><Updating active={refreshing} /></SectionHead>
        <div className={styles.filters}>
          <SearchField label="Nach Nutzer filtern" placeholder="Nutzer filtern" value={filterUser} onChange={value => { setFilterUser(value); setPage(1) }} />
          <div className="seg" role="group" aria-label="Aktion">
            {ACTIONS.map(action => <button type="button" key={action.value} aria-pressed={filterAction === action.value} onClick={() => { setFilterAction(action.value); setPage(1) }}>{action.label}</button>)}
          </div>
        </div>

        {!error && logs.length === 0 ? <PageState icon="chart" title="Keine passende Aktivität." description="Versuch einen anderen Namen oder eine andere Aktion." /> : <div className="table-wrap">
          <table className="table table--cards">
            <thead><tr>
              {COLUMNS.map(column => <th key={column.key} scope="col" aria-sort={logSortKey === column.key ? logSortDir === 'asc' ? 'ascending' : 'descending' : 'none'}>
                <button type="button" className={styles.sortButton} onClick={() => handleLogSort(column.key)}>{column.label}{logSortKey === column.key && <Icon name={logSortDir === 'asc' ? 'arrow-up' : 'arrow-down'} size={12} />}</button>
              </th>)}
            </tr></thead>
            <tbody>
              {sortedLogs.map(l => (
                <tr key={l.id}>
                  <td className={`cell-main ${styles.cellTitle}`}>{l.username}</td>
                  <td data-label="Aktion" className="cell-inline"><span className={`chip ${l.action === 'play' ? '' : l.action === 'download' ? 'chip--work' : ''}`}>{ACTION_LABEL[l.action] ?? l.action}</span></td>
                  <td data-label="Detail" className={styles.cellSub}>{l.detail || '–'}</td>
                  <td data-label="Zeit" className={`cell-inline ${styles.mono} ${styles.nowrap}`}>{formatDateTime(l.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>}
        <p className={styles.subtle}>Sortieren gilt für die aktuelle Seite.</p>
        <Pagination page={page} pages={Math.ceil(total / 50) || 1} onPage={setPage} label="Seiten der Aktivität" />
      </section>
    </>
  )
}
