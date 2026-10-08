import { Link } from 'react-router-dom'
import { Logo } from '../components/common/Logo'
import { Icon } from '../components/common/Icon'
import styles from './NotFound.module.css'

export function NotFound() {
  return (
    <main className={styles.page}>
      <div className={styles.beam} aria-hidden="true" />
      <Link to="/" className={styles.logo} aria-label="MelodAI – zur Bühne"><Logo /></Link>
      <div className={styles.body}>
        <span className="kicker">404</span>
        <h1>Diese Seite steht nicht auf der Setlist.</h1>
        <p>Der Link ist alt oder hat einen Tippfehler.</p>
        <Link className="btn btn--primary btn--pill" to="/">Zur Bühne <Icon name="chevron-right" size={18} /></Link>
      </div>
    </main>
  )
}
