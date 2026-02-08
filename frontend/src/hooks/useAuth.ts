import { useState, useEffect, useCallback } from 'react'
import { auth, tracks } from '../services/api'

interface AuthState {
  checked: boolean
  authenticated: boolean
  username: string
  displayName: string
  isAdmin: boolean
  credits: number
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    checked: false,
    authenticated: false,
    username: '',
    displayName: '',
    isAdmin: false,
    credits: 0,
  })

  const check = useCallback(async () => {
    try {
      const data = await auth.check()
      setState({
        checked: true,
        authenticated: data.authenticated,
        username: data.username || '',
        displayName: data.display_name || data.username || '',
        isAdmin: data.is_admin || false,
        credits: data.credits ?? 0,
      })
    } catch {
      setState(prev => ({ ...prev, checked: true, authenticated: false }))
    }
  }, [])

  useEffect(() => { check() }, [check])

  const logout = useCallback(async () => {
    await auth.logout()
    setState({ checked: true, authenticated: false, username: '', displayName: '', isAdmin: false, credits: 0 })
  }, [])

  const refreshCredits = useCallback(async () => {
    try {
      const data = await tracks.credits()
      setState(prev => ({ ...prev, credits: data.credits }))
    } catch { /* ignore */ }
  }, [])

  const setCredits = useCallback((credits: number) => {
    setState(prev => ({ ...prev, credits }))
  }, [])

  return { ...state, check, logout, refreshCredits, setCredits }
}
