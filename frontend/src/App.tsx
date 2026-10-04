import { ApiError } from './api/client'
import { useHealth } from './api/health'

function App() {
  const health = useHealth()

  return (
    <main className="page">
      <h1>Parking</h1>
      <section className="card" aria-live="polite">
        <h2>Состояние сервиса</h2>
        {health.isPending && <p>Проверяем…</p>}
        {health.isError && (
          <p className="status status--down" data-testid="health-status">
            API недоступен
            {health.error instanceof ApiError ? ` (HTTP ${health.error.status})` : ''}
          </p>
        )}
        {health.data && (
          <>
            <p className="status status--ok" data-testid="health-status">
              API: {health.data.status}, БД: {health.data.db}
            </p>
            <pre>{JSON.stringify(health.data, null, 2)}</pre>
          </>
        )}
      </section>
    </main>
  )
}

export default App
