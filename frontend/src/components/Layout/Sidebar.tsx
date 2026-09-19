import { useState, useEffect, useId, useRef, type ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChevronLeft, faChevronRight, faXmark, faListUl, faCompactDisc } from '@fortawesome/free-solid-svg-icons'
import styles from './Sidebar.module.css'

interface Props {
  queueContent: ReactNode
  libraryContent: ReactNode
  mobileOpen?: boolean
  onMobileClose?: () => void
}

export function Sidebar({ queueContent, libraryContent, mobileOpen, onMobileClose }: Props) {
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
  const [collapsed, setCollapsed] = useState(false)
  const [activeTab, setActiveTab] = useState<'queue' | 'library'>('library')
  const contentId = useId()
  const isCollapsed = collapsed && !mobileOpen

  const sidebarClass = [
    styles.sidebar,
    isCollapsed ? styles.collapsed : '',
    mobileOpen ? styles.open : '',
  ].filter(Boolean).join(' ')

  return (
    <>
      {mobileOpen && <div className={styles.backdrop} onClick={onMobileClose} />}
      <aside ref={sidebarRef} className={sidebarClass} aria-label="Library and queue" role={mobileOpen ? 'dialog' : undefined} aria-modal={mobileOpen || undefined}>
        <div className={styles.header} hidden={isCollapsed}>
          <div className={styles.brand}>
            <img src="/logo.svg" alt="MelodAI" className={styles.logo} />
            <h1 className={styles.logoText}>Melod<span className={styles.logoAccent}>AI</span></h1>
          </div>
          <button className={styles.mobileClose} aria-label="Close library and queue" onClick={onMobileClose}>
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>

        <nav className={styles.mobileNav} aria-label="Main navigation" hidden={isCollapsed}>
          <NavLink to="/">Player</NavLink><NavLink to="/library">Library</NavLink><NavLink to="/profile">Profile</NavLink>
        </nav>
        <div className={styles.tabBar} role="group" aria-label="Sidebar view" hidden={isCollapsed}>
          <div
            className={styles.tabIndicator}
            style={{ transform: activeTab === 'queue' ? 'translateX(0)' : 'translateX(100%)' }}
          />
          <button
            className={`${styles.tab} ${activeTab === 'queue' ? styles.tabActive : ''}`}
            aria-pressed={activeTab === 'queue'}
            onClick={() => setActiveTab('queue')}
          >
            <FontAwesomeIcon icon={faListUl} className={styles.tabIcon} />
            <span>Queue</span>
          </button>
          <button
            className={`${styles.tab} ${activeTab === 'library' ? styles.tabActive : ''}`}
            aria-pressed={activeTab === 'library'}
            onClick={() => setActiveTab('library')}
          >
            <FontAwesomeIcon icon={faCompactDisc} className={styles.tabIcon} />
            <span>Library</span>
          </button>
        </div>

        <div id={contentId} className={styles.content} hidden={isCollapsed}>
          <div className={`${styles.panel} ${activeTab === 'queue' ? styles.panelActive : ''}`} hidden={activeTab !== 'queue'}>
            {queueContent}
          </div>
          <div className={`${styles.panel} ${activeTab === 'library' ? styles.panelActive : ''}`} hidden={activeTab !== 'library'}>
            {libraryContent}
          </div>
        </div>

        <button
          className={styles.toggle}
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!isCollapsed}
          aria-controls={contentId}
        >
          <FontAwesomeIcon icon={collapsed ? faChevronRight : faChevronLeft} />
        </button>
      </aside>
    </>
  )
}
