import { useState, useEffect, useId, useRef, type ReactNode } from 'react'
import { Icon } from '../common/Icon'
import { NavList } from './NavList'
import { ThemeButton } from './Header'
import styles from './Sidebar.module.css'

interface Props {
  /** Setlist header (title, count, actions). */
  head?: ReactNode
  queueContent: ReactNode
  libraryContent: ReactNode
  queueCount?: number
  mobileOpen?: boolean
  onMobileClose?: () => void
  collapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
  isAdmin?: boolean
  theme?: 'light' | 'dark'
  onThemeToggle?: () => void
  onLogout?: () => void
}

/** Setlist panel (≥ 900, collapsible) and the right-hand drawer below 900 (§4.0, §5.9). */
export function Sidebar({
  head, queueContent, libraryContent, queueCount = 0, mobileOpen = false, onMobileClose,
  collapsed = false, onCollapsedChange, isAdmin = false, theme, onThemeToggle, onLogout,
}: Props) {
  const sidebarRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!mobileOpen) return
    const previous = document.activeElement as HTMLElement | null
    const sidebar = sidebarRef.current!
    sidebar.querySelector<HTMLButtonElement>('button')?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onMobileClose?.() }
      if (event.key === 'Tab') {
        const focusable = Array.from(sidebar.querySelectorAll<HTMLElement>('button, a, input, select, [tabindex="0"]')).filter(el => el.getClientRects().length && !el.hasAttribute('disabled'))
        const first = focusable[0], last = focusable[focusable.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); previous?.focus() }
  }, [mobileOpen, onMobileClose])
  const [activeTab, setActiveTab] = useState<'queue' | 'library'>('queue')
  const contentId = useId()
  const isCollapsed = collapsed && !mobileOpen

  const sidebarClass = [styles.sidebar, isCollapsed ? styles.collapsed : '', mobileOpen ? styles.open : ''].filter(Boolean).join(' ')

  return (
    <>
      {mobileOpen && <div className={styles.backdrop} onClick={onMobileClose} aria-hidden="true" />}
      <aside ref={sidebarRef} className={sidebarClass} aria-label="Setlist und Bibliothek"
        role={mobileOpen ? 'dialog' : undefined} aria-modal={mobileOpen || undefined}>
        <div className={styles.drawerHead}>
          <span className={styles.drawerTitle}>Menü</span>
          <button type="button" className="iconbtn" aria-label="Menü schließen" onClick={onMobileClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className={styles.drawerNav}>
          <NavList isAdmin={isAdmin} variant="drawer" onNavigate={onMobileClose} />
        </div>

        <button
          type="button"
          className={styles.toggle}
          onClick={() => onCollapsedChange?.(!collapsed)}
          title={collapsed ? 'Setlist einblenden' : 'Setlist ausblenden'}
          aria-label={collapsed ? `Setlist einblenden, ${queueCount} Songs` : 'Setlist ausblenden'}
          aria-expanded={!isCollapsed}
          aria-controls={contentId}
        >
          <Icon name={collapsed ? 'chevron-left' : 'chevron-right'} />
          {collapsed && queueCount > 0 && <span className={styles.collapsedCount} aria-hidden="true">{queueCount}</span>}
        </button>

        <div id={contentId} className={styles.content} hidden={isCollapsed}>
          {head}
          <div className={`seg ${styles.tabs}`} role="group" aria-label="Ansicht">
            <button type="button" className={styles.tab} aria-pressed={activeTab === 'queue'} data-testid="tab-queue" onClick={() => setActiveTab('queue')}>
              Warteschlange <span className="count">{queueCount}</span>
            </button>
            <button type="button" className={styles.tab} aria-pressed={activeTab === 'library'} data-testid="tab-library" onClick={() => setActiveTab('library')}>
              Bibliothek
            </button>
          </div>
          <div className={styles.panel} hidden={activeTab !== 'queue'}>{queueContent}</div>
          <div className={styles.panel} hidden={activeTab !== 'library'}>{libraryContent}</div>
        </div>

        <div className={styles.drawerFooter}>
          {onThemeToggle && <ThemeButton theme={theme} onToggle={onThemeToggle} withLabel />}
          {onLogout && <button type="button" className="btn btn--ghost" onClick={onLogout}><Icon name="logout" /> Abmelden</button>}
        </div>
      </aside>
    </>
  )
}
