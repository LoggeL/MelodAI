import { useState, type ReactNode } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChevronLeft, faChevronRight, faXmark, faListUl, faRecordVinyl } from '@fortawesome/free-solid-svg-icons'
import styles from './Sidebar.module.css'

interface Props {
  queueContent: ReactNode
  libraryContent: ReactNode
  mobileOpen?: boolean
  onMobileClose?: () => void
}

export function Sidebar({ queueContent, libraryContent, mobileOpen, onMobileClose }: Props) {
  const [collapsed, setCollapsed] = useState(false)
  const [activeTab, setActiveTab] = useState<'queue' | 'library'>('library')

  const sidebarClass = [
    styles.sidebar,
    collapsed ? styles.collapsed : '',
    mobileOpen ? styles.open : '',
  ].filter(Boolean).join(' ')

  return (
    <>
      {mobileOpen && <div className={styles.backdrop} onClick={onMobileClose} />}
      <aside className={sidebarClass}>
        <div className={styles.header}>
          <img src="/logo.svg" alt="MelodAI" />
          <h1 className={styles.logoText}>Melod<span className={styles.logoAccent}>AI</span></h1>
          <button className={styles.mobileClose} onClick={onMobileClose}>
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>

        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${activeTab === 'queue' ? styles.tabActive : ''}`}
            onClick={() => setActiveTab('queue')}
          >
            <FontAwesomeIcon icon={faListUl} className={styles.tabIcon} />
            Queue
          </button>
          <button
            className={`${styles.tab} ${activeTab === 'library' ? styles.tabActive : ''}`}
            onClick={() => setActiveTab('library')}
          >
            <FontAwesomeIcon icon={faRecordVinyl} className={styles.tabIcon} />
            Library
          </button>
        </div>

        <div className={styles.content}>
          {activeTab === 'queue' ? queueContent : libraryContent}
        </div>

        <button
          className={styles.toggle}
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <FontAwesomeIcon icon={collapsed ? faChevronRight : faChevronLeft} />
        </button>
      </aside>
    </>
  )
}
