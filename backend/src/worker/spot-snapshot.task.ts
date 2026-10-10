import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { refreshSpotState } from '../spots/spot-state';
import { WorkerSettings } from './worker-settings';

/**
 * States change with time alone (a booking enters its 15-minute window, a
 * booking ends). Recompute every spot; refresh_spot_state writes and
 * notifies only real changes (D-011). Spots locked by a mutation right now
 * are skipped: that mutation refreshes them itself.
 */
@Injectable()
export class SpotSnapshotTask {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly settings: WorkerSettings,
  ) {}

  run(now: Date): Promise<void> {
    return this.ds.transaction(async (m) => {
      const spots: { id: string }[] = await m.query(
        `SELECT id FROM spots WHERE is_active ORDER BY id FOR UPDATE SKIP LOCKED`,
      );
      for (const s of spots) {
        await refreshSpotState(m, s.id, now, this.settings.soonMin);
      }
    });
  }
}
