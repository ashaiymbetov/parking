import { useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { api, setApiToken } from './api/client'
import type { User } from './api/types'

interface Session { accessToken: string; user: User }
interface AuthValue {
  session: Session | null
  login(email: string, password: string): Promise<void>
  register(email: string, password: string): Promise<void>
  logout(): void
}

const KEY = 'parking.session'
const AuthContext = createContext<AuthValue | null>(null)

function load(): Session | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Session) : null
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [session, setSession] = useState<Session | null>(() => load())

  const logout = useCallback(() => {
    try { localStorage.removeItem(KEY) } catch { /* private mode */ }
    setApiToken(null)
    qc.clear()
    setSession(null)
  }, [qc])

  // Set synchronously so the first queries already carry the token.
  setApiToken(session?.accessToken ?? null, logout)

  const start = useCallback(async (path: string, email: string, password: string) => {
    const s = await api<Session>(path, { method: 'POST', body: { email, password } })
    try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* private mode */ }
    qc.clear()
    setSession(s)
  }, [qc])

  const value = useMemo<AuthValue>(() => ({
    session,
    login: (e, p) => start('/auth/login', e, p),
    register: (e, p) => start('/auth/register', e, p),
    logout,
  }), [session, start, logout])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const v = useContext(AuthContext)
  if (!v) throw new Error('useAuth outside AuthProvider')
  return v
}
