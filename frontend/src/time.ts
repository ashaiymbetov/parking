import { DateTime } from 'luxon'

/** Times are stored in UTC and shown in the parking time zone (CLAUDE.md, principle 2). */
export const PARKING_TZ: string = import.meta.env.VITE_PARKING_TZ ?? 'Asia/Bishkek'

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return DateTime.fromISO(iso, { zone: PARKING_TZ }).toFormat('dd.MM.yyyy HH:mm')
}

/** `<input type="datetime-local">` value in parking time → ISO 8601 with offset. */
export function fromLocalInput(value: string): string {
  return DateTime.fromISO(value, { zone: PARKING_TZ }).toISO({ suppressMilliseconds: true }) ?? value
}

export function toLocalInput(dt: DateTime): string {
  return dt.setZone(PARKING_TZ).toFormat("yyyy-MM-dd'T'HH:mm")
}

/** Default booking start: the next quarter of an hour in parking time. */
export function nextQuarter(): DateTime {
  const now = DateTime.now().setZone(PARKING_TZ).startOf('minute')
  return now.plus({ minutes: 15 - (now.minute % 15) })
}

export function money(kop: number): string {
  return `${Math.floor(kop / 100)},${String(kop % 100).padStart(2, '0')} сом`
}
