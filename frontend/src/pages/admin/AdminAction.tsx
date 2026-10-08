import { useState } from 'react'
import { Modal } from '../../components/common/Modal'
import styles from '../AdminPage.module.css'

import { useAdminAction } from './useAdminAction'

export interface Confirmation {
  title: string
  description: string
  label: string
  action: () => Promise<unknown>
  success: string
  /** `danger` (default) for destructive actions, `neutral` for reversible ones. */
  tone?: 'danger' | 'neutral'
}

export function ConfirmAction({ confirmation, onClose, onSuccess }: {
  confirmation: Confirmation
  onClose: () => void
  onSuccess?: () => void
}) {
  const { busy, run } = useAdminAction()
  const [failed, setFailed] = useState(false)
  return (
    <Modal title={confirmation.title} onClose={onClose} busy={busy} size="small" footer={<>
      <button type="button" className="btn" disabled={busy} onClick={onClose}>Abbrechen</button>
      <button type="button" className={confirmation.tone === 'neutral' ? 'btn btn--primary' : 'btn btn--danger-solid'} disabled={busy} aria-busy={busy} onClick={async () => {
        setFailed(false)
        if (await run(confirmation.action, confirmation.success)) {
          onSuccess?.()
          onClose()
        } else {
          setFailed(true)
        }
      }}>{busy ? 'Wird ausgeführt …' : confirmation.label}</button>
    </>}>
      <p>{confirmation.description}</p>
      {failed && <p role="alert" className={styles.alert}>Das hat nicht geklappt. Es wurde nichts geändert. Versuch es noch einmal.</p>}
    </Modal>
  )
}
