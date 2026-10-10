import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Clock } from '../clock/clock';
import { NoShowTask } from './no-show.task';
import { OutboxTask } from './outbox.task';
import { ReminderTask } from './reminder.task';
import { SpotSnapshotTask } from './spot-snapshot.task';

/**
 * Polling loop. Every tick derives "what is due" from the database, so no
 * state lives in memory and a restart loses nothing (ARCHITECTURE §5).
 */
@Injectable()
export class WorkerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(WorkerService.name);
  private readonly pollMs: number;
  private stopping = false;
  private sleepTimer?: NodeJS.Timeout;
  private wakeUp?: () => void;
  private loopDone?: Promise<void>;

  constructor(
    private readonly clock: Clock,
    private readonly noShows: NoShowTask,
    private readonly reminders: ReminderTask,
    private readonly outbox: OutboxTask,
    private readonly snapshot: SpotSnapshotTask,
    config: ConfigService,
  ) {
    this.pollMs = config.getOrThrow<number>('WORKER_POLL_MS');
  }

  onApplicationBootstrap(): void {
    this.logger.log(`Worker started, polling every ${this.pollMs} ms`);
    this.loopDone = this.loop();
  }

  async onApplicationShutdown(signal?: string): Promise<void> {
    this.logger.log(`Stopping worker (${signal ?? 'shutdown'})`);
    this.stopping = true;
    clearTimeout(this.sleepTimer);
    this.wakeUp?.();
    // Let the current tick finish its transaction before the pool closes.
    await this.loopDone;
  }

  /** One pass over all periodic tasks. Public so tests can drive it. */
  async tick(): Promise<void> {
    const now = this.clock.now();
    // Order matters: a released booking gets no reminder; emails created in
    // this tick go out in this tick; the map reflects all of the above.
    const released = await this.noShows.run(now);
    const reminders = await this.reminders.run(now);
    const sent = await this.outbox.run(now);
    await this.snapshot.run(now);
    if (released + reminders + sent > 0) {
      this.logger.log(
        `tick ${now.toISOString()}: released ${released}, reminders ${reminders}, emails ${sent}`,
      );
    }
  }

  private async loop(): Promise<void> {
    while (!this.stopping) {
      try {
        await this.tick();
      } catch (err) {
        // A failed tick (e.g. DB restart) must not kill the worker.
        this.logger.error(
          'tick failed',
          err instanceof Error ? err.stack : err,
        );
      }
      await this.sleep();
    }
  }

  private sleep(): Promise<void> {
    if (this.stopping) return Promise.resolve();
    return new Promise((resolve) => {
      this.wakeUp = resolve;
      this.sleepTimer = setTimeout(resolve, this.pollMs);
    });
  }
}
