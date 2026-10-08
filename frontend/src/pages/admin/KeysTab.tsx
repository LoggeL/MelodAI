import { useAdminAction } from './useAdminAction'
import { errorMessage } from '../account/errors'
import { useCallback, useEffect, useRef, useState } from 'react'
import { admin } from '../../services/api'
import { useToast } from '../../hooks/useToast'
import { Icon } from '../../components/common/Icon'
import { PageState } from '../../components/common/PageState'
import type { InviteKey } from '../../types'
import { formatDateTime, formatInt } from '../../utils/format'
import { ConfirmAction, type Confirmation } from './AdminAction'
import { LoadError, Pagination, SectionHead } from './shared'
import styles from '../AdminPage.module.css'

function CopyButton({ value }: { value: string }) {
  const toast = useToast()
  return <button type="button" className={`${styles.actionBtn} ${styles.iconOnly}`} aria-label="Schlüssel kopieren" title="Kopieren" onClick={async () => {
    try { await navigator.clipboard.writeText(value); toast.success('Schlüssel kopiert.') }
    catch { toast.error('Kopieren ging nicht. Markier den Schlüssel und kopier ihn von Hand.') }
  }}><Icon name="copy" size={16} /></button>
}

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
  if (loading) return <PageState title="Schlüssel werden geladen …" loading />
  if (error) return <LoadError title="Die Einladungsschlüssel konnten nicht geladen werden." error={error} onRetry={load} />
  return <section className={styles.section}>
    <div className={`stats ${styles.statStrip}`}>
      <div className="stat"><b>{formatInt(keys.length)}</b><span className="kicker">Schlüssel</span></div>
      <div className="stat"><b>{formatInt(keys.length - usedCount)}</b><span className="kicker">Frei</span></div>
      <div className="stat"><b>{formatInt(usedCount)}</b><span className="kicker">Eingelöst</span></div>
    </div>
    <SectionHead title="Einladungsschlüssel" count={keys.length}>
      {usedCount > 0 && <button type="button" className={`${styles.actionBtn} ${styles.danger}`} disabled={busy} onClick={() => setConfirmation({ title: 'Eingelöste Schlüssel entfernen?', description: `${usedCount} eingelöste ${usedCount === 1 ? 'Schlüssel wird' : 'Schlüssel werden'} aus der Liste entfernt. Die Konten bleiben bestehen.`, label: 'Entfernen', action: admin.deleteUsedInviteKeys, success: 'Eingelöste Schlüssel entfernt.' })}><Icon name="trash" size={16} /> Eingelöste entfernen ({formatInt(usedCount)})</button>}
      <button type="button" className="btn btn--primary" disabled={busy} aria-busy={busy} onClick={async () => { if (await run(async () => { const result = await admin.generateInviteKey(); setNewKey(result.key) }, 'Einladungsschlüssel erstellt.')) void load() }}><Icon name="plus" /> {busy ? 'Wird erstellt …' : 'Einladungsschlüssel erstellen'}</button>
    </SectionHead>
    {newKey && <div className={styles.notice} role="status">
      <span className="kicker">Neuer Schlüssel</span>
      <div className={styles.keyRow}><code className={styles.keyDisplay}>{newKey}</code><CopyButton value={newKey} /></div>
      <p>Schick ihn an deinen Gast. Wer sich damit registriert, ist sofort freigeschaltet.</p>
    </div>}
    {keys.length === 0 ? <PageState icon="key" title="Noch keine Schlüssel." description="Erstell einen Schlüssel, damit jemand ohne Wartezeit mitmachen kann." /> : <div className="table-wrap">
      <table className="table table--cards">
        <thead><tr><th scope="col">Schlüssel</th><th scope="col">Status</th><th scope="col">Benutzt von</th><th scope="col">Erstellt</th></tr></thead>
        <tbody>{keys.slice((currentPage - 1) * 20, currentPage * 20).map(key => <tr key={key.id}>
          <td className="cell-main"><div className={styles.keyRow}><code className={styles.keyDisplay}>{key.key}</code>{!key.used_by && <CopyButton value={key.key} />}</div></td>
          <td data-label="Status" className="cell-inline"><span className={`chip ${key.used_by ? '' : 'chip--ok'}`}>{key.used_by ? 'Eingelöst' : 'Frei'}</span></td>
          <td data-label="Benutzt von" className="cell-inline">{key.used_by || <span className={styles.subtle}>–</span>}{key.used_at && <span className={`${styles.subtle} ${styles.mono}`}>{formatDateTime(key.used_at)}</span>}</td>
          <td data-label="Erstellt" className={`cell-inline ${styles.mono} ${styles.nowrap}`}>{formatDateTime(key.created_at)}</td>
        </tr>)}</tbody>
      </table>
    </div>}
    <Pagination page={currentPage} pages={pages} onPage={setPage} label="Seiten der Schlüsselliste" />
    {confirmation && <ConfirmAction confirmation={confirmation} onClose={() => setConfirmation(null)} onSuccess={load} />}
  </section>
}
