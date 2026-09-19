import type { ReactNode } from 'react'
import styles from './PageState.module.css'

export function PageState({ title, description, loading = false, action }: {
  title: string
  description?: string
  loading?: boolean
  action?: ReactNode
}) {
  return <div className={styles.state} role="status" aria-live="polite" aria-busy={loading}>
    {loading && <span className={styles.spinner} aria-hidden="true" />}
    <h2>{title}</h2>
    {description && <p>{description}</p>}
    {action && <div className={styles.action}>{action}</div>}
  </div>
}
