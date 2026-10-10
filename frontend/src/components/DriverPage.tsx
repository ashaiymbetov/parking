import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { api } from '../api/client'
import { keys, useBookings, useInvoices, useMe, useVisits } from '../api/queries'
import type { Booking, Spot } from '../api/types'
import { formatTime, fromLocalInput, money, nextQuarter, toLocalInput } from '../time'
import { SpotMap } from './SpotMap'

const STATUS: Record<string, string> = {
  confirmed: 'подтверждена',
  checked_in: 'машина на месте',
  completed: 'завершена',
  cancelled: 'отменена',
  no_show: 'снята (не заехали)',
}

export function DriverPage() {
  const [spot, setSpot] = useState<Spot | null>(null)
  return (
    <>
      <SpotMap selected={spot?.id} onSelect={setSpot} />
      <BookingForm spot={spot} />
      <Bookings />
      <Cars />
      <History />
    </>
  )
}

function BookingForm({ spot }: { spot: Spot | null }) {
  const qc = useQueryClient()
  const me = useMe()
  const start = nextQuarter()
  const [carId, setCarId] = useState('')
  const [from, setFrom] = useState(toLocalInput(start))
  const [to, setTo] = useState(toLocalInput(start.plus({ hours: 1 })))
  const book = useMutation({
    mutationFn: () =>
      api<Booking>('/bookings', {
        method: 'POST',
        body: { carId: carId || me.data?.cars[0]?.id, spotId: spot?.id, from: fromLocalInput(from), to: fromLocalInput(to) },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.bookings }),
  })

  const cars = me.data?.cars ?? []
  function submit(e: FormEvent) {
    e.preventDefault()
    book.mutate()
  }

  return (
    <form className="card form" onSubmit={submit}>
      <h2>Бронь места {spot ? <strong>{spot.code}</strong> : <span className="muted">— выберите место на схеме</span>}</h2>
      {cars.length === 0 ? (
        <p className="muted">Сначала добавьте машину ниже.</p>
      ) : (
        <div className="row">
          <label>
            Машина
            <select value={carId} onChange={(e) => setCarId(e.target.value)}>
              {cars.map((c) => <option key={c.id} value={c.id}>{c.plate}</option>)}
            </select>
          </label>
          <label>
            С
            <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} required />
          </label>
          <label>
            По
            <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} required />
          </label>
          <button type="submit" disabled={!spot || book.isPending}>Забронировать</button>
        </div>
      )}
      {book.isError && <p className="error" role="alert">{book.error.message}</p>}
      {book.isSuccess && (
        <p className="ok" role="status">
          Место {book.data.spot.code} забронировано: {formatTime(book.data.from)} – {formatTime(book.data.to)}
        </p>
      )}
    </form>
  )
}

function Bookings() {
  const qc = useQueryClient()
  const bookings = useBookings()
  const cancel = useMutation({
    mutationFn: (id: string) => api<Booking>(`/bookings/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.bookings }),
  })
  return (
    <section className="card">
      <h2>Мои брони</h2>
      {cancel.isError && <p className="error" role="alert">{cancel.error.message}</p>}
      {bookings.data?.length === 0 && <p className="muted">Броней нет.</p>}
      <ul className="list">
        {bookings.data?.map((b) => (
          <li key={b.id}>
            <span>
              <strong>{b.spot.code}</strong> · {b.car.plate} · {formatTime(b.from)} – {formatTime(b.to)} ·{' '}
              <span className={`badge badge--${b.status}`}>{STATUS[b.status] ?? b.status}</span>
            </span>
            {b.status === 'confirmed' && (
              <button type="button" className="secondary" onClick={() => cancel.mutate(b.id)} disabled={cancel.isPending}>
                Отменить
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

function Cars() {
  const qc = useQueryClient()
  const me = useMe()
  const [plate, setPlate] = useState('')
  const refresh = () => qc.invalidateQueries({ queryKey: keys.me })
  const add = useMutation({
    mutationFn: () => api('/me/cars', { method: 'POST', body: { plate } }),
    onSuccess: () => { setPlate(''); void refresh() },
  })
  const remove = useMutation({
    mutationFn: (id: string) => api(`/me/cars/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  })
  return (
    <section className="card">
      <h2>Мои машины</h2>
      <ul className="list">
        {me.data?.cars.map((c) => (
          <li key={c.id}>
            <code>{c.plate}</code>
            <button type="button" className="secondary" onClick={() => remove.mutate(c.id)}>Удалить</button>
          </li>
        ))}
      </ul>
      <form className="row" onSubmit={(e) => { e.preventDefault(); add.mutate() }}>
        <input placeholder="Номер, например А123ВС" value={plate} onChange={(e) => setPlate(e.target.value)} required />
        <button type="submit" disabled={add.isPending}>Добавить</button>
      </form>
      {(add.error ?? remove.error) && <p className="error" role="alert">{(add.error ?? remove.error)?.message}</p>}
    </section>
  )
}

function History() {
  const visits = useVisits()
  const invoices = useInvoices()
  const total = invoices.data?.reduce((sum, i) => sum + i.amountKop, 0) ?? 0
  return (
    <section className="card">
      <h2>История визитов и счетов</h2>
      {visits.data?.length === 0 && <p className="muted">Визитов пока нет.</p>}
      <ul className="list">
        {visits.data?.map((v) => (
          <li key={v.id}>
            <span>
              {v.plate} · место {v.spot.code} · {formatTime(v.enteredAt)} – {v.exitedAt ? formatTime(v.exitedAt) : 'на парковке'}
              {v.bookingId && ' · по брони'}
            </span>
            {v.invoice && (
              <details>
                <summary>{money(v.invoice.amountKop)} за {v.invoice.minutes} мин</summary>
                <ul>
                  {v.invoice.segments.map((s) => (
                    <li key={s.from}>
                      {s.kind === 'day' ? 'день' : 'ночь'}: {s.minutes} мин × {money(s.pricePerMinuteKop)} = {money(s.amountKop)}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </li>
        ))}
      </ul>
      {invoices.data && invoices.data.length > 0 && <p>Всего оплачено: <strong>{money(total)}</strong></p>}
    </section>
  )
}
