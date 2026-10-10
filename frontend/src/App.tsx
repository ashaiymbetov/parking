import { useAuth } from './auth'
import { DriverPage } from './components/DriverPage'
import { LoginPage } from './components/LoginPage'
import { OperatorPage } from './components/OperatorPage'
import { useRealtime } from './realtime'
import { PARKING_TZ } from './time'

const CONNECTION = { connecting: 'подключение…', online: 'онлайн', offline: 'нет связи' } as const

function App() {
  const { session, logout } = useAuth()
  const connection = useRealtime(session?.accessToken ?? null)
  if (!session) return <LoginPage />

  return (
    <main className="page">
      <header className="header">
        <h1>Парковка</h1>
        <span className={`conn conn--${connection}`} data-testid="connection">{CONNECTION[connection]}</span>
        <span className="muted">
          {session.user.email} ({session.user.role === 'operator' ? 'оператор' : 'водитель'}) · время {PARKING_TZ}
        </span>
        <button type="button" className="secondary" onClick={logout}>Выйти</button>
      </header>
      {session.user.role === 'operator' ? <OperatorPage /> : <DriverPage />}
    </main>
  )
}

export default App
