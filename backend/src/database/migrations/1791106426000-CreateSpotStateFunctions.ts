import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The one rule for a spot's state (D-011), used by the map, the snapshot
 * and (later) walk-in spot choice. "Now" and the window are parameters:
 * domain SQL never calls now() (Clock, CLAUDE.md principle 3).
 */
export class CreateSpotStateFunctions1791106426000 implements MigrationInterface {
  name = 'CreateSpotStateFunctions1791106426000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // occupied (open visit) > booked (confirmed booking overlapping
    // [at, at + soon)) > free. checked_in bookings are not "booked": their
    // car is inside, so the spot is occupied by its visit.
    await queryRunner.query(`
      CREATE FUNCTION spot_state_at(p_spot_id uuid, p_at timestamptz, p_soon interval)
      RETURNS text
      LANGUAGE sql STABLE
      AS $$
        SELECT CASE
          WHEN EXISTS (SELECT 1 FROM visits v
                       WHERE v.spot_id = p_spot_id AND v.exited_at IS NULL)
            THEN 'occupied'
          WHEN EXISTS (SELECT 1 FROM bookings b
                       WHERE b.spot_id = p_spot_id AND b.status = 'confirmed'
                         AND b.period && tstzrange(p_at, p_at + p_soon, '[)'))
            THEN 'booked'
          ELSE 'free'
        END
      $$
    `);

    // Recomputes the state and, only if it changed, stores it with
    // version + 1 and sends spot.updated. Called inside the mutating
    // transaction: NOTIFY is delivered on COMMIT, never on ROLLBACK.
    await queryRunner.query(`
      CREATE FUNCTION refresh_spot_state(p_spot_id uuid, p_at timestamptz, p_soon interval)
      RETURNS TABLE (new_state text, new_version bigint, changed boolean)
      LANGUAGE plpgsql
      AS $$
      DECLARE
        v_state text := spot_state_at(p_spot_id, p_at, p_soon);
        v_version bigint;
      BEGIN
        INSERT INTO spot_state AS ss (spot_id, state, version, updated_at)
        VALUES (p_spot_id, v_state, 1, p_at)
        ON CONFLICT (spot_id) DO UPDATE
          SET state = EXCLUDED.state,
              version = ss.version + 1,
              updated_at = EXCLUDED.updated_at
          WHERE ss.state IS DISTINCT FROM EXCLUDED.state
        RETURNING ss.version INTO v_version;

        IF v_version IS NOT NULL THEN
          PERFORM pg_notify('parking_events', json_build_object(
            'type', 'spot.updated', 'spotId', p_spot_id,
            'state', v_state, 'version', v_version)::text);
          RETURN QUERY SELECT v_state, v_version, true;
        ELSE
          RETURN QUERY SELECT ss.state, ss.version, false
                       FROM spot_state ss WHERE ss.spot_id = p_spot_id;
        END IF;
      END
      $$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP FUNCTION refresh_spot_state(uuid, timestamptz, interval)`,
    );
    await queryRunner.query(
      `DROP FUNCTION spot_state_at(uuid, timestamptz, interval)`,
    );
  }
}
