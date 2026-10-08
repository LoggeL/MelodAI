import type { ReactNode } from 'react'
import { Icon } from '../../components/common/Icon'
import { PageState } from '../../components/common/PageState'
import { formatInt } from '../../utils/format'
import styles from '../AdminPage.module.css'

/** Previous / next pager used by every Backstage table. */
export function Pagination({ page, pages, onPage, label }: { page: number; pages: number; onPage: (page: number) => void; label: string }) {
  if (pages <= 1) return null
  return <nav className={styles.pagination} aria-label={label}>
    <button type="button" className={styles.actionBtn} disabled={page <= 1} onClick={() => onPage(page - 1)}><Icon name="chevron-left" size={16} /> Zurück</button>
    <span className={styles.pageInfo}>Seite {formatInt(page)} von {formatInt(pages)}</span>
    <button type="button" className={styles.actionBtn} disabled={page >= pages} onClick={() => onPage(page + 1)}>Weiter <Icon name="chevron-right" size={16} /></button>
  </nav>
}

export function SearchField({ label, placeholder, value, onChange }: { label: string; placeholder: string; value: string; onChange: (value: string) => void }) {
  return <label className={styles.searchWrap}>
    <span className="sr-only">{label}</span>
    <Icon name="search" size={18} className={styles.searchIcon} />
    <input type="search" className={`input ${styles.filterInput}`} placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} />
  </label>
}

export function SectionHead({ title, count, children, level = 2 }: { title: string; count?: number; children?: ReactNode; level?: 2 | 3 }) {
  const Heading = level === 2 ? 'h2' : 'h3'
  return <div className={styles.sectionHeader}>
    <Heading>{title}{count != null && <span className={styles.headCount}>{formatInt(count)}</span>}</Heading>
    {children && <div className={styles.rowActions}>{children}</div>}
  </div>
}

export function LoadError({ title, error, onRetry }: { title: string; error: string; onRetry: () => void }) {
  return <PageState error title={title} description={error} action={<button type="button" className="btn" onClick={onRetry}><Icon name="redo" /> Erneut versuchen</button>} />
}

export function Updating({ active }: { active: boolean }) {
  return <span className={styles.updating} role="status">{active && <><span className="spinner" aria-hidden="true" /> Wird aktualisiert …</>}</span>
}
