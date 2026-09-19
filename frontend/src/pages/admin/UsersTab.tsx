import { useAdminAction } from './useAdminAction'
import { errorMessage } from '../account/errors'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCoins, faShield, faTrash, faUserMinus } from '@fortawesome/free-solid-svg-icons'
import { admin } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { Modal } from '../../components/common/Modal'
import { PageState } from '../../components/common/PageState'
import type { User } from '../../types'
import { ConfirmAction, type Confirmation } from './AdminAction'
import styles from '../AdminPage.module.css'

type SortKey = 'username' | 'is_admin' | 'created_at' | 'activity_count' | 'credits'
const PAGE_SIZE = 20
const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'username', label: 'Username' }, { key: 'is_admin', label: 'Role' },
  { key: 'created_at', label: 'Created' }, { key: 'activity_count', label: 'Activity' },
  { key: 'credits', label: 'Credits' },
]

export function UsersTab() {
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
  const approved = useMemo(() => users.filter(user => user.is_approved && user.username.toLowerCase().includes(filter.trim().toLowerCase()))
    .sort((a, b) => {
      const av = a[sortKey] ?? ''; const bv = b[sortKey] ?? ''
      const comparison = typeof av === 'string' ? av.localeCompare(String(bv)) : Number(av) - Number(bv)
      return ascending ? comparison : -comparison
    }), [users, filter, sortKey, ascending])
  const pages = Math.max(1, Math.ceil(approved.length / PAGE_SIZE))
  const currentPage = Math.min(page, pages)
  const paged = approved.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const confirmDelete = (user: User) => setConfirmation({
    title: `Delete ${user.username}?`, description: 'This permanently removes the account and its personal playlists and favorites. This cannot be undone.',
    label: 'Delete user', action: () => admin.deleteUser(user.id), success: 'User deleted',
  })
  const confirmRole = (user: User) => setConfirmation({
    title: `${user.is_admin ? 'Remove' : 'Grant'} admin access?`,
    description: user.is_admin ? `${user.username} will lose access to user management and system settings.` : `${user.username} will be able to manage users, delete songs, and change system settings.`,
    label: user.is_admin ? 'Remove admin access' : 'Grant admin access',
    action: () => user.is_admin ? admin.demoteUser(user.id) : admin.promoteUser(user.id), success: 'User permissions updated',
  })

  if (loading) return <PageState title="Loading users" loading />
  if (error) return <PageState title="Could not load users" description={error} action={<button className={styles.primaryBtn} onClick={load}>Try again</button>} />

  return <>
    {pending.length > 0 && <section className={styles.pendingSection}>
      <h2 className={styles.pendingTitle}>{pending.length} pending approval</h2>
      <div className={styles.pendingList}>{pending.map(user => <div key={user.id} className={styles.pendingCard}>
        <div className={styles.pendingInfo}><span className={styles.pendingUsername}>{user.username}</span><span className={styles.pendingDate}>Registered {user.created_at?.split('T')[0]}</span></div>
        <div className={styles.pendingActions}>
          <button className={styles.primaryBtn} disabled={busy} onClick={async () => { if (await run(() => admin.approveUser(user.id), 'User approved')) void load() }}>Approve</button>
          <button className={`${styles.actionBtn} ${styles.dangerBtn}`} disabled={busy} onClick={() => confirmDelete(user)} aria-label={`Reject ${user.username}`}>Reject</button>
        </div>
      </div>)}</div>
    </section>}
    <section className={styles.section}>
      <h2>Users</h2>
      <div className={styles.filters}><label className={styles.fieldLabel}>Search users<input className={styles.filterInput} placeholder="Username" value={filter} onChange={e => { setFilter(e.target.value); setPage(1) }} /></label></div>
      {approved.length === 0 ? <PageState title={filter ? 'No matching users' : 'No approved users'} description={filter ? 'Try another username.' : 'Approved accounts will appear here.'} /> : <>
        <div className={styles.tableScroll} role="region" aria-label="User accounts" tabIndex={0}>
          <table className={styles.table}><thead><tr>{COLUMNS.map(column => <th key={column.key} scope="col" aria-sort={sortKey === column.key ? ascending ? 'ascending' : 'descending' : 'none'}>
            <button className={styles.sortButton} onClick={() => { setAscending(sortKey === column.key ? !ascending : true); setSortKey(column.key) }}>{column.label}{sortKey === column.key && (ascending ? ' ↑' : ' ↓')}</button>
          </th>)}<th scope="col">Actions</th></tr></thead><tbody>{paged.map(user => <tr key={user.id}>
            <td>{user.username}{username === user.username && <span className={styles.subtle}> (you)</span>}</td>
            <td><span className={`${styles.tag} ${user.is_admin ? styles.tagPrimary : styles.tagSuccess}`}>{user.is_admin ? 'Admin' : 'User'}</span></td>
            <td>{user.created_at?.split('T')[0]}</td><td>{user.activity_count ?? 0}</td>
            <td>{user.credits}<button className={styles.actionBtn} disabled={busy} onClick={() => { setCreditUser(user); setCredits(String(user.credits)) }} aria-label={`Set credits for ${user.username}`} title="Set credits"><FontAwesomeIcon icon={faCoins} /></button></td>
            <td><div className={styles.rowActions}>
              <button className={styles.actionBtn} disabled={busy || username === user.username} onClick={() => confirmRole(user)} aria-label={`${user.is_admin ? 'Remove' : 'Grant'} admin access for ${user.username}`} title={username === user.username ? 'You cannot change your own role' : 'Change role'}><FontAwesomeIcon icon={user.is_admin ? faUserMinus : faShield} /></button>
              <button className={`${styles.actionBtn} ${styles.dangerBtn}`} disabled={busy || username === user.username} onClick={() => confirmDelete(user)} aria-label={`Delete ${user.username}`} title={username === user.username ? 'You cannot delete your own account' : 'Delete user'}><FontAwesomeIcon icon={faTrash} /></button>
            </div></td>
          </tr>)}</tbody></table>
        </div>
        {pages > 1 && <nav className={styles.pagination} aria-label="User pages"><button className={styles.actionBtn} disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Previous</button><span className={styles.pageInfo}>Page {currentPage} of {pages}</span><button className={styles.actionBtn} disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>Next</button></nav>}
      </>}
    </section>
    {confirmation && <ConfirmAction confirmation={confirmation} onClose={() => setConfirmation(null)} onSuccess={load} />}
    {creditUser && <Modal title={`Credits for ${creditUser.username}`} onClose={() => setCreditUser(null)} busy={busy} size="small">
      <form className={styles.dialogForm} onSubmit={async e => {
        e.preventDefault()
        const value = Number(credits)
        if (!credits.trim() || !Number.isSafeInteger(value) || value < 0 || value > 1000000) return
        if (await run(() => admin.setCredits(creditUser.id, value), 'Credits updated')) {
          if (creditUser.username === username) updateSharedCredits(value)
          setCreditUser(null); void load()
        }
      }}>
        <label className={styles.fieldLabel}>Credit balance<input className={styles.filterInput} type="number" min="0" max="1000000" step="1" required disabled={busy} value={credits} onChange={e => setCredits(e.target.value)} /></label>
        <p className={styles.subtle}>Enter the total balance, not the amount to add.</p>
        <div className={styles.rowActions}><button type="button" className={styles.actionBtn} disabled={busy} onClick={() => setCreditUser(null)}>Cancel</button><button type="submit" className={styles.primaryBtn} disabled={busy}>{busy ? 'Saving…' : 'Save credits'}</button></div>
      </form>
    </Modal>}
  </>
}
