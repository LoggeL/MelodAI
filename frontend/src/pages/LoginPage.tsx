import { useState, useEffect, type FormEvent } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { auth } from '../services/api'
import styles from './LoginPage.module.css'

export function LoginPage() {
  const [tab, setTab] = useState<'login' | 'register' | 'forgot' | 'reset'>('login')
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

  const handleLogin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)
    const form = new FormData(e.currentTarget)
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
    setLoading(false)
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
    setLoading(false)
  }

  const handleForgot = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)
    const form = new FormData(e.currentTarget)
    const data = await auth.forgotPassword(form.get('username') as string)
    setMessage({ type: 'success', text: data.message || 'Check your email' })
    setLoading(false)
  }

  const handleReset = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)
    const form = new FormData(e.currentTarget)
    const data = await auth.resetPassword(resetToken, form.get('password') as string)
    if (data.success) {
      setMessage({ type: 'success', text: 'Password reset! You can now login.' })
      window.location.hash = ''
      setTimeout(() => setTab('login'), 2000)
    } else {
      setMessage({ type: 'error', text: data.error || 'Reset failed' })
    }
    setLoading(false)
  }

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.logo}>
          <img src="/logo.svg" alt="MelodAI" />
          <div className={styles.logoTitle}>Melod<span className={styles.logoAccent}>AI</span></div>
          <p className={styles.logoSub}>AI-Powered Karaoke</p>
        </div>

        <div className={styles.card}>
          {tab !== 'reset' && (
            <div className={styles.tabs}>
              <button className={`${styles.tab} ${tab === 'login' ? styles.tabActive : ''}`} onClick={() => { setTab('login'); setMessage(null) }}>Login</button>
              <button className={`${styles.tab} ${tab === 'register' ? styles.tabActive : ''}`} onClick={() => { setTab('register'); setMessage(null) }}>Register</button>
            </div>
          )}

          {message && (
            <div className={`${styles.message} ${message.type === 'error' ? styles.messageError : styles.messageSuccess}`}>
              {message.text}
            </div>
          )}

          {tab === 'login' && (
            <form onSubmit={handleLogin}>
              <div className={styles.group}>
                <label>Username / Email</label>
                <input name="username" className={styles.input} placeholder="Enter your username" required autoComplete="username" />
              </div>
              <div className={styles.group}>
                <label>Password</label>
                <input name="password" type="password" className={styles.input} placeholder="Enter your password" required autoComplete="current-password" />
              </div>
              <div className={styles.check}>
                <input type="checkbox" name="remember" id="remember" />
                <label htmlFor="remember">Remember me for 30 days</label>
              </div>
              <button type="submit" className={styles.submit} disabled={loading}>Sign In</button>
              <button type="button" className={styles.forgotLink} onClick={() => { setTab('forgot'); setMessage(null) }}>Forgot Password?</button>
            </form>
          )}

          {tab === 'register' && (
            <form onSubmit={handleRegister}>
              <div className={styles.group}>
                <label>Username</label>
                <input name="username" className={styles.input} placeholder="Choose a username" required autoComplete="username" />
              </div>
              <div className={styles.group}>
                <label>Email</label>
                <input name="email" type="email" className={styles.input} placeholder="Enter your email" required autoComplete="email" />
              </div>
              <div className={styles.group}>
                <label>Password</label>
                <input name="password" type="password" className={styles.input} placeholder="Choose a password" required autoComplete="new-password" />
              </div>
              <div className={styles.group}>
                <label>Confirm Password</label>
                <input name="confirm_password" type="password" className={styles.input} placeholder="Confirm your password" required autoComplete="new-password" />
              </div>
              <div className={styles.group}>
                <label>Invite Key (optional)</label>
                <input name="invite_key" className={styles.input} placeholder="Enter invite key for instant access" />
              </div>
              <button type="submit" className={styles.submit} disabled={loading}>Create Account</button>
            </form>
          )}

          {tab === 'forgot' && (
            <form onSubmit={handleForgot}>
              <div className={styles.group}>
                <label>Username / Email</label>
                <input name="username" className={styles.input} placeholder="Enter your username" required />
              </div>
              <button type="submit" className={styles.submit} disabled={loading}>Send Reset Link</button>
            </form>
          )}

          {tab === 'reset' && (
            <form onSubmit={handleReset}>
              <h3 style={{ marginBottom: '16px', textAlign: 'center' }}>Reset Password</h3>
              <div className={styles.group}>
                <label>New Password</label>
                <input name="password" type="password" className={styles.input} placeholder="Enter new password" required autoComplete="new-password" />
              </div>
              <button type="submit" className={styles.submit} disabled={loading}>Reset Password</button>
            </form>
          )}
        </div>

        <div className={styles.footer}>
          <Link to="/about">About MelodAI</Link>
        </div>
      </div>
    </div>
  )
}
