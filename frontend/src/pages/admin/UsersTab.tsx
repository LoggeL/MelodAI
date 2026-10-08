import { useAdminAction } from './useAdminAction'
import { errorMessage } from '../account/errors'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { admin } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { Modal } from '../../components/common/Modal'
import { Icon } from '../../components/common/Icon'
import { PageState } from '../../components/common/PageState'
import type { User } from '../../types'
import { formatDate, formatDateTime, formatInt } from '../../utils/format'
import { initials } from '../../utils/user'
import { ConfirmAction, type Confirmation } from './AdminAction'
import { LoadError, Pagination, SearchField, SectionHead } from './shared'
import styles from '../AdminPage.module.css'

type SortKey = 'username' | 'is_admin' | 'created_at' | 'activity_count' | 'credits' | 'last_online'
const PAGE_SIZE = 20
const COLUMNS: { key: SortKey; label: string; num?: boolean }[] = [
  { key: 'username', label: 'Name' }, { key: 'is_admin', label: 'Rolle' },
  { key: 'credits', label: 'Credits', num: true }, { key: 'activity_count', label: 'Aktivität', num: true },
  { key: 'last_online', label: 'Zuletzt aktiv' }, { key: 'created_at', label: 'Dabei seit' },
]

/** Long e-mail usernames break before the „@“, not in the middle of a word. */
function Breakable({ text }: { text: string }) {
  const at = text.indexOf('@')
  return at > 0 ? <>{text.slice(0, at)}<wbr />{text.slice(at)}</> : <>{text}</>
}

