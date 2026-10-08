import type { ReactNode } from 'react'
import { Icon } from './Icon'
import type { IconName } from './icons'
import styles from './PageState.module.css'

/** Loading, empty and error states (§7). `error` renders the dashed error panel. */
export function PageState({ title, description, loading = false, action, error = false, icon, kicker, details }: {
  title: string
  description?: string
  loading?: boolean
  action?: ReactNode
  error?: boolean
  icon?: IconName
  kicker?: string
  details?: string
}) {
  // Backend messages often repeat the generic title; never print the same sentence twice.
  if (description && description.trim() === title.trim()) description = undefined
  if (error) {
    return (
      <div className={`error-panel ${styles.error}`} role="alert">
        <Icon name="alert" size={24} />
        <h2>{title}</h2>
        {description && <p>{description}</p>}
        {details && <details><summary>Details</summary><pre>{details}</pre></details>}
        {action && <div className={styles.action}>{action}</div>}
      </div>
    )
  }
  return <div className={`emptyState ${styles.state}`} role="status" aria-live="polite" aria-busy={loading}>
    {loading && <><span className="spinner spinner--lg" aria-hidden="true" /><span className="spinner-text">Lädt …</span></>}
    {!loading && icon && <Icon name={icon} size={48} />}
    {kicker && <span className="kicker">{kicker}</span>}
    <h2>{title}</h2>
    {description && <p>{description}</p>}
    {action && <div className="actions">{action}</div>}
  </div>
}
