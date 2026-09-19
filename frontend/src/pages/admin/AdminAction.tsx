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
      <button className={styles.actionBtn} disabled={busy} onClick={onClose}>Cancel</button>
      <button className={`${styles.primaryBtn} ${styles.dangerBtn}`} disabled={busy} onClick={async () => {
        setFailed(false)
        if (await run(confirmation.action, confirmation.success)) {
          onSuccess?.()
          onClose()
        } else {
          setFailed(true)
        }
      }}>{busy ? 'Saving…' : confirmation.label}</button>
    </>}>
      <p>{confirmation.description}</p>
      {failed && <p role="alert">The action failed. Your changes have not been confirmed. Please try again.</p>}
    </Modal>
  )
}
