import { EntityManager } from 'typeorm';
import { TariffVersion } from '../tariffing/tariffing.types';

interface TariffRow {
  id: string;
  valid_from: Date;
  valid_to: Date | null;
  timezone: string;
  day_starts_at: string;
  night_starts_at: string;
  day_price_kop: number;
  night_price_kop: number;
}

/**
 * All tariff versions (a handful of rows), in the shape the pure
 * calculation expects. The parking time zone comes from PARKING_TZ; a
 * version configured for another zone is a configuration error (D-025).
 */
export async function loadTariffs(
  m: EntityManager,
  timeZone: string,
): Promise<TariffVersion[]> {
  const rows: TariffRow[] = await m.query(
    `SELECT id, lower(valid_during) AS valid_from, upper(valid_during) AS valid_to,
            timezone, day_starts_at::text, night_starts_at::text,
            day_price_kop, night_price_kop
     FROM tariffs ORDER BY lower(valid_during)`,
  );
  return rows.map((r) => {
    if (r.timezone !== timeZone) {
      throw new Error(
        `Tariff ${r.id} is set for ${r.timezone}, the parking runs in ${timeZone}`,
      );
    }
    return {
      id: r.id,
      validFrom: r.valid_from,
      validTo: r.valid_to,
      dayStartsAt: r.day_starts_at.slice(0, 5),
      nightStartsAt: r.night_starts_at.slice(0, 5),
      dayPriceKop: r.day_price_kop,
      nightPriceKop: r.night_price_kop,
    };
  });
}
