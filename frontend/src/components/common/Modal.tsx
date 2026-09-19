import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import styles from './Modal.module.css'

interface Props {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  size?: 'small' | 'medium' | 'large'
  busy?: boolean
}

/** Native dialog owns focus trapping, Escape, and restoration to the opener. */
export function Modal({ title, onClose, children, footer, size = 'medium', busy = false }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const notifications = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useEffect(() => {
    const element = dialog.current!
    const notificationContainer = notifications.current!
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
    }
  }, [])
  return createPortal(
    <dialog ref={dialog} className={`${styles.dialog} ${styles[size]}`} aria-labelledby={titleId} aria-busy={busy}
      onCancel={event => { event.preventDefault(); if (!busy) onClose() }}
      onClick={event => {
        if (event.target !== event.currentTarget || busy) return
        const rect = event.currentTarget.getBoundingClientRect()
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose()
      }}>
      <div ref={notifications} data-dialog-notifications className={styles.notifications} aria-label="Notifications" />
      <header className={styles.header}>
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose} disabled={busy}>×</button>
      </header>
      <div className={styles.body}>{children}</div>
      {footer && <footer className={styles.footer}>{footer}</footer>}
    </dialog>, document.body,
  )
}
