import { useState, useEffect, type FormEvent } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { auth } from '../services/api'
import styles from './LoginPage.module.css'

type AuthTab = 'login' | 'register' | 'forgot' | 'reset'

export function LoginPage() {
  const [tab, setTab] = useState<AuthTab>('login')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const returnTo = (location.state as { from?: string } | null)?.from || '/'

  // Check for reset token in hash
  const [resetToken, setResetToken] = useState('')
  useEffect(() => {
    const hash = window.location.hash
    if (hash.startsWith('#reset=')) {
      setResetToken(hash.slice(7))
      setTab('reset')
    }
    // Check if already logged in
    auth.check().then(data => {
      if (data.authenticated) navigate(returnTo)
    })
  }, [navigate, returnTo])

  const switchTab = (nextTab: AuthTab) => {
    setTab(nextTab)
    setMessage(null)
  }

  const handleLogin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)
    const form = new FormData(e.currentTarget)
    try {
      const data = await auth.login(
        form.get('username') as string,
        form.get('password') as string,
        form.get('remember') === 'on'
      )
      if (data.success) {
        navigate(returnTo)
      } else {
        setMessage({ type: 'error', text: data.error || 'Login failed' })
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error — please try again' })
    } finally {
      setLoading(false)
    }
  }

  const handleRegister = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)
    const form = new FormData(e.currentTarget)
    const password = form.get('password') as string
    const confirm = form.get('confirm_password') as string
    if (password !== confirm) {
      setMessage({ type: 'error', text: 'Passwords do not match' })
      setLoading(false)
      return
    }
    try {
      const data = await auth.register(
        form.get('username') as string,
        form.get('email') as string,
        password,
        form.get('invite_key') as string || ''
      )
      if (data.success && !data.pending) {
        navigate(returnTo)
      } else if (data.pending) {
        setMessage({ type: 'success', text: data.message || 'Waiting for approval' })
      } else {
        setMessage({ type: 'error', text: data.error || 'Registration failed' })
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error — please try again' })
    } finally {
      setLoading(false)
    }
  }

  const handleForgot = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)
    const form = new FormData(e.currentTarget)
    try {
      const data = await auth.forgotPassword(form.get('username') as string)
      setMessage({ type: 'success', text: data.message || 'Check your email' })
    } catch {
      setMessage({ type: 'error', text: 'Network error — please try again' })
    } finally {
      setLoading(false)
    }
  }

  const handleReset = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)
    const form = new FormData(e.currentTarget)
    try {
      const data = await auth.resetPassword(resetToken, form.get('password') as string)
      if (data.success) {
        setMessage({ type: 'success', text: 'Password reset! You can now login.' })
        window.location.hash = ''
        setTimeout(() => setTab('login'), 2000)
      } else {
        setMessage({ type: 'error', text: data.error || 'Reset failed' })
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error — please try again' })
    } finally {
      setLoading(false)
    }
  }

  const authTitle = tab === 'register'
    ? 'Create your stage account'
    : tab === 'forgot'
      ? 'Recover your account'
      : tab === 'reset'
        ? 'Choose a new password'
        : 'Welcome back'

  const authSubtitle = tab === 'register'
    ? 'Register with an invite key for instant access, or wait for approval.'
    : tab === 'forgot'
      ? 'Enter your username or email and we’ll send a reset link.'
      : tab === 'reset'
        ? 'Set a fresh password and jump back into the queue.'
        : 'Sign in to search, queue, and sing your AI-powered karaoke library.'

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <aside className={styles.brandPanel} aria-label="MelodAI overview">
          <Link to="/" className={styles.logoLockup} aria-label="MelodAI home">
            <img src="/logo.svg" alt="" />
            <div>
              <div className={styles.logoTitle}>Melod<span className={styles.logoAccent}>AI</span></div>
              <p className={styles.logoSub}>AI-Powered Karaoke</p>
            </div>
          </Link>

          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>Private karaoke lab</p>
            <h1>Turn any song into a stage-ready karaoke session.</h1>
            <p>MelodAI separates vocals, extracts synced lyrics, and gives you a focused player built for singing along.</p>
          </div>

          <div className={styles.featureGrid}>
            <div className={styles.featureCard}>
              <span>🎙️</span>
              <strong>Vocal split</strong>
              <p>Control vocals and instrumental tracks independently.</p>
            </div>
            <div className={styles.featureCard}>
              <span>✨</span>
              <strong>Timed lyrics</strong>
              <p>Word-level highlighting for proper karaoke timing.</p>
            </div>
            <div className={styles.featureCard}>
              <span>📚</span>
              <strong>Your library</strong>
              <p>Keep processed songs ready for the next session.</p>
            </div>
          </div>
        </aside>

        <main className={styles.authPanel}>
          <div className={styles.mobileBrand}>
            <img src="/logo.svg" alt="" />
            <div className={styles.logoTitle}>Melod<span className={styles.logoAccent}>AI</span></div>
          </div>

          <section className={styles.card} aria-labelledby="auth-title">
            <div className={styles.cardHeader}>
              <p className={styles.eyebrow}>{tab === 'register' ? 'Request access' : 'Member access'}</p>
              <h2 id="auth-title">{authTitle}</h2>
              <p>{authSubtitle}</p>
            </div>

            {tab !== 'reset' && tab !== 'forgot' && (
              <div className={styles.tabs} role="tablist" aria-label="Authentication mode">
                <button type="button" className={`${styles.tab} ${tab === 'login' ? styles.tabActive : ''}`} onClick={() => switchTab('login')}>Login</button>
                <button type="button" className={`${styles.tab} ${tab === 'register' ? styles.tabActive : ''}`} onClick={() => switchTab('register')}>Register</button>
              </div>
            )}

            {message && (
              <div className={`${styles.message} ${message.type === 'error' ? styles.messageError : styles.messageSuccess}`}>
                {message.text}
              </div>
            )}

            {tab === 'login' && (
              <form onSubmit={handleLogin} className={styles.form}>
                <div className={styles.group}>
                  <label htmlFor="login-username">Username / Email</label>
                  <input id="login-username" name="username" className={styles.input} placeholder="you@example.com" required autoComplete="username" />
                </div>
                <div className={styles.group}>
                  <label htmlFor="login-password">Password</label>
                  <input id="login-password" name="password" type="password" className={styles.input} placeholder="••••••••" required autoComplete="current-password" />
                </div>
                <div className={styles.formRow}>
                  <div className={styles.check}>
                    <input type="checkbox" name="remember" id="remember" />
                    <label htmlFor="remember">Remember me for 30 days</label>
                  </div>
                  <button type="button" className={styles.textButton} onClick={() => switchTab('forgot')}>Forgot password?</button>
                </div>
                <button type="submit" className={styles.submit} disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</button>
              </form>
            )}

            {tab === 'register' && (
              <form onSubmit={handleRegister} className={styles.form}>
                <div className={styles.twoCol}>
                  <div className={styles.group}>
                    <label htmlFor="register-username">Username</label>
                    <input id="register-username" name="username" className={styles.input} placeholder="Stage name" required autoComplete="username" />
                  </div>
                  <div className={styles.group}>
                    <label htmlFor="register-email">Email</label>
                    <input id="register-email" name="email" type="email" className={styles.input} placeholder="you@example.com" required autoComplete="email" />
                  </div>
                </div>
                <div className={styles.twoCol}>
                  <div className={styles.group}>
                    <label htmlFor="register-password">Password</label>
                    <input id="register-password" name="password" type="password" className={styles.input} placeholder="Create password" required autoComplete="new-password" />
                  </div>
                  <div className={styles.group}>
                    <label htmlFor="register-confirm">Confirm</label>
                    <input id="register-confirm" name="confirm_password" type="password" className={styles.input} placeholder="Repeat password" required autoComplete="new-password" />
                  </div>
                </div>
                <div className={styles.group}>
                  <label htmlFor="invite-key">Invite Key <span>optional</span></label>
                  <input id="invite-key" name="invite_key" className={styles.input} placeholder="Instant access key" />
                </div>
                <button type="submit" className={styles.submit} disabled={loading}>{loading ? 'Creating account…' : 'Create account'}</button>
              </form>
            )}

            {tab === 'forgot' && (
              <form onSubmit={handleForgot} className={styles.form}>
                <div className={styles.group}>
                  <label htmlFor="forgot-username">Username / Email</label>
                  <input id="forgot-username" name="username" className={styles.input} placeholder="you@example.com" required autoComplete="username" />
                </div>
                <button type="submit" className={styles.submit} disabled={loading}>{loading ? 'Sending…' : 'Send reset link'}</button>
                <button type="button" className={styles.secondaryAction} onClick={() => switchTab('login')}>Back to login</button>
              </form>
            )}

            {tab === 'reset' && (
              <form onSubmit={handleReset} className={styles.form}>
                <div className={styles.group}>
                  <label htmlFor="reset-password">New Password</label>
                  <input id="reset-password" name="password" type="password" className={styles.input} placeholder="Enter new password" required autoComplete="new-password" />
                </div>
                <button type="submit" className={styles.submit} disabled={loading}>{loading ? 'Resetting…' : 'Reset password'}</button>
              </form>
            )}
          </section>

          <div className={styles.footer}>
            <Link to="/about">About MelodAI</Link>
          </div>
        </main>
      </div>
    </div>
  )
}
