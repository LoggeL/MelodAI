import { useState, useEffect, useId, type FormEvent } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { auth } from '../services/api'
import { useAuth } from '../hooks/useAuth'
import { errorMessage } from './account/errors'
import { Logo } from '../components/common/Logo'
import { Icon } from '../components/common/Icon'
import { de } from '../utils/messages'
import { PIPELINE_STEPS } from '../utils/pipeline'
import styles from './LoginPage.module.css'

/** Password field with a „Zeigen“ toggle (§4.6). */
function PasswordInput({ id, name, autoComplete, minLength, describedBy }: { id: string; name: string; autoComplete: string; minLength?: number; describedBy?: string }) {
  const [visible, setVisible] = useState(false)
  return (
    <div className={styles.password}>
      <input id={id} name={name} type={visible ? 'text' : 'password'} className="input" required minLength={minLength}
        autoComplete={autoComplete} aria-describedby={describedBy} />
      <button type="button" className={styles.reveal} onClick={() => setVisible(v => !v)} aria-pressed={visible}
        aria-label={visible ? 'Passwort verbergen' : 'Passwort zeigen'}>
        <Icon name={visible ? 'eye-off' : 'eye'} size={18} /><span>{visible ? 'Verbergen' : 'Zeigen'}</span>
      </button>
    </div>
  )
}

type AuthTab = 'login' | 'register' | 'forgot' | 'reset'

