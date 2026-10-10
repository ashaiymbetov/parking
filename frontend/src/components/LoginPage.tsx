import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth'

export function LoginPage() {
  const { login, register } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent, mode: 'login' | 'register') {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await (mode === 'login' ? login : register)(email, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="page page--narrow">
      <h1>Парковка</h1>
      <form className="card form" onSubmit={(e) => submit(e, 'login')}>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
        </label>
        <label>
          Пароль
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="current-password" />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="row">
          <button type="submit" disabled={busy}>Войти</button>
          <button type="button" className="secondary" disabled={busy} onClick={(e) => submit(e, 'register')}>
            Зарегистрироваться
          </button>
        </div>
        <p className="muted">
          Демо: <code>driver1@parking.local</code>, <code>operator@parking.local</code>, пароль <code>parking123</code>
        </p>
      </form>
    </main>
  )
}
