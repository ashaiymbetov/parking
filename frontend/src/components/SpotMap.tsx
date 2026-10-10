import { useSpots } from '../api/queries'
import type { Spot } from '../api/types'

const LABEL = { free: 'свободно', booked: 'забронировано', occupied: 'занято' } as const

export function SpotMap({ selected, onSelect }: { selected?: string | null; onSelect?: (spot: Spot) => void }) {
  const spots = useSpots()
  if (spots.isPending) return <p>Загружаем схему…</p>
  if (spots.isError) return <p className="error">Схема недоступна: {spots.error.message}</p>

  return (
    <section className="card">
      <h2>Схема парковки</h2>
      <div className="legend">
        {(['free', 'booked', 'occupied'] as const).map((s) => (
          <span key={s} className={`dot dot--${s}`}>{LABEL[s]}</span>
        ))}
      </div>
      <div className="map">
        {spots.data.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`spot spot--${s.state}${selected === s.id ? ' spot--selected' : ''}`}
            style={{ gridRow: s.row, gridColumn: s.col }}
            data-testid={`spot-${s.code}`}
            data-state={s.state}
            title={`${s.code}: ${LABEL[s.state]}`}
            onClick={() => onSelect?.(s)}
            disabled={!onSelect}
          >
            {s.code}
          </button>
        ))}
      </div>
    </section>
  )
}
