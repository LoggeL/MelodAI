import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { auth, tracks } from '../services/api'
import { PageState } from '../components/common/PageState'
import { AuthContext, type AuthState } from './auth-context'

const signedOut: AuthState = { checked: false, authenticated: false, username: '', displayName: '', isAdmin: false, credits: 0 }

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(signedOut)
  const [error, setError] = useState('')
  const requestRef = useRef<Promise<void> | null>(null)
  const generation = useRef(0)
  const check = useCallback((force = true) => {
    if (!force && requestRef.current) return requestRef.current
    const version = ++generation.current
    setError('')
    const pending = auth.check().then(data => {
      if (version !== generation.current) return
      setState({ checked: true, authenticated: data.authenticated, username: data.username || '',
        displayName: data.display_name || data.username || '', isAdmin: data.is_admin || false, credits: data.credits ?? 0 })
    }).catch(error => {
      if (version === generation.current) setError(error instanceof Error ? error.message : 'Unable to load your session')
    }).finally(() => { if (version === generation.current) requestRef.current = null })
    requestRef.current = pending
    return pending
  }, [])
  useEffect(() => { void check(false) }, [check])
  const logout = useCallback(async () => {
    await auth.logout()
    generation.current++
    requestRef.current = null
    try { localStorage.removeItem('melodai_queue') } catch { /* storage may be disabled */ }
    setState({ ...signedOut, checked: true })
  }, [])
  const setCredits = useCallback((credits: number) => setState(prev => ({ ...prev, credits })), [])
  const refreshCredits = useCallback(async () => {
    const version = generation.current
    try { const data = await tracks.credits(); if (version === generation.current) setCredits(data.credits) } catch { /* keep the last confirmed balance */ }
  }, [setCredits])
  const value = useMemo(() => ({ ...state, check, logout, refreshCredits, setCredits }), [state, check, logout, refreshCredits, setCredits])
  return <AuthContext.Provider value={value}>{error
    ? <PageState title="Unable to connect" description={error} action={<button className="button" onClick={() => void check()}>Try again</button>} />
    : children}</AuthContext.Provider>
}
