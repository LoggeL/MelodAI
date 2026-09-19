import { useContext } from 'react'
import { AuthContext } from './auth-context'

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used within AuthProvider')
  return value
}