export function LoginPage() {
  const [tab, setTab] = useState<AuthTab>('login')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const { checked, authenticated, check } = useAuth()
  const requestedPath = (location.state as { from?: string } | null)?.from || new URLSearchParams(location.search).get('returnTo') || '/'
  const returnTo = typeof requestedPath === 'string' && requestedPath.startsWith('/') && !requestedPath.startsWith('//') && !requestedPath.startsWith('/login') ? requestedPath : '/'

  // Check for reset token in hash
  const [resetToken, setResetToken] = useState('')
  useEffect(() => {
    const hash = window.location.hash
    if (hash.startsWith('#reset=')) {
      setResetToken(hash.slice(7))
      setTab('reset')
    }
  }, [])

  useEffect(() => {
    if (checked && authenticated) navigate(returnTo, { replace: true })
  }, [checked, authenticated, navigate, returnTo])

  const switchTab = (nextTab: AuthTab) => {
    if (loading) return
    setTab(nextTab)
    setMessage(null)
  }

  const handleLogin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (loading) return
    setLoading(true)
    setMessage(null)
    const form = new FormData(e.currentTarget)
    try {
      const data = await auth.login(
        String(form.get('username') || '').trim(),
        form.get('password') as string,
        form.get('remember') === 'on'
      )
      if (data.success) {
        await check()
        navigate(returnTo, { replace: true })
      } else {
        setMessage({ type: 'error', text: data.error ? de(data.error) : 'Anmeldung fehlgeschlagen.' })
      }
    } catch (error) {
      setMessage({ type: 'error', text: errorMessage(error, 'Keine Verbindung. Bitte versuch es noch einmal.') })
    } finally {
      setLoading(false)
    }
  }

  const handleRegister = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (loading) return
    setLoading(true)
    setMessage(null)
    const form = new FormData(e.currentTarget)
    const password = form.get('password') as string
    try {
      const data = await auth.register(
        String(form.get('username') || '').trim(),
        String(form.get('email') || '').trim(),
        password,
        form.get('invite_key') as string || ''
      )
      if (data.success && !data.pending) {
        await check()
        navigate(returnTo, { replace: true })
      } else if (data.pending) {
        setMessage({ type: 'success', text: data.message ? de(data.message) : 'Registrierung eingegangen. Sie wartet auf die Freigabe durch einen Admin.' })
      } else {
        setMessage({ type: 'error', text: data.error ? de(data.error) : 'Registrierung fehlgeschlagen.' })
      }
    } catch (error) {
      setMessage({ type: 'error', text: errorMessage(error, 'Keine Verbindung. Bitte versuch es noch einmal.') })
    } finally {
      setLoading(false)
    }
  }

  const handleForgot = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (loading) return
    setLoading(true)
    setMessage(null)
    const form = new FormData(e.currentTarget)
    try {
      const data = await auth.forgotPassword(String(form.get('username') || '').trim())
      if (data.success === false) {
        setMessage({ type: 'error', text: data.message ? de(data.message) : 'Der Link konnte nicht angefordert werden. Bitte versuch es noch einmal.' })
      } else {
        setMessage({ type: 'success', text: data.message ? de(data.message) : 'Falls das Konto existiert, ist eine E-Mail zum Zurücksetzen unterwegs.' })
      }
    } catch (error) {
      setMessage({ type: 'error', text: errorMessage(error, 'Keine Verbindung. Bitte versuch es noch einmal.') })
    } finally {
      setLoading(false)
    }
  }

  const handleReset = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (loading) return
    setLoading(true)
    setMessage(null)
    const form = new FormData(e.currentTarget)
    try {
      const data = await auth.resetPassword(resetToken, form.get('password') as string)
      if (data.success) {
        setResetToken('')
        window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
        setTab('login')
        setMessage({ type: 'success', text: 'Passwort zurückgesetzt. Melde dich mit dem neuen Passwort an.' })
      } else {
        setMessage({ type: 'error', text: data.error ? de(data.error) : 'Zurücksetzen fehlgeschlagen.' })
      }
    } catch (error) {
      setMessage({ type: 'error', text: errorMessage(error, 'Keine Verbindung. Bitte versuch es noch einmal.') })
    } finally {
      setLoading(false)
    }
  }

  const authTitle = tab === 'register' ? 'Bühne frei für dich.'
    : tab === 'forgot' ? 'Passwort vergessen'
    : tab === 'reset' ? 'Neues Passwort'
    : 'Willkommen zurück.'
  const authSubtitle = tab === 'register' ? 'Leg dein Konto an und such dir deinen ersten Song aus.'
    : tab === 'forgot' ? 'Gib Benutzername oder E-Mail ein, wir schicken dir einen Link.'
    : tab === 'reset' ? 'Wähl ein neues Passwort und ab auf die Bühne.'
    : 'Melde dich an und such dir den nächsten Song aus.'

  return (
    <div className={styles.page}>
      <section className={styles.stage} aria-labelledby="login-hero">
        <div className={styles.beam} aria-hidden="true" />
        <Link to="/about" className={styles.logo} aria-label="Über MelodAI"><Logo /></Link>
        <div className={styles.hero}>
          <span className="kicker">Private Karaoke-Bühne</span>
          <h1 id="login-hero" className={styles.headline}>
            <s className={styles.strike}>Gesang</s> raus. <em>Du</em> rein.
          </h1>
          <p className={styles.dek}>MelodAI macht aus fast jedem Song Karaoke: Stimme trennen, Wörter timen, mitsingen.</p>
        </div>
        <ol className={styles.pipeline} aria-label="So funktioniert MelodAI">
          {PIPELINE_STEPS.map((step, index) => (
            <li key={step.no} data-tone={index < 3 ? 'vocal' : 'inst'}><b>{step.no}</b><span>{step.label}</span></li>
          ))}
        </ol>
        <p className={styles.footer}>Ein LMF-Projekt · Kapitel III</p>
      </section>

      <main className={styles.panel}>
        <section className={styles.card} aria-labelledby="auth-title">
          {tab !== 'reset' && tab !== 'forgot' && (
            <div className={`seg ${styles.modes}`} role="group" aria-label="Anmelden oder registrieren">
              <button type="button" aria-pressed={tab === 'login'} disabled={loading} onClick={() => switchTab('login')}>Anmelden</button>
              <button type="button" aria-pressed={tab === 'register'} disabled={loading} onClick={() => switchTab('register')}>Registrieren</button>
            </div>
          )}
          <div className={styles.cardHead}>
            <h2 id="auth-title">{authTitle}</h2>
            <p>{authSubtitle}</p>
          </div>

          {message && (
            <div role={message.type === 'error' ? 'alert' : 'status'} className={`${styles.message} ${message.type === 'error' ? styles.messageError : styles.messageSuccess}`}>
              <Icon name={message.type === 'error' ? 'alert' : 'check'} size={20} />
              <span>{message.text}</span>
            </div>
          )}

          {tab === 'login' && (
            <form onSubmit={handleLogin} className={styles.form} aria-busy={loading}><fieldset className={styles.fields} disabled={loading}>
              <div className="field">
                <label htmlFor="login-username">Benutzername oder E-Mail</label>
                <input id="login-username" name="username" className="input" required autoComplete="username" />
              </div>
              <div className="field">
                <label htmlFor="login-password">Passwort</label>
                <PasswordInput id="login-password" name="password" autoComplete="current-password" />
              </div>
              <div className={styles.row}>
                <label className="check"><input type="checkbox" name="remember" /> Angemeldet bleiben</label>
                <button type="button" className={styles.link} onClick={() => switchTab('forgot')}>Passwort vergessen?</button>
              </div>
              <button type="submit" className="btn btn--primary btn--block" disabled={loading}>
                {loading ? <><span className="spinner" aria-hidden="true" /> Wird angemeldet …</> : <>Auf die Bühne <Icon name="chevron-right" size={18} /></>}
              </button>
            </fieldset></form>
          )}

          {tab === 'register' && <RegisterFields loading={loading} onSubmit={handleRegister} />}

          {tab === 'forgot' && (
            <form onSubmit={handleForgot} className={styles.form} aria-busy={loading}><fieldset className={styles.fields} disabled={loading}>
              <div className="field">
                <label htmlFor="forgot-username">Benutzername oder E-Mail</label>
                <input id="forgot-username" name="username" className="input" required autoComplete="username" />
              </div>
              <button type="submit" className="btn btn--primary btn--block" disabled={loading}>{loading ? 'Wird gesendet …' : 'Link senden'}</button>
              <button type="button" className="btn btn--ghost" onClick={() => switchTab('login')}><Icon name="arrow-left" size={18} /> Zurück zur Anmeldung</button>
            </fieldset></form>
          )}

          {tab === 'reset' && (
            <form onSubmit={handleReset} className={styles.form} aria-busy={loading}><fieldset className={styles.fields} disabled={loading}>
              <div className="field">
                <label htmlFor="reset-password">Neues Passwort</label>
                <PasswordInput id="reset-password" name="password" autoComplete="new-password" minLength={8} describedBy="reset-password-help" />
                <span id="reset-password-help" className="field-help">Mindestens 8 Zeichen.</span>
              </div>
              <button type="submit" className="btn btn--primary btn--block" disabled={loading}>{loading ? 'Wird gespeichert …' : 'Passwort speichern'}</button>
            </fieldset></form>
          )}
        </section>
      </main>
    </div>
  )
}

