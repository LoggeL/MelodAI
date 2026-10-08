import styles from './Logo.module.css'

/** Monoline microphone: capsule half red (Gesang), half blue (Instrumental/KI). */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path d="M16 3a5.5 5.5 0 0 0-5.5 5.5v5A5.5 5.5 0 0 0 16 19z" fill="var(--vocal)" />
      <path d="M16 3a5.5 5.5 0 0 1 5.5 5.5v5A5.5 5.5 0 0 1 16 19z" fill="var(--inst)" />
      <path d="M6.5 14.5a9.5 9.5 0 0 0 19 0M16 24v5M11 29h10" fill="none" stroke="var(--ink)" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  )
}

export function Wordmark({ className }: { className?: string }) {
  return <span className={`${styles.wordmark} ${className ?? ''}`}>Melod<b>AI</b></span>
}

export function Logo({ className, hideWordmarkOnTiny = false }: { className?: string; hideWordmarkOnTiny?: boolean }) {
  return (
    <span className={`${styles.brand} ${hideWordmarkOnTiny ? styles.squeeze : ''} ${className ?? ''}`}>
      <LogoMark />
      <Wordmark />
    </span>
  )
}

/** Missing cover: the logo mark on a stage-3 square. */
export function CoverFallback({ className }: { className?: string }) {
  return (
    <span className={`${styles.fallback} ${className ?? ''}`} aria-hidden="true">
      <svg viewBox="0 0 32 32" focusable="false">
        <path d="M16 3a5.5 5.5 0 0 0-5.5 5.5v5a5.5 5.5 0 0 0 11 0v-5A5.5 5.5 0 0 0 16 3zM6.5 14.5a9.5 9.5 0 0 0 19 0M16 24v5M11 29h10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </span>
  )
}
