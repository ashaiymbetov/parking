import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Thresholds from env (CLAUDE.md, principle 10): short values for demos. */
@Injectable()
export class WorkerSettings {
  readonly graceMin: number;
  readonly reminderMin: number;
  readonly soonMin: number;
  readonly timeZone: string;

  constructor(config: ConfigService) {
    this.graceMin = config.getOrThrow<number>('NO_SHOW_GRACE_MIN');
    this.reminderMin = config.getOrThrow<number>('REMINDER_BEFORE_END_MIN');
    this.soonMin = config.getOrThrow<number>('EARLY_ENTRY_MIN');
    this.timeZone = config.getOrThrow<string>('PARKING_TZ');
  }
}
