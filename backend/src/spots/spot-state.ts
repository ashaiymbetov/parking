import { EntityManager } from 'typeorm';

export type SpotState = 'free' | 'booked' | 'occupied';

/**
 * Recomputes a spot's state with the one SQL rule (D-011) and, if it changed,
 * bumps spot_state.version and sends spot.updated — on COMMIT of the caller's
 * transaction. The caller must hold the spot row lock (FOR UPDATE).
 */
export async function refreshSpotState(
  m: EntityManager,
  spotId: string,
  now: Date,
  soonMin: number,
): Promise<void> {
  await m.query(
    `SELECT * FROM refresh_spot_state($1, $2, make_interval(mins => $3))`,
    [spotId, now, soonMin],
  );
}