export function UsersTab({ onChanged }: { onChanged?: () => void }) {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [sortKey, setSortKey] = useState<SortKey>('created_at')
  const [ascending, setAscending] = useState(false)
  const [filter, setFilter] = useState('')
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [creditUser, setCreditUser] = useState<User | null>(null)
  const [credits, setCredits] = useState('')
  const { username, setCredits: updateSharedCredits } = useAuth()
  const { busy, run } = useAdminAction()
  const requestId = useRef(0)
  const cancelRequest = useCallback(() => { requestId.current++ }, [])

  const load = useCallback(async () => {
    const current = ++requestId.current
    setError('')
    try { const result = await admin.users(); if (current === requestId.current) setUsers(result) }
    catch (e) { if (current === requestId.current) setError(errorMessage(e)) }
    finally { if (current === requestId.current) setLoading(false) }
  }, [])
  useEffect(() => { void load(); return cancelRequest }, [load, cancelRequest])

  const pending = users.filter(user => !user.is_approved)
  const approved = useMemo(() => users.filter(user => user.is_approved && `${user.username} ${user.display_name ?? ''}`.toLowerCase().includes(filter.trim().toLowerCase()))
    .sort((a, b) => {
      const av = a[sortKey] ?? ''; const bv = b[sortKey] ?? ''
      const comparison = typeof av === 'string' ? av.localeCompare(String(bv)) : Number(av) - Number(bv)
      return ascending ? comparison : -comparison
    }), [users, filter, sortKey, ascending])
  const pages = Math.max(1, Math.ceil(approved.length / PAGE_SIZE))
  const currentPage = Math.min(page, pages)
  const paged = approved.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const admins = users.filter(user => user.is_admin).length
  const totalCredits = users.reduce((sum, user) => sum + (user.is_approved ? user.credits : 0), 0)

  const confirmDelete = (user: User, reject = false) => setConfirmation({
    title: reject ? `${user.username} ablehnen?` : `${user.username} löschen?`,
    description: reject ? 'Die Registrierung wird gelöscht. Die Person kann sich danach neu registrieren.' : 'Das Konto wird dauerhaft gelöscht, mit Playlists und Favoriten. Das lässt sich nicht rückgängig machen.',
    label: reject ? 'Ablehnen' : 'Konto löschen', action: () => admin.deleteUser(user.id), success: reject ? 'Registrierung abgelehnt.' : 'Konto gelöscht.',
  })
  const confirmRole = (user: User) => setConfirmation({
    title: user.is_admin ? 'Admin-Rechte entziehen?' : 'Admin-Rechte vergeben?',
    description: user.is_admin ? `${user.username} verliert den Zugang zu Backstage.` : `${user.username} kann dann Konten verwalten, Songs löschen und Systemeinstellungen ändern.`,
    label: user.is_admin ? 'Rechte entziehen' : 'Zum Admin machen', tone: user.is_admin ? 'danger' : 'neutral',
    action: () => user.is_admin ? admin.demoteUser(user.id) : admin.promoteUser(user.id), success: 'Rolle geändert.',
  })
  const sortBy = (key: SortKey) => { setAscending(sortKey === key ? !ascending : key === 'username'); setSortKey(key) }

  if (loading) return <PageState title="Nutzer werden geladen …" loading />
  if (error) return <LoadError title="Die Nutzer konnten nicht geladen werden." error={error} onRetry={load} />

  return <>
    <div className={`stats ${styles.statStrip}`}>
      <div className="stat"><b>{formatInt(users.length - pending.length)}</b><span className="kicker">Aktive Konten</span></div>
      <div className={`stat ${pending.length ? 'stat--err' : ''}`}><b>{formatInt(pending.length)}</b><span className="kicker">Freigabe ausstehend</span></div>
      <div className="stat"><b>{formatInt(admins)}</b><span className="kicker">Admins</span></div>
      <div className="stat"><b>{formatInt(totalCredits)}</b><span className="kicker">Credits im Umlauf</span></div>
    </div>

    {pending.length > 0 && <section className={styles.section} aria-labelledby="pending-head">
      <div className={styles.sectionHeader}><h2 id="pending-head">Warten auf Freigabe <span className="badge badge--soft">{formatInt(pending.length)}</span></h2></div>
      <div className={`table-wrap ${styles.pendingTable}`}>
        <table className="table table--cards">
          <thead><tr><th scope="col">Name</th><th scope="col">Registriert</th><th scope="col" className="num"><span className="sr-only">Aktionen</span></th></tr></thead>
          <tbody>{pending.map(user => <tr key={user.id}>
            <td className="cell-main"><div className={styles.person}><span className={styles.avatar} aria-hidden="true">{initials(user.display_name, user.username)}</span><div className={styles.cellStack}><span className={styles.cellTitle} title={user.username}><Breakable text={user.username} /></span>{user.display_name && user.display_name !== user.username && <span className={styles.cellSub}>{user.display_name}</span>}</div></div></td>
            <td data-label="Registriert" className={`cell-inline ${styles.mono} ${styles.nowrap}`}>{formatDateTime(user.created_at)}</td>
            <td className="num"><div className={styles.tableActions}>
              <button type="button" className={`${styles.actionBtn} ${styles.primary}`} disabled={busy} onClick={async () => { if (await run(() => admin.approveUser(user.id), `${user.username} ist freigegeben.`)) { void load(); onChanged?.() } }}><Icon name="check" size={16} /> Freigeben</button>
              <button type="button" className={`${styles.actionBtn} ${styles.danger}`} disabled={busy} onClick={() => confirmDelete(user, true)} aria-label={`${user.username} ablehnen`}>Ablehnen</button>
            </div></td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>}

    <section className={styles.section}>
      <SectionHead title="Konten" count={approved.length} />
      <div className={styles.filters}><SearchField label="Nutzer suchen" placeholder="Name suchen" value={filter} onChange={value => { setFilter(value); setPage(1) }} /></div>
      {approved.length === 0 ? <PageState icon="users" title={filter ? 'Niemand gefunden.' : 'Noch keine freigegebenen Konten.'} description={filter ? 'Versuch einen anderen Namen.' : 'Freigegebene Konten erscheinen hier.'} /> : <>
        <div className="table-wrap">
          <table className="table table--cards"><thead><tr>{COLUMNS.map(column => <th key={column.key} scope="col" className={column.num ? 'num' : undefined} aria-sort={sortKey === column.key ? ascending ? 'ascending' : 'descending' : 'none'}>
            <button type="button" className={styles.sortButton} onClick={() => sortBy(column.key)}>{column.label}{sortKey === column.key && <Icon name={ascending ? 'arrow-up' : 'arrow-down'} size={12} />}</button>
          </th>)}<th scope="col" className="num"><span className="sr-only">Aktionen</span></th></tr></thead><tbody>{paged.map(user => {
            const self = username === user.username
            return <tr key={user.id}>
              <td className="cell-main"><div className={styles.person}><span className={styles.avatar} aria-hidden="true">{initials(user.display_name, user.username)}</span><div className={styles.cellStack}><span className={styles.cellTitle} title={user.username}><Breakable text={user.username} />{self && <span className={styles.you}> (du)</span>}</span>{user.display_name && user.display_name !== user.username && <span className={styles.cellSub}>{user.display_name}</span>}</div></div></td>
              <td data-label="Rolle" className="cell-inline"><span className={`chip ${user.is_admin ? 'chip--work' : ''}`}>{user.is_admin ? 'Admin' : 'Mitglied'}</span></td>
              <td data-label="Credits" className="num cell-inline"><span className={styles.creditCell}>{formatInt(user.credits)}
                <button type="button" className={`${styles.actionBtn} ${styles.iconOnly}`} disabled={busy} onClick={() => { setCreditUser(user); setCredits(String(user.credits)) }} aria-label={`Credits für ${user.username} festlegen`} title="Credits festlegen"><Icon name="sliders" size={16} /></button></span></td>
              <td data-label="Aktivität" className="num cell-inline">{formatInt(user.activity_count ?? 0)}</td>
              <td data-label="Zuletzt aktiv" className={`cell-inline ${styles.mono} ${styles.nowrap}`}>{user.last_online ? formatDateTime(user.last_online) : '–'}</td>
              <td data-label="Dabei seit" className={`cell-inline ${styles.mono} ${styles.nowrap}`}>{formatDate(user.created_at)}</td>
              <td className="cell-acts num"><div className={styles.tableActions}>
                <button type="button" className={`${styles.actionBtn} ${styles.iconOnly}`} disabled={busy || self} onClick={() => confirmRole(user)} aria-label={`${user.is_admin ? 'Admin-Rechte entziehen' : 'Zum Admin machen'}: ${user.username}`} title={self ? 'Deine eigene Rolle kannst du nicht ändern' : user.is_admin ? 'Admin-Rechte entziehen' : 'Zum Admin machen'}><Icon name="shield" size={16} /></button>
                <button type="button" className={`${styles.actionBtn} ${styles.iconOnly} ${styles.danger}`} disabled={busy || self} onClick={() => confirmDelete(user)} aria-label={`${user.username} löschen`} title={self ? 'Dein eigenes Konto kannst du hier nicht löschen' : 'Konto löschen'}><Icon name="trash" size={16} /></button>
              </div></td>
            </tr>
          })}</tbody></table>
        </div>
        <Pagination page={currentPage} pages={pages} onPage={setPage} label="Seiten der Kontenliste" />
      </>}
    </section>
    {confirmation && <ConfirmAction confirmation={confirmation} onClose={() => setConfirmation(null)} onSuccess={() => { void load(); onChanged?.() }} />}
    {creditUser && <Modal title={`Credits für ${creditUser.username}`} onClose={() => setCreditUser(null)} busy={busy} size="small">
      <form className={styles.dialogForm} onSubmit={async e => {
        e.preventDefault()
        const value = Number(credits)
        if (!credits.trim() || !Number.isSafeInteger(value) || value < 0 || value > 1000000) return
        if (await run(() => admin.setCredits(creditUser.id, value), 'Credits gespeichert.')) {
          if (creditUser.username === username) updateSharedCredits(value)
          setCreditUser(null); void load()
        }
      }}>
        <div className="field"><label htmlFor="credit-balance">Neuer Kontostand</label><input id="credit-balance" className="input" type="number" inputMode="numeric" min="0" max="1000000" step="1" required disabled={busy} value={credits} onChange={e => setCredits(e.target.value)} />
          <span className="field-help">Gib den neuen Gesamtstand ein, nicht die Menge, die dazukommt.</span></div>
        <div className={styles.dialogActions}><button type="button" className="btn" disabled={busy} onClick={() => setCreditUser(null)}>Abbrechen</button><button type="submit" className="btn btn--primary" disabled={busy}>{busy ? 'Wird gespeichert …' : 'Credits speichern'}</button></div>
      </form>
    </Modal>}
  </>
}
