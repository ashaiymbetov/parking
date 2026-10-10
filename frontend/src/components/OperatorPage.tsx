import { useMutation } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { api } from '../api/client'
import { useAnomalies, useGateEvents, useOperatorVisits } from '../api/queries'
import { formatTime, money } from '../time'
import { SpotMap } from './SpotMap'

const ANOMALY: Record<string, string> = {
  exit_without_entry: 'выезд без заезда',
  double_entry: 'двойной заезд',
  no_free_spot: 'нет свободных мест',
  invalid_plate: 'нераспознанный номер',
  booked_spot_occupied: 'забронированное место занято',
  reminder_missed: 'напоминание пропущено',
}

interface EntryResult { plate: string; spot: { code: string }; bookingId: string | null }
interface ExitResult { visit: { plate: string; spot: { code: string } }; invoice: { minutes: number; amountKop: number } }

export function OperatorPage() {
  return (
    <>
      <SpotMap />
      <Gate />
      <OpenVisits />
      <Journals />
    </>
  )
}

function Gate() {
  const [plate, setPlate] = useState('')
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const run = useMutation({
    mutationFn: (kind: 'entry' | 'exit') =>
      api<EntryResult | ExitResult>(`/gate/${kind}`, {
        method: 'POST',
        body: { plate },
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      }),
    onSuccess: (r) =>
      setMessage({
        ok: true,
        text: 'invoice' in r
          ? `Выезд ${r.visit.plate} с места ${r.visit.spot.code}: ${r.invoice.minutes} мин, к оплате ${money(r.invoice.amountKop)}`
          : `Заезд ${r.plate}: место ${r.spot.code}${r.bookingId ? ' (по брони)' : ''}`,
      }),
    onError: (e) => setMessage({ ok: false, text: e.message }),
  })
  const press = (kind: 'entry' | 'exit') => (e: FormEvent) => {
    e.preventDefault()
    run.mutate(kind)
  }
  return (
    <form className="card form" onSubmit={press('entry')}>
      <h2>Симулятор шлагбаума</h2>
      <div className="row">
        <input aria-label="Номер машины" placeholder="Номер машины" value={plate} onChange={(e) => setPlate(e.target.value)} required />
        <button type="submit" disabled={run.isPending}>Заезд</button>
        <button type="button" disabled={run.isPending} onClick={press('exit')}>Выезд</button>
      </div>
      {message && <p className={message.ok ? 'ok' : 'error'} role="status">{message.text}</p>}
    </form>
  )
}

function OpenVisits() {
  const visits = useOperatorVisits()
  return (
    <section className="card">
      <h2>Сейчас на парковке ({visits.data?.length ?? 0})</h2>
      <ul className="list">
        {visits.data?.map((v) => (
          <li key={v.id}>{v.plate} · место {v.spot.code} · с {formatTime(v.enteredAt)}{v.bookingId && ' · по брони'}</li>
        ))}
      </ul>
    </section>
  )
}

function Journals() {
  const anomalies = useAnomalies()
  const events = useGateEvents()
  return (
    <section className="card">
      <h2>Аномалии</h2>
      <ul className="list">
        {anomalies.data?.slice(0, 30).map((a) => (
          <li key={a.id}>{formatTime(a.createdAt)} · {ANOMALY[a.kind] ?? a.kind} · {a.plate ?? String(a.details.rawPlate ?? '')}</li>
        ))}
      </ul>
      <h2>Журнал шлагбаума</h2>
      <ul className="list">
        {events.data?.slice(0, 30).map((e) => (
          <li key={e.id}>
            {formatTime(e.occurredAt)} · {e.kind === 'entry' ? 'заезд' : 'выезд'} · {e.plate ?? e.rawPlate} ·{' '}
            {e.outcome === 'ok' ? 'принят' : `отказ ${e.errorCode}`}
          </li>
        ))}
      </ul>
    </section>
  )
}