function RegisterFields({ loading, onSubmit }: { loading: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const helpId = useId()
  return (
    <form onSubmit={onSubmit} className={styles.form} aria-busy={loading}><fieldset className={styles.fields} disabled={loading}>
      <div className="field">
        <label htmlFor="register-username">Benutzername</label>
        <input id="register-username" name="username" className="input" required autoComplete="username" />
      </div>
      <div className="field">
        <label htmlFor="register-email">E-Mail</label>
        <input id="register-email" name="email" type="email" className="input" required autoComplete="email" />
      </div>
      <div className="field">
        <label htmlFor="register-password">Passwort</label>
        <PasswordInput id="register-password" name="password" autoComplete="new-password" minLength={8} describedBy={helpId} />
        <span id={helpId} className="field-help">Mindestens 8 Zeichen.</span>
      </div>
      <div className="field">
        <label htmlFor="invite-key">Einladungsschlüssel <span className={styles.optional}>optional</span></label>
        <input id="invite-key" name="invite_key" className="input" autoComplete="off" />
      </div>
      <button type="submit" className="btn btn--primary btn--block" disabled={loading}>{loading ? 'Konto wird erstellt …' : 'Konto erstellen'}</button>
      <p className={styles.invite}>Neu hier? Mit Einladungsschlüssel bist du sofort dabei. Ohne Schlüssel schaltet dich ein Admin frei.</p>
    </fieldset></form>
  )
}
