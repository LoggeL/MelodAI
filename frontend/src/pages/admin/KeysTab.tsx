import { useAdminAction } from './useAdminAction'
import { errorMessage } from '../account/errors'
import { useCallback, useEffect, useRef, useState } from 'react'
import { admin } from '../../services/api'
import { PageState } from '../../components/common/PageState'
import type { InviteKey } from '../../types'
import { ConfirmAction, type Confirmation } from './AdminAction'
import styles from '../AdminPage.module.css'

export function KeysTab() {
  const [keys, setKeys] = useState<InviteKey[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [newKey, setNewKey] = useState('')
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const { busy, run } = useAdminAction()
  const requestId = useRef(0)
  const cancelRequest = useCallback(() => { requestId.current++ }, [])
  const load = useCallback(async () => {
    const current = ++requestId.current
    setError('')
    try { const result = await admin.inviteKeys(); if (current === requestId.current) setKeys(result) }
    catch (e) { if (current === requestId.current) setError(errorMessage(e)) }
    finally { if (current === requestId.current) setLoading(false) }
  }, [])
  useEffect(() => { void load(); return cancelRequest }, [load, cancelRequest])
  const usedCount = keys.filter(key => key.used_by).length
  const pages = Math.max(1, Math.ceil(keys.length / 20))
  const currentPage = Math.min(page, pages)
  if (loading) return <PageState title="Loading invite keys" loading />
  if (error) return <PageState title="Could not load invite keys" description={error} action={<button className={styles.primaryBtn} onClick={load}>Try again</button>} />
  return <section className={styles.section}>
    <div className={styles.sectionHeader}><h2>Invite keys ({keys.length})</h2><div className={styles.rowActions}>
      {usedCount > 0 && <button className={`${styles.actionBtn} ${styles.dangerBtn}`} disabled={busy} onClick={() => setConfirmation({ title: 'Remove used invite keys?', description: `Remove ${usedCount} redeemed invite keys from the list. Existing accounts will keep access.`, label: 'Remove used keys', action: admin.deleteUsedInviteKeys, success: 'Used invite keys removed' })}>Remove used ({usedCount})</button>}
      <button className={styles.primaryBtn} disabled={busy} onClick={async () => { if (await run(async () => { const result = await admin.generateInviteKey(); setNewKey(result.key) }, 'Invite key created')) void load() }}>{busy ? 'Creating…' : 'Generate invite key'}</button>
    </div></div>
    {newKey && <div className={styles.notice} role="status">New invite key: <code className={styles.keyDisplay}>{newKey}</code><p>Select the key to copy it and share it with your guest.</p></div>}
    {keys.length === 0 ? <PageState title="No invite keys yet" description="Create a key to let someone join without waiting for approval." /> : <div className={styles.tableScroll} role="region" aria-label="Invite keys" tabIndex={0}><table className={styles.table}>
      <thead><tr><th scope="col">Key</th><th scope="col">Created</th><th scope="col">Used by</th></tr></thead>
      <tbody>{keys.slice((currentPage - 1) * 20, currentPage * 20).map(key => <tr key={key.id}><td><code className={styles.keyDisplay}>{key.key}</code></td><td>{key.created_at?.split('T')[0]}</td><td>{key.used_by || 'Unused'}</td></tr>)}</tbody>
    </table></div>}
    {pages > 1 && <nav className={styles.pagination} aria-label="Invite key pages"><button className={styles.actionBtn} disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Previous</button><span className={styles.pageInfo}>Page {currentPage} of {pages}</span><button className={styles.actionBtn} disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>Next</button></nav>}
    {confirmation && <ConfirmAction confirmation={confirmation} onClose={() => setConfirmation(null)} onSuccess={load} />}
  </section>
}
