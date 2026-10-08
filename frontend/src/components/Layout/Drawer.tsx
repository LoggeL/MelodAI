import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Icon } from '../common/Icon'
import styles from './Drawer.module.css'

interface Props {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}

/** Right-hand drawer below 900 px (§4.0): dialog semantics, focus trap, Esc, inert page behind. */
export function Drawer({ open, title, onClose, children, footer }: Props) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const panel = panelRef.current!
    const main = document.querySelector('main')
    main?.setAttribute('inert', '')
    panel.querySelector<HTMLElement>('button')?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose() }
      if (event.key === 'Tab') {
        const focusable = Array.from(panel.querySelectorAll<HTMLElement>('button, a, input, select, [tabindex="0"]')).filter(el => el.getClientRects().length && !el.hasAttribute('disabled'))
        const first = focusable[0], last = focusable[focusable.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); main?.removeAttribute('inert'); previous?.focus() }
  }, [open, onClose])
  if (!open) return null
  return (
    <>
      <div className={styles.scrim} onClick={onClose} aria-hidden="true" />
      <div ref={panelRef} className={styles.panel} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className={styles.head}>
          <h2 id={titleId} className={styles.title}>{title}</h2>
          <button type="button" className="iconbtn" aria-label="Menü schließen" onClick={onClose}><Icon name="x" /></button>
        </div>
        <div className={styles.body}>{children}</div>
        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </>
  )
}
