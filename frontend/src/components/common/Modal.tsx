import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'
import styles from './Modal.module.css'

interface Props {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  size?: 'small' | 'medium' | 'large'
  busy?: boolean
  /** Bottom sheet on phones (Ton, mobile options); a centred dialog otherwise. */
  variant?: 'dialog' | 'sheet'
}

/** Native dialog owns focus trapping, Escape, and restoration to the opener. */
export function Modal({ title, onClose, children, footer, size = 'medium', busy = false, variant = 'dialog' }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const notifications = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useEffect(() => {
    const element = dialog.current!
    const notificationContainer = notifications.current!
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    element.showModal()
    return () => {
      element.close()
      // Successful mutations often close the dialog immediately. Keep their
      // feedback visible for its remaining lifetime after the dialog unmounts.
      const globalNotifications = document.getElementById('toast-container')
      if (globalNotifications) {
        while (notificationContainer.firstChild) globalNotifications.appendChild(notificationContainer.firstChild)
        while (globalNotifications.children.length > 4) globalNotifications.firstElementChild?.remove()
      }
      // React may remove the portal before close() restores native focus.
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [])
  return createPortal(
    <dialog ref={dialog} className={`${styles.dialog} ${styles[size]} ${variant === 'sheet' ? styles.sheet : ''}`} aria-labelledby={titleId} aria-busy={busy}
      onCancel={event => { event.preventDefault(); if (!busy) onClose() }}
      onClick={event => {
        if (event.target !== event.currentTarget || busy) return
        const rect = event.currentTarget.getBoundingClientRect()
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose()
      }}>
      <div ref={notifications} data-dialog-notifications className={styles.notifications} aria-label="Benachrichtigungen" />
      {variant === 'sheet' && <span className={styles.handle} aria-hidden="true" />}
      <header className={styles.header}>
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="iconbtn" aria-label="Dialog schließen" onClick={onClose} disabled={busy}><Icon name="x" /></button>
      </header>
      <div className={styles.body}>{children}</div>
      {footer && <footer className={styles.footer}>{footer}</footer>}
    </dialog>, document.body,
  )
}
