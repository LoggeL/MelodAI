import { createContext } from 'react'

export interface AuthState {
  checked: boolean
  authenticated: boolean
  username: string
  displayName: string
  isAdmin: boolean
  credits: number
}
export interface AuthContextValue extends AuthState {
  check: () => Promise<void>
  logout: () => Promise<void>
  refreshCredits: () => Promise<void>
  setCredits: (credits: number) => void
}
export const AuthContext = createContext<AuthContextValue | null>(null)
